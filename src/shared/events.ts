import type { ProviderId, UsageInfo } from './types'

export type ToolKind = 'read' | 'edit' | 'write' | 'bash' | 'search' | 'fetch' | 'agent' | 'todo' | 'mcp' | 'other'

export type AgentState = 'idle' | 'starting' | 'thinking' | 'responding' | 'executing' | 'waiting_approval'

export interface FileDiff {
  path: string
  kind: 'add' | 'update' | 'delete'
  /** Unified diff text. */
  diff: string
}

export interface PermissionOption {
  id: string
  label: string
  kind: 'allow_once' | 'allow_always' | 'deny'
}

/**
 * Provider-neutral event contract. Adapters translate native protocols into
 * these; the renderer never parses provider output.
 */
export type NormalizedEvent =
  | { type: 'run.started'; provider: ProviderId; model?: string }
  | { type: 'session'; providerSessionId: string }
  | { type: 'status'; state: AgentState; detail?: string }
  | { type: 'text.delta'; blockId: string; text: string }
  | { type: 'thinking.delta'; blockId: string; text: string }
  | { type: 'tool.start'; toolId: string; name: string; kind: ToolKind; title: string; input?: unknown }
  | { type: 'tool.input'; toolId: string; title?: string; input: unknown }
  | { type: 'tool.output'; toolId: string; text: string }
  | { type: 'tool.end'; toolId: string; status: 'done' | 'error'; output?: string }
  | { type: 'file.change'; toolId?: string; diff: FileDiff }
  | {
      type: 'permission.request'
      requestId: string
      toolId?: string
      title: string
      detail?: string
      kind: ToolKind
      options: PermissionOption[]
    }
  | { type: 'permission.resolved'; requestId: string; optionId: string }
  | { type: 'notice'; level: 'info' | 'warning' | 'error'; message: string; action?: { label: string; url: string } }
  | { type: 'usage'; usage: UsageInfo }
  | { type: 'run.completed'; reason: 'complete' | 'cancelled' }
  | { type: 'run.error'; message: string; code?: string; recoverable?: boolean }

export type Block =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'thinking'; id: string; text: string }
  | {
      kind: 'tool'
      id: string
      name: string
      toolKind: ToolKind
      title: string
      input?: unknown
      status: 'running' | 'done' | 'error'
      output?: string
      diffs: FileDiff[]
      startedAt: number
      endedAt?: number
    }
  | {
      kind: 'permission'
      id: string
      requestId: string
      toolId?: string
      title: string
      detail?: string
      toolKind: ToolKind
      options: PermissionOption[]
      status: 'pending' | 'allowed' | 'denied'
      chosen?: string
    }
  | { kind: 'notice'; id: string; level: 'info' | 'warning' | 'error'; message: string; action?: { label: string; url: string } }

const MAX_TOOL_OUTPUT = 200_000

/** Pure reducer shared by the main process (persistence) and renderer (live view). */
export function applyEvent(blocks: Block[], ev: NormalizedEvent, now = Date.now()): Block[] {
  switch (ev.type) {
    case 'text.delta':
    case 'thinking.delta': {
      const kind = ev.type === 'text.delta' ? 'text' : 'thinking'
      const idx = blocks.findIndex((b) => b.id === ev.blockId && b.kind === kind)
      if (idx >= 0) {
        const b = blocks[idx] as Extract<Block, { kind: 'text' | 'thinking' }>
        const next = blocks.slice()
        next[idx] = { ...b, text: b.text + ev.text }
        return next
      }
      return [...blocks, { kind, id: ev.blockId, text: ev.text }]
    }
    case 'tool.start': {
      if (blocks.some((b) => b.kind === 'tool' && b.id === ev.toolId)) return blocks
      return [
        ...blocks,
        {
          kind: 'tool',
          id: ev.toolId,
          name: ev.name,
          toolKind: ev.kind,
          title: ev.title,
          input: ev.input,
          status: 'running',
          diffs: [],
          startedAt: now
        }
      ]
    }
    case 'tool.input':
      return mapTool(blocks, ev.toolId, (t) => ({ ...t, input: ev.input, title: ev.title ?? t.title }))
    case 'tool.output':
      return mapTool(blocks, ev.toolId, (t) => ({ ...t, output: ((t.output ?? '') + ev.text).slice(-MAX_TOOL_OUTPUT) }))
    case 'tool.end':
      return mapTool(blocks, ev.toolId, (t) => ({
        ...t,
        status: ev.status,
        output: ev.output !== undefined ? ev.output.slice(-MAX_TOOL_OUTPUT) : t.output,
        endedAt: now
      }))
    case 'file.change': {
      if (ev.toolId && blocks.some((b) => b.kind === 'tool' && b.id === ev.toolId)) {
        return mapTool(blocks, ev.toolId, (t) => ({
          ...t,
          diffs: [...t.diffs.filter((d) => d.path !== ev.diff.path), ev.diff]
        }))
      }
      return [
        ...blocks,
        {
          kind: 'tool',
          id: ev.toolId ?? `fc_${now}_${blocks.length}`,
          name: 'edit',
          toolKind: 'edit',
          title: ev.diff.path,
          status: 'done',
          diffs: [ev.diff],
          startedAt: now,
          endedAt: now
        }
      ]
    }
    case 'permission.request':
      if (blocks.some((b) => b.kind === 'permission' && b.requestId === ev.requestId)) return blocks
      return [
        ...blocks,
        {
          kind: 'permission',
          id: `perm_${ev.requestId}`,
          requestId: ev.requestId,
          toolId: ev.toolId,
          title: ev.title,
          detail: ev.detail,
          toolKind: ev.kind,
          options: ev.options,
          status: 'pending'
        }
      ]
    case 'permission.resolved':
      return blocks.map((b) => {
        if (b.kind !== 'permission' || b.requestId !== ev.requestId) return b
        const opt = b.options.find((o) => o.id === ev.optionId)
        return { ...b, status: opt?.kind === 'deny' ? 'denied' : 'allowed', chosen: ev.optionId }
      })
    case 'notice':
      return [...blocks, { kind: 'notice', id: `n_${now}_${blocks.length}`, level: ev.level, message: ev.message, action: ev.action }]
    case 'run.error':
      return [...blocks, { kind: 'notice', id: `e_${now}_${blocks.length}`, level: 'error', message: ev.message }]
    case 'run.completed':
      // Anything still running or pending when the run ends can no longer progress.
      return blocks.map((b) => {
        if (b.kind === 'tool' && b.status === 'running') return { ...b, status: ev.reason === 'cancelled' ? 'error' : 'done', endedAt: now }
        if (b.kind === 'permission' && b.status === 'pending') return { ...b, status: 'denied' }
        return b
      })
    default:
      return blocks
  }
}

function mapTool(blocks: Block[], id: string, fn: (t: Extract<Block, { kind: 'tool' }>) => Block): Block[] {
  const idx = blocks.findIndex((b) => b.kind === 'tool' && b.id === id)
  if (idx < 0) return blocks
  const next = blocks.slice()
  next[idx] = fn(blocks[idx] as Extract<Block, { kind: 'tool' }>)
  return next
}

/** Plain text of an assistant message (used for search indexing, export and context transfer). */
export function blocksToText(blocks: Block[]): string {
  return blocks
    .filter((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text')
    .map((b) => b.text)
    .join('\n\n')
}

export interface RunEnvelope {
  conversationId: string
  runId: string
  events: NormalizedEvent[]
}
