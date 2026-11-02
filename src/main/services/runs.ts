import { randomUUID } from 'node:crypto'
import type { Block, NormalizedEvent, RunEnvelope } from '@shared/events'
import { applyEvent, blocksToText } from '@shared/events'
import type { ConversationMeta, SendRequest, StoredMessage, UsageInfo } from '@shared/types'
import type { Store } from './db'
import type { ProviderRegistry } from './registry'
import type { RunHandle } from '../providers/types'
import { memoryPrompt } from './memory'

interface ActiveRun {
  runId: string
  conversationId: string
  messageId: string
  provider: SendRequest['provider']
  handle?: RunHandle
  blocks: Block[]
  usage: UsageInfo
  queue: NormalizedEvent[]
  flushTimer?: NodeJS.Timeout
  persistTimer?: NodeJS.Timeout
  terminal?: NormalizedEvent
  cancelRequested: boolean
  hadSessionToResume: boolean
  finalized: boolean
}

const FLUSH_MS = 16
const PERSIST_MS = 600
const TRANSCRIPT_CHARS = 24_000

export interface RunSink {
  events(env: RunEnvelope): void
  conversationChanged(c: ConversationMeta): void
  runFinished(c: ConversationMeta, outcome: 'complete' | 'cancelled' | 'error', needsAttention: boolean): void
  permissionRequested?(c: ConversationMeta, title: string): void
}

export class RunManager {
  private runs = new Map<string, ActiveRun>()

  constructor(private store: Store, private registry: ProviderRegistry, private sink: RunSink) {}

  runningIds(): Set<string> {
    return new Set(this.runs.keys())
  }

  isRunning(conversationId: string): boolean {
    return this.runs.has(conversationId)
  }

  async send(req: SendRequest): Promise<{ runId: string }> {
    if (this.runs.has(req.conversationId)) throw new Error('This conversation is already running. Stop it first.')
    const conv = this.store.getConversation(req.conversationId)
    if (!conv) throw new Error('Conversation not found')
    const exe = await this.registry.executable(req.provider)
    if (!exe) throw new Error(`${req.provider} is not installed. Open Providers for setup instructions.`)

    const settings = this.store.getSettings()
    const history = this.store.listMessages(conv.id)

    // Sessions are provider-native and never shared. Switching provider starts a new session
    // that receives a clearly labelled transcript of the conversation so far.
    const sessionId = conv.sessions[req.provider]
    let instructions = settings.instructions
    if (settings.memory.inject) instructions = [instructions, memoryPrompt(this.store.listMemories())].filter(Boolean).join('\n\n')
    const handoff = !sessionId && history.length > 0
    if (handoff) instructions = [instructions, buildTranscript(history)].filter(Boolean).join('\n\n')

    this.store.updateConversation(conv.id, {
      provider: req.provider, model: req.model, effort: req.effort, permissionMode: req.permissionMode, cwd: req.cwd,
      title: history.length === 0 && conv.title === 'New chat' ? titleFrom(req.prompt) : undefined
    })

    this.store.addMessage({ conversationId: conv.id, role: 'user', blocks: [{ kind: 'text', id: 'u', text: req.prompt }], attachments: req.attachments })
    const assistant = this.store.addMessage({
      conversationId: conv.id, role: 'assistant', blocks: [], provider: req.provider, model: req.model ?? undefined, status: 'streaming'
    })

    const run: ActiveRun = {
      runId: randomUUID(), conversationId: conv.id, messageId: assistant.id, provider: req.provider, blocks: [], usage: {}, queue: [],
      cancelRequested: false, hadSessionToResume: !!sessionId, finalized: false
    }
    this.runs.set(conv.id, run)
    this.sink.conversationChanged(this.meta(conv.id))

    if (handoff) {
      const prev = history[history.length - 1]?.provider
      this.onEvent(run, {
        type: 'notice', level: 'info',
        message: `Started a new ${req.provider} session${prev && prev !== req.provider ? ` (switched from ${prev})` : ''}. The earlier conversation was passed along as a transcript, since sessions aren’t shared between providers.`
      })
    }

    const disabled = settings.skills.disabled[req.provider] ?? []
    try {
      run.handle = this.registry.adapters[req.provider].start({
        runId: run.runId, conversationId: conv.id, prompt: req.prompt, attachments: req.attachments, cwd: req.cwd,
        model: req.model, effort: req.effort, permissionMode: req.permissionMode, providerSessionId: sessionId,
        instructions, disabledSkills: disabled, executable: exe, emit: (e) => this.onEvent(run, e)
      })
      void run.handle.done.then(() => this.finalize(run))
    } catch (e) {
      this.onEvent(run, { type: 'run.error', message: (e as Error).message })
      this.finalize(run)
    }
    return { runId: run.runId }
  }

