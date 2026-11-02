import { readFile, stat } from 'node:fs/promises'
import { dirname, extname } from 'node:path'
import type { ModelInfo, ProviderStatus, SkillInfo } from '@shared/types'
import type { NormalizedEvent, PermissionOption, ToolKind } from '@shared/events'
import { LineSplitter, compareVersions, exec, killTree, parseVersion, spawnTracked } from '../services/proc'
import { claudeEditDiff, displayPath } from './diffs'
import type { ProviderAdapter, RunContext, RunHandle } from './types'

const MIN_VERSION = '2.0.0'

export function claudeToolMeta(name: string, input: any, cwd = ''): { kind: ToolKind; title: string } {
  const i = input ?? {}
  const p = (v?: string) => (v ? displayPath(v, cwd) : '')
  switch (name) {
    case 'Bash':
      return { kind: 'bash', title: i.command ?? i.description ?? 'Run command' }
    case 'Read':
      return { kind: 'read', title: p(i.file_path) || 'Read file' }
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { kind: 'edit', title: p(i.file_path ?? i.notebook_path) || 'Edit file' }
    case 'Write':
      return { kind: 'write', title: p(i.file_path) || 'Write file' }
    case 'Grep':
      return { kind: 'search', title: i.pattern ? `Search “${i.pattern}”` : 'Search' }
    case 'Glob':
      return { kind: 'search', title: i.pattern ? `Find ${i.pattern}` : 'Find files' }
    case 'WebFetch':
      return { kind: 'fetch', title: i.url ?? 'Fetch URL' }
    case 'WebSearch':
      return { kind: 'fetch', title: i.query ? `Web search “${i.query}”` : 'Web search' }
    case 'Task':
    case 'Agent':
      return { kind: 'agent', title: i.description ?? 'Run sub-agent' }
    case 'TodoWrite':
      return { kind: 'todo', title: 'Update task list' }
    default:
      if (name.startsWith('mcp__')) return { kind: 'mcp', title: name.replace(/^mcp__/, '').replace(/__/g, ' › ') }
      return { kind: 'other', title: name }
  }
}

const IMAGE_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (c?.type === 'text' ? c.text : c?.type === 'image' ? '[image]' : ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

type InitResponse = { models?: any[]; commands?: any[]; agents?: any[]; account?: any; claude_code_version?: string }
const initCache = new Map<string, { at: number; data: InitResponse }>()

/** Ask Claude Code itself (SDK control protocol) which models/commands/agents it supports. */
async function controlInitialize(exe: string, cwd: string): Promise<InitResponse> {
  const key = `${exe}|${cwd}`
  const hit = initCache.get(key)
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.data
  const data = await new Promise<InitResponse>((resolve, reject) => {
    const child = spawnTracked(
      exe,
      ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'plan'],
      { cwd, stdio: ['pipe', 'pipe', 'pipe'] }
    )
    const split = new LineSplitter()
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      killTree(child, 'SIGKILL')
      fn()
    }
    const timer = setTimeout(() => done(() => reject(new Error('Timed out waiting for Claude Code to initialize'))), 20_000)
    child.stdout?.on('data', (d) =>
      split.push(d, (line) => {
        try {
          const m = JSON.parse(line)
          if (m.type === 'control_response' && m.response?.request_id === 'clivra-init') {
            if (m.response.subtype === 'success') done(() => resolve(m.response.response ?? {}))
            else done(() => reject(new Error(m.response.error ?? 'initialize failed')))
          }
        } catch {
          /* ignore non-JSON */
        }
      })
    )
    child.once('error', (e) => done(() => reject(e)))
    child.once('exit', () => done(() => reject(new Error('Claude Code exited before initializing'))))
    child.stdin?.write(JSON.stringify({ type: 'control_request', request_id: 'clivra-init', request: { subtype: 'initialize' } }) + '\n')
  })
  initCache.set(key, { at: Date.now(), data })
  return data
}

