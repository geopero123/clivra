import { tmpdir } from 'node:os'
import type { Block } from '@shared/events'
import { MEMORY_CATEGORIES, type MemoryItem, type MemoryStatus, type ModelInfo, type StoredMessage } from '@shared/types'
import type { Store } from './db'
import type { ProviderRegistry } from './registry'
import { opencodeServer } from '../providers/opencode'

/** Remove anything that looks like a credential before text leaves the machine. */
export function redact(text: string): string {
  return text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted-private-key]')
    .replace(/\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/g, '[redacted-key]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted-jwt]')
    .replace(/\b((?:api[_-]?key|secret|token|password|passwd|authorization|bearer)\s*["']?\s*[:=]\s*["']?)[^\s"',;]{6,}/gi, '$1[redacted]')
}

export function pickBestModel(models: ModelInfo[], wanted: string): ModelInfo | null {
  if (wanted !== 'auto') return models.find((m) => m.id === wanted) ?? null
  const ranked = models.filter((m) => m.rank !== undefined).sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
  return ranked[0] ?? models.find((m) => m.isDefault) ?? models[0] ?? null
}

function blocksSummary(blocks: Block[]): string {
  const out: string[] = []
  let tools = 0
  for (const b of blocks) {
    if (b.kind === 'text') out.push(b.text)
    else if (b.kind === 'tool' && tools++ < 12) out.push(`[tool ${b.name}] ${b.title}${b.output ? `\n${b.output.slice(0, 1500)}` : ''}`)
  }
  return out.join('\n')
}

export function buildExcerpt(msgs: StoredMessage[]): string {
  const lastUser = [...msgs].reverse().find((m) => m.role === 'user')
  const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant')
  const parts: string[] = []
  if (lastUser) parts.push(`USER:\n${blocksSummary(lastUser.blocks)}`)
  if (lastAssistant) parts.push(`ASSISTANT (${lastAssistant.provider ?? 'agent'}):\n${blocksSummary(lastAssistant.blocks)}`)
  return redact(parts.join('\n\n')).slice(0, 14_000)
}

const SYSTEM = `You maintain a small private profile of the user for their own desktop app.
From the conversation excerpt, extract durable facts about the USER that are explicitly stated by the user or directly shown by tool output (e.g. uname/lscpu/free output).
Categories: ${MEMORY_CATEGORIES.join(', ')}.
- profile: name, role, languages spoken, stable personal context the user shared
- hardware: OS, CPU, RAM, GPU, machine type
- preferences: tools, languages, coding style, workflow likes/dislikes
- location: city/country/timezone ONLY if the user said it or a tool showed the system timezone
- projects: long-lived projects and their tech stack
Rules: never invent or infer; skip temporary task details; never store passwords, keys, tokens or other credentials; keep each value under 200 characters; prefer updating an existing key over creating a near-duplicate.
Reply with ONLY a JSON array, no prose, no code fences: [{"category":"hardware","key":"cpu","value":"AMD Ryzen 7 5800X"}]. Reply [] if there is nothing durable to save.`

export function parseFacts(text: string): { category: string; key: string; value: string }[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  let arr: unknown
  try {
    arr = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  const out: { category: string; key: string; value: string }[] = []
  for (const f of arr) {
    if (!f || typeof f !== 'object') continue
    const { category, key, value } = f as Record<string, unknown>
    if (typeof category !== 'string' || typeof key !== 'string' || typeof value !== 'string') continue
    if (!(MEMORY_CATEGORIES as readonly string[]).includes(category)) continue
    const k = key.trim().toLowerCase().slice(0, 60)
    const v = redact(value.trim()).slice(0, 300)
    if (k && v && !v.includes('[redacted')) out.push({ category, key: k, value: v })
  }
  return out.slice(0, 20)
}

export class MemoryService {
  private status: MemoryStatus = { running: false }
  private queue: string[] = []
  private working = false

  constructor(private store: Store, private registry: ProviderRegistry, private onChange: (items: MemoryItem[], s: MemoryStatus) => void) {}

  getStatus(): MemoryStatus {
    return this.status
  }

  private emit(): void {
    this.onChange(this.store.listMemories(), this.status)
  }

  /** Queue a finished conversation; runs one summary at a time. */
  enqueue(conversationId: string): void {
    if (!this.store.getSettings().memory.enabled) return
    if (!this.queue.includes(conversationId)) this.queue.push(conversationId)
    void this.drain()
  }

  private async drain(): Promise<void> {
    if (this.working) return
    this.working = true
    try {
      while (this.queue.length) await this.summarize(this.queue.shift()!)
    } finally {
      this.working = false
    }
  }

  async summarize(conversationId: string): Promise<MemoryStatus> {
    this.status = { ...this.status, running: true, lastError: undefined }
    this.emit()
    try {
      const conv = this.store.getConversation(conversationId)
      if (!conv) throw new Error('Conversation not found')
      const exe = await this.registry.executable('opencode')
      if (!exe) throw new Error('OpenCode is not installed, so there is no model to write summaries.')
      const models = await this.registry.models('opencode', tmpdir())
      const model = pickBestModel(models, this.store.getSettings().memory.model)
      if (!model) throw new Error('OpenCode has no connected model. Sign in to a provider with `opencode providers login`.')
      const excerpt = buildExcerpt(this.store.listMessages(conversationId))
      if (!excerpt.trim()) throw new Error('Nothing to summarize yet.')
      const [providerID, ...rest] = model.id.split('/')
      const existing = this.store.listMemories().map((m) => `${m.category}/${m.key}: ${m.value}`).join('\n')
      // A tool-less, directory-less session: the summarizer can read nothing and run nothing.
      const session = await opencodeServer.api<{ id: string }>(exe, 'POST', '/session', tmpdir(), { title: 'clivra-memory', permission: [{ permission: '*', pattern: '*', action: 'deny' }] })
      try {
        const res = await opencodeServer.api<{ parts?: { type: string; text?: string }[] }>(
          exe, 'POST', `/session/${session.id}/message`, tmpdir(),
          { model: { providerID, modelID: rest.join('/') }, system: SYSTEM, parts: [{ type: 'text', text: `Existing saved facts:\n${existing || '(none)'}\n\nConversation excerpt:\n${excerpt}` }] },
          180_000
        )
        const text = (res.parts ?? []).filter((p) => p.type === 'text').map((p) => p.text ?? '').join('')
        if (!text.trim()) throw new Error('The model returned no answer (it may be rate limited).')
        const facts = parseFacts(text)
        for (const f of facts) this.store.upsertMemory({ ...f, conversationId, provider: conv.provider })
        this.status = { running: false, lastRun: Date.now(), lastAdded: facts.length, model: model.name }
      } finally {
        void opencodeServer.api(exe, 'DELETE', `/session/${session.id}`, tmpdir()).catch(() => undefined)
      }
    } catch (e) {
      this.status = { ...this.status, running: false, lastRun: Date.now(), lastError: (e as Error).message }
    }
    this.emit()
    return this.status
  }
}

/** Text appended to agent instructions when the user opted in to using memory. */
export function memoryPrompt(items: MemoryItem[]): string {
  if (!items.length) return ''
  return `Known facts about the user (saved by their desktop app; use only when relevant, do not mention them unprompted):\n${items.map((m) => `- [${m.category}] ${m.key}: ${m.value}`).join('\n')}`
}
