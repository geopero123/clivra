import { createReadStream, existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Analytics, DayStat, ProviderId, SessionStat, SourceInfo } from '@shared/types'

/** What one transcript file contributes. Small enough to cache per file and merge on demand. */
export interface FileSummary {
  provider: ProviderId
  /** key: `${day}|${model}` */
  days: Record<string, { prompts: number; replies: number; tin: number; tout: number; cache: number; cost: number }>
  hours: number[] // 7*24 prompts
  tools: Record<string, number>
  sessions: SessionStat[]
}

const emptySummary = (provider: ProviderId): FileSummary => ({ provider, days: {}, hours: new Array(168).fill(0), tools: {}, sessions: [] })

export function localDay(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function bump(s: FileSummary, ts: number, model: string, f: Partial<FileSummary['days'][string]>): void {
  const key = `${localDay(ts)}|${model}`
  const d = (s.days[key] ??= { prompts: 0, replies: 0, tin: 0, tout: 0, cache: 0, cost: 0 })
  for (const k of Object.keys(f) as (keyof typeof d)[]) d[k] += f[k] ?? 0
}

function hour(s: FileSummary, ts: number): void {
  const d = new Date(ts)
  s.hours[d.getDay() * 24 + d.getHours()]++
}

async function* lines(path: string): AsyncGenerator<string> {
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const l of rl) if (l) yield l
}

/** Claude Code: ~/.claude/projects/<project>/<session>.jsonl */
export async function parseClaudeFile(path: string): Promise<FileSummary> {
  const s = emptySummary('claude')
  const replies = new Map<string, { ts: number; model: string; tin: number; tout: number; cache: number }>()
  const toolIds = new Set<string>()
  let sid = ''
  let cwd = ''
  let first = Infinity
  let last = 0
  let prompts = 0
  for await (const line of lines(path)) {
    // Cheap pre-filter: skip the many bookkeeping lines without parsing them.
    const isAsst = line.includes('"type":"assistant"')
    const isUser = line.includes('"type":"user"')
    if (!isAsst && !isUser) continue
    let o: any
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    const ts = Date.parse(o.timestamp)
    if (!Number.isFinite(ts)) continue
    sid ||= o.sessionId ?? ''
    cwd ||= o.cwd ?? ''
    first = Math.min(first, ts)
    last = Math.max(last, ts)
    if (o.type === 'user') {
      const c = o.message?.content
      const human = typeof c === 'string' ? c.trim().length > 0 : Array.isArray(c) && c.some((x: any) => x?.type === 'text') && !c.some((x: any) => x?.type === 'tool_result')
      if (human && !o.isMeta && !o.isSidechain) {
        prompts++
        bump(s, ts, '__prompt__', { prompts: 1 })
        hour(s, ts)
      }
    } else if (o.type === 'assistant' && o.message?.usage && o.message.model && o.message.model !== '<synthetic>') {
      const u = o.message.usage
      const id: string = o.message.id ?? o.uuid
      const prev = replies.get(id)
      const cur = { ts, model: o.message.model as string, tin: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), tout: u.output_tokens ?? 0, cache: u.cache_read_input_tokens ?? 0 }
      // The same API message is written once per content block; keep the most complete one.
      if (!prev || cur.tout >= prev.tout) replies.set(id, cur)
      for (const c of o.message.content ?? []) {
        if (c?.type === 'tool_use' && c.id && !toolIds.has(c.id)) {
          toolIds.add(c.id)
          s.tools[c.name] = (s.tools[c.name] ?? 0) + 1
        }
      }
    }
  }
  let tokens = 0
  for (const r of replies.values()) {
    bump(s, r.ts, r.model, { replies: 1, tin: r.tin, tout: r.tout, cache: r.cache })
    tokens += r.tin + r.tout
  }
  if (sid && last) s.sessions.push({ provider: 'claude', id: sid, start: first, end: last, project: basename(cwd || 'unknown'), prompts, tokens })
  return s
}

/** Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl (cumulative token_count events). */
export async function parseCodexFile(path: string): Promise<FileSummary> {
  const s = emptySummary('codex')
  let sid = basename(path)
  let cwd = ''
  let model = 'codex'
  let prevTotal = 0
  let first = Infinity
  let last = 0
  let prompts = 0
  let tokens = 0
  for await (const line of lines(path)) {
    let o: any
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    const ts = Date.parse(o.timestamp)
    const p = o.payload ?? {}
    if (o.type === 'session_meta') {
      sid = p.id ?? sid
      cwd = p.cwd ?? cwd
      model = p.model ?? model
    } else if (o.type === 'turn_context') {
      model = p.model ?? model
      cwd = p.cwd ?? cwd
    }
    if (!Number.isFinite(ts)) continue
    first = Math.min(first, ts)
    last = Math.max(last, ts)
    if (o.type === 'event_msg' && p.type === 'user_message') {
      prompts++
      bump(s, ts, '__prompt__', { prompts: 1 })
      hour(s, ts)
    } else if (o.type === 'event_msg' && p.type === 'token_count' && p.info?.total_token_usage) {
      const t = p.info.total_token_usage
      const total = (t.input_tokens ?? 0) + (t.output_tokens ?? 0)
      if (total > prevTotal) {
        const dIn = Math.max(0, (t.input_tokens ?? 0) - (t.cached_input_tokens ?? 0))
        // Attribute only the growth since the previous event, so repeated cumulative totals never double count.
        const frac = (total - prevTotal) / Math.max(1, total)
        bump(s, ts, model, { replies: 1, tin: Math.round(dIn * frac), tout: Math.round((t.output_tokens ?? 0) * frac), cache: Math.round((t.cached_input_tokens ?? 0) * frac) })
        tokens += total - prevTotal
        prevTotal = total
      }
    } else if (o.type === 'response_item' && (p.type === 'function_call' || p.type === 'custom_tool_call') && p.name) {
      s.tools[p.name] = (s.tools[p.name] ?? 0) + 1
    }
  }
  if (last) s.sessions.push({ provider: 'codex', id: sid, start: first, end: last, project: basename(cwd || 'unknown'), prompts, tokens })
  return s
}

/** OpenCode: ~/.local/share/opencode/opencode.db, opened read-only. */
export function readOpenCode(dbPath: string): FileSummary {
  const s = emptySummary('opencode')
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const own = `session_id NOT IN (SELECT id FROM session WHERE title='clivra-memory')`
    const rows = db
      .prepare(
        `SELECT time_created t, json_extract(data,'$.role') role, json_extract(data,'$.modelID') model,
                COALESCE(json_extract(data,'$.tokens.input'),0) tin, COALESCE(json_extract(data,'$.tokens.output'),0)+COALESCE(json_extract(data,'$.tokens.reasoning'),0) tout,
                COALESCE(json_extract(data,'$.tokens.cache.read'),0) cr, COALESCE(json_extract(data,'$.cost'),0) cost
         FROM message WHERE ${own}`
      )
      .all() as Record<string, any>[]
    for (const r of rows) {
      if (r.role === 'user') {
        bump(s, r.t, '__prompt__', { prompts: 1 })
        hour(s, r.t)
      } else if (r.role === 'assistant' && r.model && (r.tin || r.tout)) bump(s, r.t, r.model, { replies: 1, tin: r.tin, tout: r.tout, cache: r.cr, cost: r.cost })
    }
    for (const t of db.prepare(`SELECT json_extract(data,'$.tool') n, COUNT(*) c FROM part WHERE json_extract(data,'$.type')='tool' AND ${own} GROUP BY n`).all() as Record<string, any>[]) {
      if (t.n) s.tools[t.n] = t.c
    }
    for (const r of db
      .prepare(`SELECT s.id, s.directory dir, s.time_created a, s.time_updated b, s.tokens_input+s.tokens_output tk, (SELECT COUNT(*) FROM message m WHERE m.session_id=s.id AND json_extract(m.data,'$.role')='user') p FROM session s WHERE s.title<>'clivra-memory' AND s.parent_id IS NULL`)
      .all() as Record<string, any>[]) {
      s.sessions.push({ provider: 'opencode', id: r.id, start: r.a, end: r.b, project: basename(r.dir || 'unknown'), prompts: r.p, tokens: r.tk })
    }
  } finally {
    db.close()
  }
  return s
}

async function walk(dir: string, match: (n: string) => boolean, depth = 4): Promise<string[]> {
  if (depth < 0 || !existsSync(dir)) return []
  const out: string[] = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(p, match, depth - 1)))
    else if (match(e.name)) out.push(p)
  }
  return out
}

export interface CacheStore {
  get(path: string): { size: number; mtime: number; summary: FileSummary } | null
  set(path: string, size: number, mtime: number, summary: FileSummary): void
  prune(keep: Set<string>): void
}

const yieldLoop = () => new Promise<void>((r) => setImmediate(r))

export class StatsService {
  private summaries = new Map<string, FileSummary>()
  private sources: SourceInfo[] = []
  private scanning = false
  private progress = { done: 0, total: 0 }
  private pending?: Promise<void>
  listeners = new Set<(a: Analytics) => void>()

  constructor(private cache: CacheStore, private clivra: () => Analytics['clivra'], private home = homedir()) {}