export const claudeAdapter: ProviderAdapter = {
  id: 'claude',

  async detect(exe) {
    const base: ProviderStatus = {
      id: 'claude',
      name: 'Claude Code',
      state: 'missing',
      executable: exe,
      version: null,
      minVersion: MIN_VERSION,
      account: null,
      message: 'Claude Code was not found on this machine.',
      setup: {
        installCommand: 'curl -fsSL https://claude.ai/install.sh | bash   # or: npm i -g @anthropic-ai/claude-code',
        loginCommand: 'claude auth login',
        docsUrl: 'https://code.claude.com/docs/en/overview'
      },
      capabilities: {
        models: true, effort: true, resume: true, skills: true, skillToggle: false, permissions: true,
        planMode: true, attachments: true, streaming: true,
        limitations: ['Claude Code has no per-skill on/off switch, so skills are listed read-only.']
      },
      checkedAt: Date.now()
    }
    if (!exe) return base
    const v = await exec(exe, ['--version'], { timeout: 10_000 })
    if (v.code !== 0) return { ...base, state: 'error', message: 'Claude Code failed to run.', detail: (v.stderr || v.error || '').slice(0, 500) }
    const version = parseVersion(v.stdout)
    base.version = version
    const help = await exec(exe, ['--help'], { timeout: 10_000 })
    const needs = ['--permission-prompt-tool', 'stream-json', '--include-partial-messages']
    const missing = needs.filter((n) => !help.stdout.includes(n))
    if (missing.length) {
      return { ...base, state: 'update-recommended', message: `This version lacks required interfaces (${missing.join(', ')}). Please update Claude Code.` }
    }
    const auth = await exec(exe, ['auth', 'status'], { timeout: 15_000 })
    let loggedIn: boolean
    try {
      const j = JSON.parse(auth.stdout)
      loggedIn = !!j.loggedIn
      base.account = [j.email, j.authMethod && `via ${String(j.authMethod).replace(/_/g, ' ')}`].filter(Boolean).join(' ') || null
    } catch {
      loggedIn = auth.code === 0 && /logged in/i.test(auth.stdout)
    }
    if (!loggedIn) return { ...base, state: 'unauthenticated', message: 'Claude Code is installed but not signed in.' }
    if (version && compareVersions(version, MIN_VERSION) < 0) {
      return { ...base, state: 'update-recommended', message: `Version ${version} is older than the recommended ${MIN_VERSION}.` }
    }
    return { ...base, state: 'ready', message: 'Ready.' }
  },

  async listModels(exe, cwd) {
    const init = await controlInitialize(exe, cwd)
    return (init.models ?? []).map(
      (m: any): ModelInfo => ({
        id: m.value,
        name: m.displayName ?? m.value,
        description: m.description,
        provider: 'claude',
        efforts: m.supportsEffort ? (m.supportedEffortLevels ?? []) : [],
        defaultEffort: undefined,
        isDefault: m.value === 'default',
        supportsImages: true
      })
    )
  },

  async listSkills(exe, cwd) {
    const init = await controlInitialize(exe, cwd)
    const out: SkillInfo[] = []
    for (const c of init.commands ?? []) {
      out.push({
        id: `cmd:${c.name}`,
        name: `/${c.name}`,
        description: c.description ?? '',
        provider: 'claude',
        source: c.source ?? c.scope ?? 'built-in',
        enabled: true,
        toggleable: false,
        kind: 'command'
      })
    }
    for (const a of init.agents ?? []) {
      out.push({
        id: `agent:${a.name ?? a.agentType}`,
        name: a.name ?? a.agentType,
        description: a.description ?? '',
        provider: 'claude',
        source: a.source ?? 'agent',
        enabled: true,
        toggleable: false,
        kind: 'agent'
      })
    }
    return out
  },

  start(ctx) {
    return startClaudeRun(ctx)
  }
}

