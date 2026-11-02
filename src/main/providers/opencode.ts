import { randomBytes } from 'node:crypto'
import { extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ModelInfo, ProviderStatus, SkillInfo } from '@shared/types'
import type { NormalizedEvent, ToolKind } from '@shared/events'
import { compareVersions, exec, killTree, LineSplitter, parseVersion, spawnTracked, stripAnsi } from '../services/proc'
import { displayPath, makePatch } from './diffs'
import type { ProviderAdapter, RunContext, RunHandle } from './types'

const MIN_VERSION = '1.0.0'
const IDLE_SHUTDOWN_MS = 5 * 60_000

/** One lazily started, password-protected loopback `opencode serve` shared by all runs. */
class OpenCodeServer {
  private child?: ReturnType<typeof spawnTracked>
  private starting?: Promise<void>
  baseUrl = ''
  private password = randomBytes(18).toString('hex')
  private idleTimer?: NodeJS.Timeout
  private active = 0
  exe = ''

  get headers(): Record<string, string> {
    return { authorization: 'Basic ' + Buffer.from(`opencode:${this.password}`).toString('base64') }
  }

  async ensure(exe: string): Promise<void> {
    if (this.child && this.exe !== exe) await this.stop()
    this.exe = exe
    if (this.child && this.child.exitCode === null && this.baseUrl) return
    this.starting ??= this.boot(exe).finally(() => (this.starting = undefined))
    return this.starting
  }