  private onEvent(run: ActiveRun, ev: NormalizedEvent): void {
    if (run.finalized) return
    if (ev.type === 'session') {
      const conv = this.store.getConversation(run.conversationId)
      if (conv) this.store.updateConversation(run.conversationId, { sessions: { ...conv.sessions, [run.provider]: ev.providerSessionId } }, false)
    }
    if (ev.type === 'usage') run.usage = { ...run.usage, ...ev.usage }
    if (ev.type === 'tool.end') this.logTool(run, ev)
    if (ev.type === 'permission.request') this.sink.permissionRequested?.(this.meta(run.conversationId), ev.title)
    if (ev.type === 'permission.request') this.store.addActivity({ conversationId: run.conversationId, ts: Date.now(), kind: 'permission', summary: ev.title, status: 'requested', provider: run.provider })
    if (ev.type === 'permission.resolved') {
      const opt = (run.blocks.find((b) => b.kind === 'permission' && b.requestId === ev.requestId) as Extract<Block, { kind: 'permission' }> | undefined)?.options.find((o) => o.id === ev.optionId)
      this.store.addActivity({ conversationId: run.conversationId, ts: Date.now(), kind: 'permission', summary: `Permission ${opt?.kind === 'deny' ? 'denied' : 'granted'}`, status: opt?.kind === 'deny' ? 'denied' : 'allowed', provider: run.provider })
    }
    if (ev.type !== 'usage') run.blocks = applyEvent(run.blocks, ev)
    if (ev.type === 'run.completed' || ev.type === 'run.error') run.terminal = ev

    // Coalesce adjacent text deltas, then flush at most once per frame.
    const last = run.queue[run.queue.length - 1]
    if (last && (ev.type === 'text.delta' || ev.type === 'thinking.delta') && last.type === ev.type && (last as any).blockId === ev.blockId) {
      ;(last as any).text += ev.text
    } else run.queue.push(ev)
    if (!run.flushTimer) run.flushTimer = setTimeout(() => this.flush(run), ev.type === 'run.completed' || ev.type === 'run.error' ? 0 : FLUSH_MS)
    if (!run.persistTimer) run.persistTimer = setTimeout(() => ((run.persistTimer = undefined), this.persist(run, 'streaming')), PERSIST_MS)
  }

  private logTool(run: ActiveRun, ev: Extract<NormalizedEvent, { type: 'tool.end' }>): void {
    const t = run.blocks.find((b) => b.kind === 'tool' && b.id === ev.toolId) as Extract<Block, { kind: 'tool' }> | undefined
    if (!t) return
    const kind = t.toolKind === 'bash' ? 'command' : t.toolKind === 'edit' || t.toolKind === 'write' ? 'edit' : t.toolKind === 'read' ? 'read' : 'tool'
    this.store.addActivity({ conversationId: run.conversationId, ts: Date.now(), kind, summary: t.title, status: ev.status, provider: run.provider })
  }