function startClaudeRun(ctx: RunContext): RunHandle {
  const mode = { ask: 'default', 'auto-edit': 'acceptEdits', plan: 'plan', full: 'bypassPermissions' }[ctx.permissionMode]
  const args = [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--include-partial-messages', '--permission-prompt-tool', 'stdio', '--permission-mode', mode
  ]
  if (ctx.permissionMode === 'full') args.push('--allow-dangerously-skip-permissions')
  if (ctx.model && ctx.model !== 'default') args.push('--model', ctx.model)
  if (ctx.effort) args.push('--effort', ctx.effort)
  if (ctx.providerSessionId) args.push('--resume', ctx.providerSessionId)
  if (ctx.instructions.trim()) args.push('--append-system-prompt', ctx.instructions)
  const extraDirs = [...new Set(ctx.attachments.map((a) => dirname(a.path)))].filter((d) => d !== ctx.cwd)
  if (extraDirs.length) args.push('--add-dir', ...extraDirs)

  const child = spawnTracked(ctx.executable, args, { cwd: ctx.cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'clivra' } })

  const pending = new Map<string, { input: any; suggestions?: any[]; tool: string }>()
  const toolInput = new Map<number, { id: string; name: string; json: string }>()
  const blockIds = new Map<number, string>()
  const split = new LineSplitter()
  let stderr = ''
  let finished = false
  let sawResult = false
  let cancelled = false
  let state: string = ''
  let msgSeq = 0

  const emit = (e: NormalizedEvent) => ctx.emit(e)
  const setState = (s: 'thinking' | 'responding' | 'executing' | 'waiting_approval', detail?: string) => {
    const key = `${s}:${detail ?? ''}`
    if (key === state) return
    state = key
    emit({ type: 'status', state: s, detail })
  }
  const send = (o: unknown) => {
    if (child.stdin?.writable) child.stdin.write(JSON.stringify(o) + '\n')
  }

  let resolveDone!: () => void
  const done = new Promise<void>((r) => (resolveDone = r))
  const finish = (ev: NormalizedEvent) => {
    if (finished) return
    finished = true
    emit(ev)
    resolveDone()
  }

  const handleStream = (m: any) => {
    const ev = m.event
    const nested = !!m.parent_tool_use_id
    switch (ev?.type) {
      case 'message_start':
        msgSeq++
        blockIds.clear()
        toolInput.clear()
        if (!nested) setState('thinking')
        break
      case 'content_block_start': {
        const b = ev.content_block
        const idx: number = ev.index
        if (b.type === 'text') blockIds.set(idx, `${m.api_message_id ?? msgSeq}:${idx}:${msgSeq}`)
        else if (b.type === 'thinking') blockIds.set(idx, `th:${m.api_message_id ?? msgSeq}:${idx}`)
        else if (b.type === 'tool_use') {
          const meta = claudeToolMeta(b.name, b.input, ctx.cwd)
          toolInput.set(idx, { id: b.id, name: b.name, json: '' })
          emit({ type: 'tool.start', toolId: b.id, name: b.name, kind: meta.kind, title: nested ? `↳ ${meta.title}` : meta.title, input: b.input })
          setState('executing', meta.title)
        }
        break
      }
      case 'content_block_delta': {
        const d = ev.delta
        const idx: number = ev.index
        if (d.type === 'text_delta' && !nested) {
          setState('responding')
          emit({ type: 'text.delta', blockId: blockIds.get(idx) ?? `t${idx}`, text: d.text })
        } else if (d.type === 'thinking_delta' && !nested) {
          setState('thinking')
          emit({ type: 'thinking.delta', blockId: blockIds.get(idx) ?? `th${idx}`, text: d.thinking })
        } else if (d.type === 'input_json_delta') {
          const t = toolInput.get(idx)
          if (t) t.json += d.partial_json
        }
        break
      }
      case 'content_block_stop': {
        const t = toolInput.get(ev.index)
        if (t) {
          toolInput.delete(ev.index)
          let input: any = {}
          try {
            input = t.json ? JSON.parse(t.json) : {}
          } catch {
            /* keep empty */
          }
          const meta = claudeToolMeta(t.name, input, ctx.cwd)
          emit({ type: 'tool.input', toolId: t.id, title: nested ? `↳ ${meta.title}` : meta.title, input })
          if (['Edit', 'Write', 'MultiEdit'].includes(t.name)) {
            claudeEditDiff(t.name, input, ctx.cwd)
              .then((diff) => diff && !finished && emit({ type: 'file.change', toolId: t.id, diff }))
              .catch(() => undefined)
          }
        }
        break
      }
    }
  }

  const handleMessage = (m: any) => {
    switch (m.type) {
      case 'system':
        if (m.subtype === 'init') {
          emit({ type: 'session', providerSessionId: m.session_id })
          emit({ type: 'run.started', provider: 'claude', model: m.model })
        } else if (m.subtype === 'status' && m.status === 'requesting') setState('thinking')
        break
      case 'stream_event':
        handleStream(m)
        break
      case 'user': {
        const content = m.message?.content
        if (Array.isArray(content)) {
          for (const c of content) {
            if (c.type === 'tool_result') {
              const text = toolResultText(c.content) || (typeof m.tool_use_result?.stdout === 'string' ? m.tool_use_result.stdout : '')
              emit({ type: 'tool.end', toolId: c.tool_use_id, status: c.is_error ? 'error' : 'done', output: text })
              setState('thinking')
            }
          }
        }
        break
      }
      case 'control_request': {
        const r = m.request
        if (r?.subtype === 'can_use_tool') {
          const meta = claudeToolMeta(r.tool_name, r.input, ctx.cwd)
          pending.set(m.request_id, { input: r.input, suggestions: r.permission_suggestions, tool: r.tool_name })
          const options: PermissionOption[] = [{ id: 'allow', label: 'Allow once', kind: 'allow_once' }]
          if (r.permission_suggestions?.length) options.push({ id: 'allow_always', label: 'Allow for this session', kind: 'allow_always' })
          options.push({ id: 'deny', label: 'Deny', kind: 'deny' })
          let detail: string | undefined
          if (r.tool_name === 'Bash') detail = r.input?.description
          else if (r.tool_name === 'ExitPlanMode') detail = r.input?.plan
          else if (r.description && r.description !== meta.title) detail = r.description
          emit({
            type: 'permission.request',
            requestId: m.request_id,
            toolId: r.tool_use_id,
            title: r.tool_name === 'ExitPlanMode' ? 'Approve plan and start editing' : `${r.display_name ?? r.tool_name}: ${meta.title}`,
            detail,
            kind: meta.kind,
            options
          })
          setState('waiting_approval', meta.title)
        } else {
          // Unknown control request: refuse rather than hang the agent.
          send({ type: 'control_response', response: { subtype: 'error', request_id: m.request_id, error: 'Unsupported by host' } })
        }
        break
      }
      case 'rate_limit_event': {
        const info = m.rate_limit_info
        if (info && info.status && info.status !== 'allowed') {
          emit({ type: 'notice', level: 'warning', message: `Rate limit ${info.status} (${info.rateLimitType ?? 'usage'}).` })
        }
        break
      }
      case 'result': {
        sawResult = true
        const u = m.usage ?? {}
        emit({ type: 'usage', usage: { inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), outputTokens: u.output_tokens, costUsd: m.total_cost_usd, durationMs: m.duration_ms } })
        if (cancelled) {
          finish({ type: 'run.completed', reason: 'cancelled' })
        } else if (m.is_error || (m.subtype && m.subtype !== 'success')) {
          const text: string = m.result || m.subtype || 'Claude Code reported an error.'
          const auth = /login|authenticat|api key|401/i.test(text)
          finish({ type: 'run.error', message: auth ? `${text}\nRun \`claude auth login\` in a terminal to sign in again.` : text, code: auth ? 'auth' : m.subtype })
        } else {
          finish({ type: 'run.completed', reason: cancelled ? 'cancelled' : 'complete' })
        }
        child.stdin?.end()
        break
      }
    }
  }

  child.stdout?.on('data', (d) =>
    split.push(d, (line) => {
      try {
        handleMessage(JSON.parse(line))
      } catch (e) {
        if (!(e instanceof SyntaxError)) stderr += `\n[adapter] ${(e as Error).message}`
      }
    })
  )
  child.stderr?.on('data', (d) => {
    stderr = (stderr + d).slice(-4000)
  })
  child.once('error', (e) => {
    finish({ type: 'run.error', message: `Could not start Claude Code: ${e.message}`, code: 'spawn' })
  })
  child.once('close', (code, signal) => {
    split.flush((l) => {
      try {
        handleMessage(JSON.parse(l))
      } catch {
        /* ignore */
      }
    })
    if (finished) return resolveDone()
    if (cancelled) return finish({ type: 'run.completed', reason: 'cancelled' })
    const tail = stderr.trim().split('\n').slice(-6).join('\n')
    const auth = /login|authenticat|api key|401/i.test(tail)
    finish({
      type: 'run.error',
      message: sawResult ? 'Claude Code exited unexpectedly.' : `Claude Code exited ${signal ? `(${signal})` : `with code ${code}`} before finishing.${tail ? `\n${tail}` : ''}${auth ? '\nRun `claude auth login` to sign in.' : ''}`,
      code: auth ? 'auth' : 'exit',
      recoverable: true
    })
  })

  // Send the prompt. Images are inlined as base64; other files are referenced by path.
  void (async () => {
    const content: any[] = []
    let text = ctx.prompt
    const refs: string[] = []
    for (const a of ctx.attachments) {
      const mime = IMAGE_MIME[extname(a.path).toLowerCase()]
      try {
        if (mime && (await stat(a.path)).size < 5_000_000) {
          content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: (await readFile(a.path)).toString('base64') } })
          continue
        }
      } catch {
        /* fall back to path reference */
      }
      refs.push(a.path)
    }
    if (refs.length) text += `\n\nAttached files:\n${refs.map((r) => `- ${r}`).join('\n')}`
    content.push({ type: 'text', text })
    send({ type: 'user', message: { role: 'user', content } })
  })()

  return {
    done,
    respondPermission(requestId, optionId) {
      const p = pending.get(requestId)
      if (!p) return
      pending.delete(requestId)
      const allow = optionId !== 'deny'
      const response: any = allow
        ? { behavior: 'allow', updatedInput: p.input, ...(optionId === 'allow_always' && p.suggestions ? { updatedPermissions: p.suggestions } : {}) }
        : { behavior: 'deny', message: 'The user declined this action.' }
      send({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })
      emit({ type: 'permission.resolved', requestId, optionId })
      setState('executing', p.tool)
    },
    async cancel() {
      if (finished) return
      cancelled = true
      // Politely interrupt first; escalate to signals if the CLI does not wind down.
      send({ type: 'control_request', request_id: `int_${Date.now()}`, request: { subtype: 'interrupt' } })
      const t1 = setTimeout(() => killTree(child, 'SIGTERM'), 2500)
      const t2 = setTimeout(() => killTree(child, 'SIGKILL'), 5000)
      await done
      clearTimeout(t1)
      clearTimeout(t2)
      killTree(child, 'SIGKILL')
    }
  }
}
