export type ProviderId = 'claude' | 'codex' | 'opencode'
export const PROVIDER_IDS: ProviderId[] = ['claude', 'codex', 'opencode']

/** Normalized permission levels. Each adapter maps these onto its native mechanism. */
export type PermissionMode = 'ask' | 'auto-edit' | 'plan' | 'full'

export type ProviderState =
  | 'ready'
  | 'unauthenticated'
  | 'update-recommended'
  | 'missing'
  | 'error'
  | 'checking'

export interface ProviderCapabilities {
  models: boolean
  effort: boolean
  resume: boolean
  skills: boolean
  skillToggle: boolean
  permissions: boolean
  planMode: boolean
  attachments: boolean
  streaming: boolean
  /** Human-readable limitations to be shown in the UI rather than hidden. */
  limitations: string[]
}

export interface ProviderStatus {
  id: ProviderId
  name: string
  state: ProviderState
  executable: string | null
  version: string | null
  minVersion: string
  account: string | null
  message: string
  detail?: string
  setup: { installCommand: string; loginCommand: string; docsUrl: string }
  capabilities: ProviderCapabilities
  checkedAt: number
}

export interface ModelInfo {
  id: string
  name: string
  description?: string
  provider: ProviderId
  /** Sub-provider (OpenCode multiplexes many). */
  group?: string
  efforts: string[]
  defaultEffort?: string
  isDefault?: boolean
  supportsImages?: boolean
  /** Capability heuristic (higher = stronger); only set where the provider reports cost/context. */
  rank?: number
}

export interface SkillInfo {
  id: string
  name: string
  description: string
  provider: ProviderId
  source: string
  path?: string
  enabled: boolean
  /** Whether the provider natively lets this skill be switched off. */
  toggleable: boolean
  kind: 'skill' | 'command' | 'agent'
}

export interface Project {
  id: string
  name: string
  path: string
  createdAt: number
}

export interface GitInfo {
  isRepo: boolean
  branch?: string
  dirty?: number
  ahead?: number
  behind?: number
  root?: string
}

export interface ConversationMeta {
  id: string
  title: string
  projectId: string | null
  cwd: string
  provider: ProviderId
  model: string | null
  effort: string | null
  permissionMode: PermissionMode
  pinned: boolean
  createdAt: number
  updatedAt: number
  /** Provider-native session ids; sessions are never shared between providers. */
  sessions: Partial<Record<ProviderId, string>>
  running: boolean
  preview?: string
}

export interface Attachment {
  path: string
  name: string
  kind: 'image' | 'file'
  size?: number
}

export interface UsageInfo {
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  durationMs?: number
}

export interface StoredMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  blocks: import('./events').Block[]
  attachments?: Attachment[]
  provider?: ProviderId
  model?: string
  status: 'complete' | 'streaming' | 'error' | 'cancelled' | 'interrupted'
  usage?: UsageInfo
  createdAt: number
}

export interface SearchHit {
  conversationId: string
  messageId: string
  title: string
  snippet: string
  updatedAt: number
}

export type ThemeMode = 'system' | 'dark' | 'light'
export type MotionLevel = 'full' | 'reduced' | 'off'

export interface Settings {
  appearance: {
    theme: ThemeMode
    accent: string
    motion: MotionLevel
    density: 'comfortable' | 'compact'
    fontScale: number
  }
  defaults: {
    provider: ProviderId
    permissionMode: PermissionMode
    model: Partial<Record<ProviderId, string>>
    effort: Partial<Record<ProviderId, string>>
  }
  instructions: string
  providers: { executables: Partial<Record<ProviderId, string>> }
  skills: { disabled: Partial<Record<ProviderId, string[]>> }
  terminal: { fontSize: number; shell: string }
  notifications: { onComplete: boolean; onPermission: boolean }
  sidebar: { collapsed: boolean; width: number }
  memory: { enabled: boolean; model: string; inject: boolean }
}

export const MEMORY_CATEGORIES = ['profile', 'hardware', 'preferences', 'location', 'projects', 'other'] as const
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number]

export interface MemoryItem {
  id: number
  category: MemoryCategory
  key: string
  value: string
  conversationId: string | null
  provider: ProviderId | null
  updatedAt: number
}

export interface MemoryStatus {
  running: boolean
  lastRun?: number
  lastError?: string
  lastAdded?: number
  model?: string
}

export const DEFAULT_SETTINGS: Settings = {
  appearance: { theme: 'system', accent: '#d97757', motion: 'full', density: 'comfortable', fontScale: 1 },
  defaults: { provider: 'claude', permissionMode: 'ask', model: {}, effort: {} },
  instructions: '',
  providers: { executables: {} },
  skills: { disabled: {} },
  terminal: { fontSize: 13, shell: '' },
  notifications: { onComplete: true, onPermission: true },
  sidebar: { collapsed: false, width: 288 },
  memory: { enabled: false, model: 'auto', inject: false }
}

export interface SendRequest {
  conversationId: string
  prompt: string
  attachments: Attachment[]
  provider: ProviderId
  model: string | null
  effort: string | null
  permissionMode: PermissionMode
  cwd: string
}

export interface ActivityEntry {
  id: number
  conversationId: string
  ts: number
  kind: 'command' | 'edit' | 'read' | 'tool' | 'permission'
  summary: string
  status: string
  provider: ProviderId
}