  /** Incremental scan: unchanged files come from the cache, so repeat scans are near-instant. */
  scan(): Promise<void> {
    this.pending ??= this.run().finally(() => (this.pending = undefined))
    return this.pending
  }

  private async run(): Promise<void> {
    this.scanning = true
    this.emit()
    try {
      const claude = await walk(join(this.home, '.claude', 'projects'), (n) => n.endsWith('.jsonl'), 2)
      const codex = await walk(join(this.home, '.codex', 'sessions'), (n) => n.endsWith('.jsonl'), 4)
      const ocDb = join(this.home, '.local', 'share', 'opencode', 'opencode.db')
      const all: [ProviderId, string][] = [...claude.map((p) => ['claude', p] as [ProviderId, string]), ...codex.map((p) => ['codex', p] as [ProviderId, string])]
      this.progress = { done: 0, total: all.length + 1 }
      const seen = new Set<string>()
      for (const [prov, path] of all) {
        seen.add(path)
        try {
          const st = await stat(path)
          const hit = this.cache.get(path)
          if (hit && hit.size === st.size && hit.mtime === Math.floor(st.mtimeMs)) this.summaries.set(path, hit.summary)
          else {
            const sum = prov === 'claude' ? await parseClaudeFile(path) : await parseCodexFile(path)
            this.summaries.set(path, sum)
            this.cache.set(path, st.size, Math.floor(st.mtimeMs), sum)
          }
        } catch {
          /* unreadable or vanished file: skip */
        }
        this.progress.done++
        if (this.progress.done % 8 === 0) {
          this.emit()
          await yieldLoop()
        }
      }
      // OpenCode is a single database; re-read it (it is aggregated by SQL, so this is cheap).
      if (existsSync(ocDb)) {
        try {
          this.summaries.set(ocDb, readOpenCode(ocDb))
          seen.add(ocDb)
        } catch (e) {
          this.summaries.delete(ocDb)
          this.sources = [...this.sources.filter((x) => x.provider !== 'opencode'), { provider: 'opencode', available: false, files: 0, sessions: 0, note: (e as Error).message }]
        }
      }
      this.progress.done = this.progress.total
      for (const k of [...this.summaries.keys()]) if (!seen.has(k)) this.summaries.delete(k)
      this.cache.prune(seen)
      this.sources = (['claude', 'codex', 'opencode'] as ProviderId[]).map((p) => {
        const files = [...this.summaries.values()].filter((s) => s.provider === p)
        const note = p === 'codex' && !files.length ? 'No Codex session history found.' : undefined
        return { provider: p, available: files.length > 0, files: p === 'opencode' ? files.length : files.length, sessions: files.reduce((n, f) => n + f.sessions.length, 0), note }
      })
    } finally {
      this.scanning = false
      this.emit()
    }
  }

  snapshot(): Analytics {
    return buildAnalytics([...this.summaries.values()], this.sources, this.scanning, this.progress, this.clivra())
  }

  private emit(): void {
    if (!this.listeners.size) return
    const a = this.snapshot()
    this.listeners.forEach((l) => l(a))
  }
}

export function buildAnalytics(sums: FileSummary[], sources: SourceInfo[], scanning: boolean, progress: { done: number; total: number }, clivra: Analytics['clivra']): Analytics {
  const days = new Map<string, DayStat>()
  const hours: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0))
  const tools = new Map<string, { name: string; provider: ProviderId; count: number }>()
  const sessions: SessionStat[] = []
  for (const s of sums) {
    for (const [key, v] of Object.entries(s.days)) {
      const [day, model] = key.split('|')
      const k = `${day}|${s.provider}|${model}`
      const d = days.get(k) ?? { day, provider: s.provider, model, prompts: 0, replies: 0, tin: 0, tout: 0, cache: 0, cost: 0 }
      d.prompts += v.prompts
      d.replies += v.replies
      d.tin += v.tin
      d.tout += v.tout
      d.cache += v.cache
      d.cost += v.cost
      days.set(k, d)
    }
    s.hours.forEach((n, i) => (hours[Math.floor(i / 24)][i % 24] += n))
    for (const [name, count] of Object.entries(s.tools)) {
      const k = `${s.provider}|${name}`
      const t = tools.get(k) ?? { name, provider: s.provider, count: 0 }
      t.count += count
      tools.set(k, t)
    }
    sessions.push(...s.sessions)
  }
  return {
    generatedAt: Date.now(),
    scanning,
    progress,
    sources,
    days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    hours,
    tools: [...tools.values()].sort((a, b) => b.count - a.count).slice(0, 40),
    sessions: sessions.sort((a, b) => b.end - a.end).slice(0, 400),
    clivra
  }
}