  private flush(run: ActiveRun): void {
    run.flushTimer = undefined
    if (!run.queue.length) return
    const events = run.queue
    run.queue = []
    this.sink.events({ conversationId: run.conversationId, runId: run.runId, events })
  }

  private persist(run: ActiveRun, status: StoredMessage['status']): void {
    this.store.saveMessage(run.messageId, run.conversationId, run.blocks, status, Object.keys(run.usage).length ? run.usage : undefined)
  }

  private finalize(run: ActiveRun): void {
    if (run.finalized) return
    if (!run.terminal) this.onEvent(run, run.cancelRequested ? { type: 'run.completed', reason: 'cancelled' } : { type: 'run.error', message: 'The provider stopped without finishing.' })
    run.finalized = true
    if (run.flushTimer) clearTimeout(run.flushTimer)
    if (run.persistTimer) clearTimeout(run.persistTimer)
    this.flush(run)
    const t = run.terminal!
    const outcome = t.type === 'run.error' ? 'error' : t.type === 'run.completed' && t.reason === 'cancelled' ? 'cancelled' : 'complete'
    this.persist(run, outcome === 'complete' ? 'complete' : outcome === 'cancelled' ? 'cancelled' : 'error')
    // A resume that failed leaves a dead session id behind; drop it so the next send starts clean with a transcript.
    if (t.type === 'run.error' && run.hadSessionToResume && /no conversation found|session.*(not found|expired)|could not resume/i.test(t.message)) {
      const conv = this.store.getConversation(run.conversationId)
      if (conv) {
        const sessions = { ...conv.sessions }
        delete sessions[run.provider]
        this.store.updateConversation(run.conversationId, { sessions }, false)
      }
    }
    this.runs.delete(run.conversationId)
    const meta = this.meta(run.conversationId)
    this.sink.conversationChanged(meta)
    this.sink.runFinished(meta, outcome, outcome === 'complete')
  }

  respondPermission(conversationId: string, requestId: string, optionId: string): void {
    this.runs.get(conversationId)?.handle?.respondPermission(requestId, optionId)
  }

  async cancel(conversationId: string): Promise<void> {
    const run = this.runs.get(conversationId)
    if (!run) return
    run.cancelRequested = true
    const h = run.handle
    if (!h) return this.finalize(run)
    await Promise.race([h.cancel(), new Promise((r) => setTimeout(r, 8000))])
    this.finalize(run)
  }

  async cancelAll(): Promise<void> {
    await Promise.all([...this.runs.keys()].map((id) => this.cancel(id)))
  }

  forget(conversationId: string): void {
    const run = this.runs.get(conversationId)
    if (run) void this.cancel(conversationId)
  }

  private meta(id: string): ConversationMeta {
    return this.store.getConversation(id, this.runs.has(id))!
  }
}

export function titleFrom(prompt: string): string {
  const t = prompt.replace(/\s+/g, ' ').trim()
  if (!t) return 'New chat'
  return t.length > 56 ? t.slice(0, 55).trimEnd() + '…' : t
}

export function buildTranscript(history: StoredMessage[]): string {
  const lines: string[] = []
  let total = 0
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    const text = m.role === 'user' ? (m.blocks.map((b) => (b.kind === 'text' ? b.text : '')).join('\n') || '') : blocksToText(m.blocks)
    if (!text.trim()) continue
    const entry = `${m.role === 'user' ? 'User' : `Assistant${m.provider ? ` (${m.provider})` : ''}`}: ${text.trim()}`
    if (total + entry.length > TRANSCRIPT_CHARS) {
      lines.unshift(entry.slice(0, Math.max(0, TRANSCRIPT_CHARS - total)) + '… [truncated]')
      break
    }
    total += entry.length
    lines.unshift(entry)
  }
  if (!lines.length) return ''
  return `The user is continuing a conversation that began in another session. Here is the earlier transcript for context (tool activity omitted). Continue naturally from it.\n<transcript>\n${lines.join('\n\n')}\n</transcript>`
}
