import type { ModelInfo, ProviderStatus, SkillInfo } from '@shared/types'
import type { FileDiff, NormalizedEvent } from '@shared/events'
import { compareVersions, exec, killTree, parseVersion, spawnTracked, stripAnsi } from '../services/proc'
import { JsonRpcStdio } from '../services/jsonrpc'
import { displayPath, makePatch } from './diffs'
import type { ProviderAdapter, RunContext, RunHandle } from './types'

const MIN_VERSION = '0.100.0'
const CLIENT_INFO = { name: 'clivra', title: 'Clivra', version: '0.1.0' }

function spawnServer(exe: string, cwd: string) {
  return spawnTracked(exe, ['app-server'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
}

/** Run `fn` against a short-lived app-server connection. */
async function withServer<T>(exe: string, cwd: string, fn: (rpc: JsonRpcStdio) => Promise<T>): Promise<T> {
  const child = spawnServer(exe, cwd)
  const rpc = new JsonRpcStdio(child, {
    onNotification: () => undefined,
    onRequest: (id) => rpc.respondError(id, 'Not supported by this client')
  })
  try {
    await rpc.request('initialize', { clientInfo: CLIENT_INFO, capabilities: null }, 20_000)
    rpc.notify('initialized')
    return await fn(rpc)
  } finally {
    killTree(child, 'SIGKILL')
  }
}

export function codexSandbox(mode: RunContext['permissionMode'], cwd: string) {
  switch (mode) {
    case 'full':
      return { approval: 'never', sandboxMode: 'danger-full-access', policy: { type: 'dangerFullAccess' } }
    case 'plan':
      return { approval: 'on-request', sandboxMode: 'read-only', policy: { type: 'readOnly', networkAccess: false } }
    case 'auto-edit':
      return { approval: 'on-request', sandboxMode: 'workspace-write', policy: { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } }
    default:
      return { approval: 'untrusted', sandboxMode: 'workspace-write', policy: { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } }
  }
}

function normalizeCodexDiff(path: string, kind: string, diff: string): FileDiff {
  const k: FileDiff['kind'] = kind === 'add' ? 'add' : kind === 'delete' ? 'delete' : 'update'
  if (/^(---|@@|diff )/m.test(diff)) {
    const hasHeader = /^---/m.test(diff)
    return { path, kind: k, diff: hasHeader ? diff : `--- a/${path}\n+++ b/${path}\n${diff}` }
  }
  // Raw content for added / deleted files.
  return k === 'delete' ? makePatch(path, diff, '', 'delete') : makePatch(path, '', diff, 'add')
}

export const codexAdapter: ProviderAdapter = {
  id: 'codex',

  async detect(exe) {
    const base: ProviderStatus = {
      id: 'codex',
      name: 'Codex CLI',
      state: 'missing',
      executable: exe,
      version: null,
      minVersion: MIN_VERSION,
      account: null,
      message: 'OpenAI Codex CLI was not found on this machine.',
      setup: { installCommand: 'npm i -g @openai/codex   # or: brew install codex', loginCommand: 'codex login', docsUrl: 'https://developers.openai.com/codex/cli' },
      capabilities: {
        models: true, effort: true, resume: true, skills: true, skillToggle: true, permissions: true,
        planMode: false, attachments: true, streaming: true,
        limitations: ['Codex has no dedicated plan mode; “Plan” runs with a read-only sandbox instead.', 'Interactive questions from the agent (request_user_input) are not supported yet.']
      },
      checkedAt: Date.now()
    }
    if (!exe) return base
    const v = await exec(exe, ['--version'], { timeout: 10_000 })
    if (v.code !== 0) return { ...base, state: 'error', message: 'Codex failed to run.', detail: (v.stderr || v.error || '').slice(0, 500) }
    const version = parseVersion(v.stdout)
    base.version = version
    const help = await exec(exe, ['app-server', '--help'], { timeout: 10_000 })
    if (help.code !== 0) return { ...base, state: 'update-recommended', message: 'This Codex version has no `app-server` interface. Please update Codex.' }
    const login = await exec(exe, ['login', 'status'], { timeout: 15_000 })
    const out = stripAnsi(`${login.stdout}\n${login.stderr}`).trim()
    if (login.code !== 0) return { ...base, state: 'unauthenticated', message: 'Codex is installed but not signed in.', detail: out }
    base.account = out.replace(/^logged in\s*(using)?\s*/i, '').trim() || 'signed in'
    if (version && compareVersions(version, MIN_VERSION) < 0) {
      return { ...base, state: 'update-recommended', message: `Version ${version} is older than the recommended ${MIN_VERSION}.` }
    }
    return { ...base, state: 'ready', message: 'Ready.' }
  },

  async listModels(exe, cwd) {
    return withServer(exe, cwd, async (rpc) => {
      const out: ModelInfo[] = []
      let cursor: string | null = null
      do {
        const res: any = await rpc.request('model/list', cursor ? { cursor } : {})
        for (const m of res.data ?? []) {
          if (m.hidden) continue
          out.push({
            id: m.model ?? m.id,
            name: m.displayName ?? m.id,
            description: m.description,
            provider: 'codex',
            efforts: (m.supportedReasoningEfforts ?? []).map((e: any) => e.reasoningEffort),
            defaultEffort: m.defaultReasoningEffort,
            isDefault: !!m.isDefault,
            supportsImages: (m.inputModalities ?? []).includes('image')
          })
        }
        cursor = res.nextCursor ?? null
      } while (cursor)
      return out
    })
  },

  async listSkills(exe, cwd) {
    return withServer(exe, cwd, async (rpc) => {
      const res: any = await rpc.request('skills/list', { cwds: [cwd] })
      const out: SkillInfo[] = []
      for (const entry of res.data ?? []) {
        for (const s of entry.skills ?? []) {
          out.push({
            id: s.path ?? s.name,
            name: s.name,
            description: s.shortDescription ?? s.description ?? '',
            provider: 'codex',
            source: typeof s.scope === 'string' ? s.scope : JSON.stringify(s.scope ?? 'user'),
            path: s.path,
            enabled: s.enabled !== false,
            toggleable: true,
            kind: 'skill'
          })
        }
      }
      return out
    })
  },

  async setSkillEnabled(exe, cwd, skill, enabled) {
    await withServer(exe, cwd, (rpc) => rpc.request('skills/config/write', { path: skill.path ?? null, name: skill.path ? null : skill.name, enabled }))
  },

  start(ctx) {
    return startCodexRun(ctx)
  }
}

function startCodexRun(ctx: RunContext): RunHandle {
  const child = spawnServer(ctx.executable, ctx.cwd)
  const sb = codexSandbox(ctx.permissionMode, ctx.cwd)
  const emit = (e: NormalizedEvent) => ctx.emit(e)

  let threadId = ''
  let turnId = ''
  let finished = false
  let cancelled = false
  let stderr = ''
  let state = ''
  const streamed = new Set<string>()
  const summaryIndex = new Map<string, number>()
  const pendingApprovals = new Map<string, { rpcId: number | string; method: string }>()

  let resolveDone!: () => void
  const done = new Promise<void>((r) => (resolveDone = r))
  const finish = (ev: NormalizedEvent) => {
    if (finished) return
    finished = true
    emit(ev)
    resolveDone()
    setTimeout(() => killTree(child, 'SIGKILL'), 300)
  }
  const setState = (s: 'thinking' | 'responding' | 'executing' | 'waiting_approval', detail?: string) => {
    const key = `${s}:${detail ?? ''}`
    if (key === state) return
    state = key
    emit({ type: 'status', state: s, detail })
  }

  const startItem = (item: any) => {
    switch (item.type) {
      case 'commandExecution':
        emit({ type: 'tool.start', toolId: item.id, name: 'shell', kind: 'bash', title: item.command, input: { command: item.command, cwd: item.cwd } })
        setState('executing', item.command)
        break
      case 'fileChange':
        emit({ type: 'tool.start', toolId: item.id, name: 'apply_patch', kind: 'edit', title: (item.changes ?? []).map((c: any) => displayPath(c.path, ctx.cwd)).join(', ') || 'Edit files' })
        for (const c of item.changes ?? []) emit({ type: 'file.change', toolId: item.id, diff: normalizeCodexDiff(displayPath(c.path, ctx.cwd), c.kind?.type, c.diff ?? '') })
        setState('executing', 'Editing files')
        break
      case 'mcpToolCall':
        emit({ type: 'tool.start', toolId: item.id, name: `${item.server}.${item.tool}`, kind: 'mcp', title: `${item.server} › ${item.tool}`, input: item.arguments })
        setState('executing', `${item.server} › ${item.tool}`)
        break
      case 'dynamicToolCall':
        emit({ type: 'tool.start', toolId: item.id, name: item.tool, kind: 'other', title: item.tool, input: item.arguments })
        setState('executing', item.tool)
        break
      case 'webSearch':
        emit({ type: 'tool.start', toolId: item.id, name: 'web_search', kind: 'fetch', title: item.query ? `Web search “${item.query}”` : 'Web search' })
        setState('executing', 'Searching the web')
        break
      case 'collabAgentToolCall':
        emit({ type: 'tool.start', toolId: item.id, name: item.tool, kind: 'agent', title: item.prompt ?? 'Sub-agent task' })
        break
      case 'reasoning':
        setState('thinking')
        break
    }
  }

  const completeItem = (item: any) => {
    const ok = (s: string) => (s === 'completed' ? 'done' : 'error')
    switch (item.type) {
      case 'agentMessage':
        if (!streamed.has(item.id) && item.text) emit({ type: 'text.delta', blockId: item.id, text: item.text })
        break
      case 'reasoning':
        if (!streamed.has(item.id)) {
          const text = (item.summary?.length ? item.summary : item.content ?? []).join('\n\n')
          if (text) emit({ type: 'thinking.delta', blockId: item.id, text })
        }
        break
      case 'commandExecution': {
        const exit = item.exitCode != null ? `\n[exit ${item.exitCode}]` : ''
        emit({ type: 'tool.end', toolId: item.id, status: ok(item.status), output: item.aggregatedOutput ? item.aggregatedOutput + exit : undefined })
        break
      }
      case 'fileChange':
        for (const c of item.changes ?? []) emit({ type: 'file.change', toolId: item.id, diff: normalizeCodexDiff(displayPath(c.path, ctx.cwd), c.kind?.type, c.diff ?? '') })
        emit({ type: 'tool.end', toolId: item.id, status: ok(item.status) })
        break
      case 'mcpToolCall':
        emit({ type: 'tool.end', toolId: item.id, status: ok(item.status), output: item.error?.message ?? (item.result ? JSON.stringify(item.result.content ?? item.result).slice(0, 8000) : undefined) })
        break
      case 'dynamicToolCall':
        emit({ type: 'tool.end', toolId: item.id, status: item.success === false ? 'error' : 'done', output: (item.contentItems ?? []).map((c: any) => c.text ?? '').join('\n') || undefined })
        break
      case 'webSearch':
      case 'collabAgentToolCall':
        emit({ type: 'tool.end', toolId: item.id, status: 'done' })
        break
    }
  }

  const rpc: JsonRpcStdio = new JsonRpcStdio(child, {
    onParseError: (l) => (stderr = (stderr + '\n' + l).slice(-4000)),
    onNotification(method, p) {
      if (finished) return
      switch (method) {
        case 'turn/started':
          if (p?.turn?.id) turnId = p.turn.id
          setState('thinking')
          break
        case 'item/started':
          startItem(p.item)
          break
        case 'item/completed':
          completeItem(p.item)
          setState('thinking')
          break
        case 'item/agentMessage/delta':
          streamed.add(p.itemId)
          setState('responding')
          emit({ type: 'text.delta', blockId: p.itemId, text: p.delta })
          break
        case 'item/reasoning/summaryTextDelta':
        case 'item/reasoning/textDelta': {
          streamed.add(p.itemId)
          const idx = p.summaryIndex ?? p.contentIndex ?? 0
          const prev = summaryIndex.get(p.itemId)
          summaryIndex.set(p.itemId, idx)
          setState('thinking')
          emit({ type: 'thinking.delta', blockId: p.itemId, text: (prev !== undefined && prev !== idx ? '\n\n' : '') + p.delta })
          break
        }
        case 'item/commandExecution/outputDelta':
          emit({ type: 'tool.output', toolId: p.itemId, text: p.delta })
          break
        case 'item/fileChange/patchUpdated':
          for (const c of p.changes ?? []) emit({ type: 'file.change', toolId: p.itemId, diff: normalizeCodexDiff(displayPath(c.path, ctx.cwd), c.kind?.type, c.diff ?? '') })
          break
        case 'thread/tokenUsage/updated': {
          const t = p.tokenUsage?.total ?? p.usage?.total
          if (t) emit({ type: 'usage', usage: { inputTokens: t.inputTokens, outputTokens: t.outputTokens } })
          break
        }
        case 'warning':
        case 'configWarning':
        case 'deprecationNotice':
          // Environment warnings (e.g. missing bubblewrap) are surfaced without failing the run.
          if (p?.summary || p?.message) emit({ type: 'notice', level: 'warning', message: String(p.summary ?? p.message) })
          break
        case 'error': {
          const msg = p?.error?.message ?? 'Codex reported an error.'
          if (p?.willRetry) emit({ type: 'notice', level: 'warning', message: `${msg} Retrying…` })
          else finish({ type: 'run.error', message: msg, code: /auth|login|401/i.test(msg) ? 'auth' : undefined })
          break
        }
        case 'turn/completed': {
          const t = p?.turn
          if (t?.status === 'failed') finish({ type: 'run.error', message: t.error?.message ?? 'The turn failed.' })
          else finish({ type: 'run.completed', reason: t?.status === 'interrupted' || cancelled ? 'cancelled' : 'complete' })
          break
        }
      }
    },
    onRequest(id, method, p) {
      if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
        const isCmd = method === 'item/commandExecution/requestApproval'
        const requestId = `${p.itemId}:${id}`
        pendingApprovals.set(requestId, { rpcId: id, method })
        const title = isCmd ? `Run command: ${p.command ?? 'command'}` : 'Apply file changes'
        const options = [{ id: 'accept', label: 'Allow once', kind: 'allow_once' as const }, { id: 'acceptForSession', label: 'Allow for this session', kind: 'allow_always' as const }, { id: 'decline', label: 'Deny', kind: 'deny' as const }]
        emit({ type: 'permission.request', requestId, toolId: p.itemId, title, detail: p.reason ?? (p.cwd ? `in ${p.cwd}` : undefined), kind: isCmd ? 'bash' : 'edit', options })
        setState('waiting_approval', title)
        return
      }
      // Anything we cannot present to the user is refused instead of being silently granted.
      rpc.respondError(id, `Clivra does not support the “${method}” request yet`)
      emit({ type: 'notice', level: 'warning', message: `Codex asked for “${method}”, which this app can not answer yet; it was declined.` })
    }
  })

  child.stderr?.on('data', (d) => (stderr = (stderr + d).slice(-4000)))
  child.once('error', (e) => finish({ type: 'run.error', message: `Could not start Codex: ${e.message}`, code: 'spawn' }))
  child.once('close', (code, signal) => {
    if (finished) return resolveDone()
    if (cancelled) return finish({ type: 'run.completed', reason: 'cancelled' })
    const tail = stderr.trim().split('\n').slice(-5).join('\n')
    finish({ type: 'run.error', message: `Codex exited ${signal ? `(${signal})` : `with code ${code}`} before finishing.${tail ? `\n${tail}` : ''}`, code: 'exit', recoverable: true })
  })

  void (async () => {
    try {
      await rpc.request('initialize', { clientInfo: CLIENT_INFO, capabilities: null }, 20_000)
      rpc.notify('initialized')
      const acct: any = await rpc.request('account/read', { refreshToken: false }, 20_000).catch(() => null)
      if (acct && !acct.account && acct.requiresOpenaiAuth) {
        return finish({ type: 'run.error', message: 'Codex is not signed in. Run `codex login` in a terminal, then try again.', code: 'auth' })
      }
      const common = {
        model: ctx.model,
        cwd: ctx.cwd,
        approvalPolicy: sb.approval,
        sandbox: sb.sandboxMode,
        developerInstructions: ctx.instructions.trim() || null
      }
      const started: any = ctx.providerSessionId
        ? await rpc.request('thread/resume', { threadId: ctx.providerSessionId, ...common })
        : await rpc.request('thread/start', common)
      threadId = started.thread.id
      emit({ type: 'session', providerSessionId: threadId })
      emit({ type: 'run.started', provider: 'codex', model: started.model })
      const input: any[] = []
      let text = ctx.prompt
      const files: string[] = []
      for (const a of ctx.attachments) {
        if (a.kind === 'image') input.push({ type: 'localImage', path: a.path })
        else files.push(a.path)
      }
      if (files.length) text += `\n\nAttached files:\n${files.map((f) => `- ${f}`).join('\n')}`
      input.unshift({ type: 'text', text, text_elements: [] })
      const res: any = await rpc.request('turn/start', {
        threadId,
        input,
        cwd: ctx.cwd,
        approvalPolicy: sb.approval,
        sandboxPolicy: sb.policy,
        model: ctx.model,
        effort: ctx.effort
      })
      if (res?.turn?.id) turnId = res.turn.id
      if (cancelled && turnId) void rpc.request('turn/interrupt', { threadId, turnId }).catch(() => undefined)
    } catch (e) {
      const msg = (e as Error).message
      finish({ type: 'run.error', message: msg, code: /auth|login|401/i.test(msg) ? 'auth' : undefined })
    }
  })()

  return {
    done,
    respondPermission(requestId, optionId) {
      const p = pendingApprovals.get(requestId)
      if (!p) return
      pendingApprovals.delete(requestId)
      rpc.respond(p.rpcId, { decision: optionId })
      emit({ type: 'permission.resolved', requestId, optionId })
      setState('executing')
    },
    async cancel() {
      if (finished) return
      cancelled = true
      // Decline anything awaiting approval so the turn can unwind, then interrupt.
      for (const [rid, p] of pendingApprovals) {
        rpc.respond(p.rpcId, { decision: 'cancel' })
        emit({ type: 'permission.resolved', requestId: rid, optionId: 'decline' })
      }
      pendingApprovals.clear()
      if (threadId && turnId) void rpc.request('turn/interrupt', { threadId, turnId }, 5000).catch(() => undefined)
      const t1 = setTimeout(() => finish({ type: 'run.completed', reason: 'cancelled' }), 3000)
      await done
      clearTimeout(t1)
      killTree(child, 'SIGKILL')
    }
  }
}
