import { describe, it, expect } from 'vitest'
import { StatsService, buildAnalytics, parseCodexFile, parseClaudeFile, type FileSummary } from '../src/main/services/stats'
import { buildBrain } from '../src/main/services/brain'
import { tmpDir } from './helpers'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const memCache = () => {
  const m = new Map<string, { size: number; mtime: number; summary: FileSummary }>()
  return { m, c: { get: (p: string) => m.get(p) ?? null, set: (p: string, size: number, mtime: number, summary: FileSummary) => void m.set(p, { size, mtime, summary }), prune: () => undefined } }
}
const zero = { runs: 0, errors: 0, cancelled: 0, chats: 0, messages: 0, approvals: 0, denied: 0 }

describe('native history scanner', () => {
  it('parses Claude transcripts: dedupes streamed messages, counts prompts/tools/tokens', async () => {
    const f = join(tmpDir(), 's.jsonl')
    const t = (m: number) => `2026-03-0${m}T10:00:00.000Z`
    const L = [
      { type: 'user', timestamp: t(1), sessionId: 'S', cwd: '/w/app', message: { role: 'user', content: 'hello' } },
      { type: 'assistant', timestamp: t(1), sessionId: 'S', message: { id: 'm1', model: 'claude-x', usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 3 }, content: [{ type: 'tool_use', id: 'u1', name: 'Bash' }] } },
      { type: 'assistant', timestamp: t(1), sessionId: 'S', message: { id: 'm1', model: 'claude-x', usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 40 }, content: [{ type: 'tool_use', id: 'u1', name: 'Bash' }] } },
      { type: 'user', timestamp: t(1), sessionId: 'S', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'ok' }] } },
      { type: 'queue-operation' }
    ]
    writeFileSync(f, L.map((x) => JSON.stringify(x)).join('\n'))
    const s = await parseClaudeFile(f)
    const day = Object.entries(s.days).find(([k]) => k.endsWith('|claude-x'))![1]
    expect(day).toMatchObject({ replies: 1, tin: 15, tout: 40, cache: 100 })
    expect(Object.values(s.days).reduce((n, d) => n + d.prompts, 0)).toBe(1) // tool_result is not a prompt
    expect(s.tools).toEqual({ Bash: 1 })
    expect(s.sessions[0]).toMatchObject({ id: 'S', project: 'app', prompts: 1, tokens: 55 })
  })

  it('parses Codex rollout files without double counting cumulative totals (documented format, fixture)', async () => {
    const f = join(tmpDir(), 'rollout.jsonl')
    const ev = (ts: string, payload: object, type = 'event_msg') => JSON.stringify({ timestamp: ts, type, payload })
    writeFileSync(f, [
      ev('2026-03-01T09:00:00Z', { id: 'C1', cwd: '/w/api', model: 'gpt-x' }, 'session_meta'),
      ev('2026-03-01T09:00:01Z', { type: 'user_message', message: 'hi' }),
      ev('2026-03-01T09:00:05Z', { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 50 } } }),
      ev('2026-03-01T09:00:06Z', { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 50 } } }), // repeat: ignored
      ev('2026-03-01T09:01:00Z', { type: 'token_count', info: { total_token_usage: { input_tokens: 300, cached_input_tokens: 60, output_tokens: 150 } } }),
      ev('2026-03-01T09:01:01Z', { type: 'function_call', name: 'shell' }, 'response_item')
    ].join('\n'))
    const s = await parseCodexFile(f)
    expect(s.sessions[0]).toMatchObject({ id: 'C1', project: 'api', prompts: 1, tokens: 450 })
    expect(s.tools).toEqual({ shell: 1 })
    const tokens = Object.values(s.days).reduce((n, d) => n + d.tin + d.tout, 0)
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThanOrEqual(450)
  })

  it('scans a home directory incrementally using the cache', async () => {
    const home = tmpDir()
    const dir = join(home, '.claude', 'projects', 'p')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'a.jsonl'), JSON.stringify({ type: 'assistant', timestamp: '2026-03-01T10:00:00Z', sessionId: 'S', message: { id: 'm', model: 'm1', usage: { input_tokens: 1, output_tokens: 2 }, content: [] } }))
    const { m, c } = memCache()
    const svc = new StatsService(c, () => zero, home)
    await svc.scan()
    expect(m.size).toBe(1)
    const first = m.get(join(dir, 'a.jsonl'))!
    await svc.scan()
    expect(m.get(join(dir, 'a.jsonl'))).toBe(first) // not re-parsed
    expect(svc.snapshot().days.find((d) => d.model === 'm1')).toMatchObject({ provider: 'claude', tout: 2 })
    expect(svc.snapshot().sources.find((s) => s.provider === 'codex')?.available).toBe(false)
  })

  it('REAL machine history: scans Claude Code transcripts + OpenCode db without errors', async () => {
    if (!existsSync(join(homedir(), '.claude', 'projects'))) return
    const { c } = memCache()
    const svc = new StatsService(c, () => zero)
    const t0 = Date.now()
    await svc.scan()
    const a = svc.snapshot()
    console.log('REAL', JSON.stringify({ ms: Date.now() - t0, sources: a.sources.map((s) => `${s.provider}:${s.files}f/${s.sessions}s`), days: a.days.length, tokens: a.days.reduce((n, d) => n + d.tin + d.tout, 0), tools: a.tools.slice(0, 3).map((t) => `${t.name}=${t.count}`) }))
    expect(a.scanning).toBe(false)
    expect(a.sources.find((s) => s.provider === 'claude')?.available).toBe(true)
  })
})