  private boot(exe: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawnTracked(exe, ['serve', '--port', '0', '--hostname', '127.0.0.1'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, OPENCODE_SERVER_PASSWORD: this.password, OPENCODE_SERVER_USERNAME: 'opencode' }
      })
      this.child = child
      const split = new LineSplitter()
      let out = ''
      const timer = setTimeout(() => {
        killTree(child, 'SIGKILL')
        reject(new Error(`OpenCode server did not start in time.\n${out.slice(-500)}`))
      }, 30_000)
      const onData = (d: Buffer) => {
        out += d
        split.push(d, (line) => {
          const m = stripAnsi(line).match(/listening on (https?:\/\/[^\s]+)/)
          if (m && !this.baseUrl) {
            this.baseUrl = m[1]
            clearTimeout(timer)
            resolve()
          }
        })
      }
      child.stdout?.on('data', onData)
      child.stderr?.on('data', onData)
      child.once('error', (e) => (clearTimeout(timer), reject(e)))
      child.once('exit', () => {
        clearTimeout(timer)
        this.child = undefined
        this.baseUrl = ''
        reject(new Error(`OpenCode server exited early.\n${out.slice(-500)}`))
      })
    })
  }

  acquire(): void {
    this.active++
    if (this.idleTimer) clearTimeout(this.idleTimer)
  }

  release(): void {
    this.active = Math.max(0, this.active - 1)
    this.touch()
  }

  /** Re-arm the idle shutdown timer after any use. */
  touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    if (this.active === 0) this.idleTimer = setTimeout(() => void this.stop(), IDLE_SHUTDOWN_MS)
  }

  async stop(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    const c = this.child
    this.child = undefined
    this.baseUrl = ''
    killTree(c, 'SIGTERM')
    setTimeout(() => killTree(c, 'SIGKILL'), 2000).unref()
  }

  async api<T = any>(exe: string, method: string, path: string, cwd: string | undefined, body?: unknown, timeoutMs = 30_000): Promise<T> {
    await this.ensure(exe)
    this.touch()
    const url = new URL(path, this.baseUrl)
    if (cwd) url.searchParams.set('directory', cwd)
    const res = await fetch(url, {
      method,
      headers: { ...this.headers, ...(body ? { 'content-type': 'application/json' } : {}), ...(cwd ? { 'x-opencode-directory': encodeURIComponent(cwd) } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) throw new Error(`OpenCode ${method} ${path} → ${res.status} ${(await res.text()).slice(0, 300)}`)
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }
}

export const opencodeServer = new OpenCodeServer()

export function opencodeRules(mode: RunContext['permissionMode'], disabledSkills: string[]) {
  const rules: { permission: string; pattern: string; action: 'allow' | 'ask' | 'deny' }[] = []
  if (mode === 'full') rules.push({ permission: '*', pattern: '*', action: 'allow' })
  else {
    rules.push({ permission: 'edit', pattern: '*', action: mode === 'auto-edit' ? 'allow' : 'ask' })
    rules.push({ permission: 'bash', pattern: '*', action: 'ask' })
    rules.push({ permission: 'webfetch', pattern: '*', action: 'ask' })
  }
  for (const s of disabledSkills) rules.push({ permission: 'skill', pattern: s, action: 'deny' })
  return rules
}

const TOOL_KIND: Record<string, ToolKind> = {
  bash: 'bash', read: 'read', edit: 'edit', write: 'write', patch: 'edit', apply_patch: 'edit', multiedit: 'edit',
  glob: 'search', grep: 'search', list: 'search', webfetch: 'fetch', websearch: 'fetch', codesearch: 'fetch',
  task: 'agent', todowrite: 'todo', todoread: 'todo'
}

function toolTitle(tool: string, input: any, state: any, cwd: string): string {
  const i = input ?? {}
  if (tool === 'bash') return i.command ?? state?.title ?? 'Run command'
  const file = i.filePath ?? i.path
  if (file) return displayPath(String(file), cwd)
  if (i.pattern) return String(i.pattern)
  if (i.url) return String(i.url)
  return state?.title || tool
}

export const opencodeAdapter: ProviderAdapter = {
  id: 'opencode',

  async detect(exe) {
    const base: ProviderStatus = {
      id: 'opencode',
      name: 'OpenCode',
      state: 'missing',
      executable: exe,
      version: null,
      minVersion: MIN_VERSION,
      account: null,
      message: 'OpenCode was not found on this machine.',
      setup: { installCommand: 'curl -fsSL https://opencode.ai/install | bash   # or: npm i -g opencode-ai', loginCommand: 'opencode providers login', docsUrl: 'https://opencode.ai/docs' },
      capabilities: {
        models: true, effort: true, resume: true, skills: true, skillToggle: true, permissions: true,
        planMode: true, attachments: true, streaming: true,
        limitations: ['Reasoning effort maps to the model “variants” OpenCode reports; models without variants have no effort setting.']
      },
      checkedAt: Date.now()
    }
    if (!exe) return base
    const v = await exec(exe, ['--version'], { timeout: 15_000 })
    if (v.code !== 0) return { ...base, state: 'error', message: 'OpenCode failed to run.', detail: (v.stderr || v.error || '').slice(0, 500) }
    const version = parseVersion(v.stdout)
    base.version = version
    const help = await exec(exe, ['serve', '--help'], { timeout: 15_000 })
    if (help.code !== 0) return { ...base, state: 'update-recommended', message: 'This OpenCode version has no `serve` interface. Please update OpenCode.' }
    const list = stripAnsi((await exec(exe, ['providers', 'list'], { timeout: 15_000 })).stdout)
    const creds = Number(list.match(/(\d+)\s+credentials?/i)?.[1] ?? 0)
    const envs = list.split('\n').filter((l) => l.trim().startsWith('•')).length
    if (creds + envs > 0) {
      base.account = `${creds} credential${creds === 1 ? '' : 's'}${envs ? `, ${envs} from environment` : ''}`
    } else {
      // No credentials: ask the server which providers are actually connected (OpenCode ships free models).
      try {
        const p = await opencodeServer.api(exe, 'GET', '/provider', undefined, undefined, 40_000)
        const connected: string[] = p.connected ?? []
        if (!connected.length) return { ...base, state: 'unauthenticated', message: 'OpenCode has no connected model provider.' }
        base.account = `built-in: ${connected.join(', ')}`
        if (connected.length === 1 && connected[0] === 'opencode') base.message = 'Ready (using OpenCode’s built-in free models, which may be rate limited).'
      } catch (e) {
        return { ...base, state: 'error', message: 'Could not query the OpenCode server.', detail: (e as Error).message }
      }
    }
    if (version && compareVersions(version, MIN_VERSION) < 0) {
      return { ...base, state: 'update-recommended', message: `Version ${version} is older than the recommended ${MIN_VERSION}.` }
    }
    return { ...base, state: 'ready', message: base.message.startsWith('Ready') ? base.message : 'Ready.' }
  },

  async listModels(exe, cwd) {
    const res = await opencodeServer.api(exe, 'GET', '/provider', cwd, undefined, 40_000)
    const connected = new Set<string>(res.connected ?? [])
    const out: ModelInfo[] = []
    for (const p of res.all ?? []) {
      if (!connected.has(p.id)) continue
      for (const m of Object.values<any>(p.models ?? {})) {
        if (m.status && m.status !== 'active') continue
        out.push({
          id: `${p.id}/${m.id}`,
          name: m.name ?? m.id,
          description: p.name,
          group: p.name ?? p.id,
          provider: 'opencode',
          efforts: Object.keys(m.variants ?? {}),
          isDefault: res.default?.[p.id] === m.id,
          supportsImages: !!m.capabilities?.input?.image
        })
      }
    }
    return out
  },

  async listSkills(exe, cwd, disabled) {
    const res = await opencodeServer.api<any[]>(exe, 'GET', '/skill', cwd)
    return (res ?? []).map(
      (s): SkillInfo => ({
        id: s.name,
        name: s.name,
        description: s.description ?? '',
        provider: 'opencode',
        source: s.location ?? 'config',
        path: s.location,
        enabled: !disabled.includes(s.name),
        toggleable: true,
        kind: 'skill'
      })
    )
  },

  start(ctx) {
    return startOpenCodeRun(ctx)
  },

  async shutdown() {
    await opencodeServer.stop()
  }
}

function startOpenCodeRun(ctx: RunContext): RunHandle {
  const exe = ctx.executable
  const emit = (e: NormalizedEvent) => ctx.emit(e)
  const abort = new AbortController()
  let sessionId = ''
  let finished = false
  let cancelled = false
  let sawBusy = false
  let state = ''
  const roles = new Map<string, string>()
  const emitted = new Map<string, number>()
  const partType = new Map<string, string>()
  const toolSeen = new Map<string, string>()
  const noticed = new Set<string>()
  const pendingPerms = new Set<string>()

  let resolveDone!: () => void
  const done = new Promise<void>((r) => (resolveDone = r))
  const finish = (ev: NormalizedEvent) => {
    if (finished) return
    finished = true
    abort.abort()
    emit(ev)
    opencodeServer.release()
    resolveDone()
  }
  const setState = (s: 'thinking' | 'responding' | 'executing' | 'waiting_approval', detail?: string) => {
    const key = `${s}:${detail ?? ''}`
    if (key === state) return
    state = key
    emit({ type: 'status', state: s, detail })
  }

  const api = (method: string, path: string, body?: unknown) => opencodeServer.api(exe, method, path, ctx.cwd, body)

  const pushText = (partId: string, full: string, kind: 'text' | 'thinking') => {
    const have = emitted.get(partId) ?? 0
    if (full.length <= have) return
    const chunk = full.slice(have)
    emitted.set(partId, full.length)
    if (kind === 'text') {
      setState('responding')
      emit({ type: 'text.delta', blockId: partId, text: chunk })
    } else {
      setState('thinking')
      emit({ type: 'thinking.delta', blockId: partId, text: chunk })
    }
  }

  const handleToolPart = (part: any) => {
    const st = part.state ?? {}
    const kind = TOOL_KIND[part.tool] ?? (String(part.tool).includes('_') ? 'mcp' : 'other')
    const title = toolTitle(part.tool, st.input, st, ctx.cwd)
    const prev = toolSeen.get(part.callID)
    if (!prev) {
      emit({ type: 'tool.start', toolId: part.callID, name: part.tool, kind, title, input: st.input })
      setState('executing', title)
    } else if (st.input && Object.keys(st.input).length) {
      emit({ type: 'tool.input', toolId: part.callID, title, input: st.input })
    }
    if (st.status === 'completed' || st.status === 'error') {
      if (prev === st.status) return
      const md = st.metadata ?? {}
      if (st.status === 'completed' && kind !== 'bash') {
        const fd = md.filediff
        if (fd?.file && typeof fd.before === 'string' && typeof fd.after === 'string') {
          emit({ type: 'file.change', toolId: part.callID, diff: makePatch(displayPath(fd.file, ctx.cwd), fd.before, fd.after, fd.before === '' ? 'add' : 'update') })
        } else if (typeof md.diff === 'string' && md.diff.trim()) {
          emit({ type: 'file.change', toolId: part.callID, diff: { path: title, kind: 'update', diff: md.diff } })
        }
      }
      emit({ type: 'tool.end', toolId: part.callID, status: st.status === 'error' ? 'error' : 'done', output: st.status === 'error' ? String(st.error ?? '') : String(st.output ?? '') })
      setState('thinking')
    }
    toolSeen.set(part.callID, st.status ?? 'pending')
  }

  const onEvent = (ev: { type: string; properties: any }) => {
    const p = ev.properties ?? {}
    const sid = p.sessionID ?? p.part?.sessionID ?? p.info?.sessionID
    if (sid && sid !== sessionId) return
    switch (ev.type) {
      case 'message.updated': {
        roles.set(p.info.id, p.info.role)
        const err = p.info.error
        if (err && p.info.role === 'assistant') {
          const msg = err.data?.message ?? err.name ?? 'The model returned an error.'
          if (err.name === 'MessageAbortedError') finish({ type: 'run.completed', reason: 'cancelled' })
          else finish({ type: 'run.error', message: msg, code: err.name === 'ProviderAuthError' ? 'auth' : err.name })
        }
        if (p.info.role === 'assistant' && p.info.tokens) {
          emit({ type: 'usage', usage: { inputTokens: p.info.tokens.input, outputTokens: p.info.tokens.output, costUsd: p.info.cost } })
        }
        break
      }
      case 'message.part.updated': {
        const part = p.part
        partType.set(part.id, part.type)
        if (roles.get(part.messageID) === 'user') return
        if (part.type === 'text') pushText(part.id, part.text ?? '', 'text')
        else if (part.type === 'reasoning') pushText(part.id, part.text ?? '', 'thinking')
        else if (part.type === 'tool') handleToolPart(part)
        break
      }
      case 'message.part.delta': {
        if (roles.get(p.messageID) === 'user') return
        const kind = partType.get(p.partID)
        if (p.field !== 'text' || (kind !== 'text' && kind !== 'reasoning')) return
        const have = emitted.get(p.partID) ?? 0
        emitted.set(p.partID, have + p.delta.length)
        if (kind === 'text') {
          setState('responding')
          emit({ type: 'text.delta', blockId: p.partID, text: p.delta })
        } else {
          setState('thinking')
          emit({ type: 'thinking.delta', blockId: p.partID, text: p.delta })
        }
        break
      }
      case 'session.status': {
        const s = p.status
        if (s?.type === 'busy') {
          sawBusy = true
          if (!state) setState('thinking')
        } else if (s?.type === 'retry') {
          sawBusy = true
          const key = `${s.attempt}:${s.message}`
          if (!noticed.has(key)) {
            noticed.add(key)
            emit({
              type: 'notice',
              level: 'warning',
              message: s.action?.message ?? s.message ?? 'The provider asked OpenCode to retry.',
              action: s.action?.link ? { label: s.action.label ?? 'Open', url: s.action.link } : undefined
            })
          }
          setState('thinking', 'Waiting to retry…')
        }
        break
      }
      case 'session.idle':
        if (sawBusy) finish({ type: 'run.completed', reason: cancelled ? 'cancelled' : 'complete' })
        break
      case 'session.error': {
        const err = p.error ?? {}
        if (err.name === 'MessageAbortedError' || cancelled) finish({ type: 'run.completed', reason: 'cancelled' })
        else finish({ type: 'run.error', message: err.data?.message ?? err.name ?? 'OpenCode reported an error.', code: err.name === 'ProviderAuthError' ? 'auth' : err.name })
        break
      }
      case 'permission.asked': {
        pendingPerms.add(p.id)
        const meta = p.metadata ?? {}
        const detail = meta.command ?? meta.filepath ?? meta.diff ?? (p.patterns ?? []).join('\n')
        const kind: ToolKind = p.permission === 'bash' ? 'bash' : p.permission === 'edit' ? 'edit' : p.permission === 'webfetch' ? 'fetch' : 'other'
        emit({
          type: 'permission.request',
          requestId: p.id,
          toolId: p.tool?.callID,
          title: `${p.permission}: ${(p.patterns ?? []).join(', ') || 'request'}`,
          detail: typeof detail === 'string' ? detail.slice(0, 4000) : undefined,
          kind,
          options: [
            { id: 'once', label: 'Allow once', kind: 'allow_once' },
            { id: 'always', label: 'Always allow', kind: 'allow_always' },
            { id: 'reject', label: 'Deny', kind: 'deny' }
          ]
        })
        setState('waiting_approval', p.permission)
        break
      }
      case 'question.asked':
        void api('POST', `/question/${p.id}/reject`).catch(() => undefined)
        emit({ type: 'notice', level: 'warning', message: 'OpenCode asked an interactive question, which this app can not answer yet; it was skipped.' })
        break
    }
  }

  async function pumpEvents(): Promise<void> {
    let attempts = 0
    while (!finished && attempts < 4) {
      try {
        const url = new URL('/event', opencodeServer.baseUrl)
        url.searchParams.set('directory', ctx.cwd)
        const res = await fetch(url, { headers: { ...opencodeServer.headers, 'x-opencode-directory': encodeURIComponent(ctx.cwd), accept: 'text/event-stream' }, signal: abort.signal })
        if (!res.ok || !res.body) throw new Error(`event stream ${res.status}`)
        attempts = 0
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        const split = new LineSplitter()
        for (;;) {
          const { value, done: d } = await reader.read()
          if (d) break
          split.push(dec.decode(value, { stream: true }), (line) => {
            if (!line.startsWith('data:')) return
            try {
              onEvent(JSON.parse(line.slice(5).trim()))
            } catch {
              /* ignore malformed frame */
            }
          })
        }
      } catch (e) {
        if (finished || abort.signal.aborted) return
        attempts++
        await new Promise((r) => setTimeout(r, 500 * attempts))
        if (attempts >= 4) finish({ type: 'run.error', message: `Lost connection to the OpenCode server: ${(e as Error).message}`, code: 'stream', recoverable: true })
      }
    }
  }

  opencodeServer.acquire()
  void (async () => {
    try {
      await opencodeServer.ensure(exe)
      // Subscribe before prompting so no early events are lost.
      void pumpEvents()
      const [pid, ...rest] = (ctx.model ?? '').split('/')
      const model = ctx.model && rest.length ? { providerID: pid, modelID: rest.join('/') } : undefined
      const body = { title: ctx.prompt.slice(0, 60), permission: opencodeRules(ctx.permissionMode, ctx.disabledSkills) }
      if (ctx.providerSessionId) {
        const ok = await api('GET', `/session/${ctx.providerSessionId}`).then(() => true).catch(() => false)
        if (ok) sessionId = ctx.providerSessionId
        else emit({ type: 'notice', level: 'warning', message: 'The previous OpenCode session no longer exists; started a fresh one.' })
      }
      if (!sessionId) sessionId = (await api('POST', '/session', body)).id
      else await api('PATCH', `/session/${sessionId}`, { permission: body.permission }).catch(() => undefined)
      emit({ type: 'session', providerSessionId: sessionId })
      emit({ type: 'run.started', provider: 'opencode', model: ctx.model ?? undefined })
      const parts: any[] = [{ type: 'text', text: ctx.prompt }]
      for (const a of ctx.attachments) {
        const ext = extname(a.path).toLowerCase()
        const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf' }[ext] ?? 'text/plain'
        parts.push({ type: 'file', mime, url: pathToFileURL(a.path).href, filename: a.name })
      }
      const instructions = ctx.instructions.trim()
      await api('POST', `/session/${sessionId}/prompt_async`, {
        ...(model ? { model } : {}),
        ...(ctx.effort ? { variant: ctx.effort } : {}),
        ...(ctx.permissionMode === 'plan' ? { agent: 'plan' } : {}),
        ...(instructions ? { system: instructions } : {}),
        parts
      })
    } catch (e) {
      finish({ type: 'run.error', message: `OpenCode: ${(e as Error).message}`, code: 'spawn' })
    }
  })()

  return {
    done,
    respondPermission(requestId, optionId) {
      if (!pendingPerms.delete(requestId)) return
      void api('POST', `/permission/${requestId}/reply`, { reply: optionId })
        .then(() => {
          emit({ type: 'permission.resolved', requestId, optionId })
          setState('executing')
        })
        .catch((e) => emit({ type: 'notice', level: 'error', message: `Could not send the permission answer: ${(e as Error).message}` }))
    },
    async cancel() {
      if (finished) return
      cancelled = true
      for (const id of pendingPerms) void api('POST', `/permission/${id}/reply`, { reply: 'reject' }).catch(() => undefined)
      pendingPerms.clear()
      if (sessionId) void api('POST', `/session/${sessionId}/abort`).catch(() => undefined)
      const t = setTimeout(() => finish({ type: 'run.completed', reason: 'cancelled' }), 4000)
      await done
      clearTimeout(t)
    }
  }
}