describe('brain graph', () => {
  it('links providers, models, projects, tools and memories around a core', () => {
    const a = buildAnalytics([
      { provider: 'claude', days: { '2026-03-01|claude-x': { prompts: 0, replies: 1, tin: 10, tout: 5, cache: 0, cost: 0 } }, hours: new Array(168).fill(0), tools: { Bash: 5 }, sessions: [{ provider: 'claude', id: 's', start: 1, end: 2, project: 'app', prompts: 2, tokens: 15 }] }
    ], [], false, { done: 1, total: 1 }, zero)
    const g = buildBrain(a, [{ id: 1, category: 'hardware', key: 'cpu', value: 'Ryzen', conversationId: null, provider: 'claude', updatedAt: 1 }], [], [])
    const ids = new Set(g.nodes.map((n) => n.id))
    for (const id of ['core', 'p:claude', 'm:claude-x', 'r:app', 't:Bash', 'c:hardware', 'f:1']) expect(ids.has(id)).toBe(true)
    expect(g.links.every((l) => ids.has(l.a) && ids.has(l.b))).toBe(true)
  })
})

import { streaks, dailyTotals, recap } from '../src/renderer/src/lib/stats'
describe('streaks', () => {
  const day = (s: string) => ({ day: s, provider: 'claude' as const, model: 'm', prompts: 1, replies: 1, tin: 1, tout: 1, cache: 0, cost: 0 })
  it('counts the current streak, keeps it alive until end of today, and finds the longest', () => {
    const today = new Date(2026, 2, 10)
    const s = streaks(['2026-03-09', '2026-03-08', '2026-03-07', '2026-03-01', '2026-03-02'].map(day), today)
    expect(s).toMatchObject({ current: 3, longest: 3, activeDays: 5, todayActive: false })
    expect(streaks(['2026-03-10', '2026-03-09'].map(day), today).current).toBe(2)
    expect(streaks(['2026-03-05'].map(day), today).current).toBe(0) // gap of more than a day breaks it
    expect(streaks([], today)).toMatchObject({ current: 0, longest: 0 })
  })
  it('builds a zero-filled daily series and a recap', () => {
    const a = buildAnalytics([{ provider: 'claude', days: { '2026-03-09|m': { prompts: 2, replies: 2, tin: 100, tout: 50, cache: 0, cost: 0 } }, hours: new Array(168).fill(0), tools: { Bash: 3 }, sessions: [{ provider: 'claude', id: 's', start: new Date(2026, 2, 9).getTime(), end: new Date(2026, 2, 9, 12).getTime(), project: 'app', prompts: 2, tokens: 150 }] }], [], false, { done: 1, total: 1 }, zero)
    const d = dailyTotals(a, 7, new Date(2026, 2, 10))
    expect(d).toHaveLength(7)
    expect(d.find((x) => x.day === '2026-03-09')?.tokens).toBe(150)
    expect(recap(a, d).join(' ')).toMatch(/1 chat/)
  })
})
