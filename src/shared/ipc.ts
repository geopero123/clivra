import type {
  ActivityEntry, Attachment, ConversationMeta, GitInfo, ModelInfo, PermissionMode, Project, ProviderId,
  ProviderStatus, SearchHit, SendRequest, Settings, SkillInfo, StoredMessage
} from './types'
import type { RunEnvelope } from './events'

export interface ConversationPatch {
  title?: string
  pinned?: boolean
  projectId?: string | null
  cwd?: string
  provider?: ProviderId
  model?: string | null
  effort?: string | null
  permissionMode?: PermissionMode
}

export interface ClivraAPI {
  providers: {
    list(): Promise<ProviderStatus[]>
    recheck(id?: ProviderId): Promise<ProviderStatus[]>
    models(id: ProviderId, cwd?: string): Promise<ModelInfo[]>
    skills(id: ProviderId, cwd?: string): Promise<SkillInfo[]>
    toggleSkill(skill: SkillInfo, enabled: boolean, cwd?: string): Promise<SkillInfo[]>
    onStatus(cb: (s: ProviderStatus[]) => void): () => void
  }
  chat: {
    send(req: SendRequest): Promise<{ runId: string }>
    cancel(conversationId: string): Promise<void>
    respondPermission(conversationId: string, requestId: string, optionId: string): Promise<void>
    onEvents(cb: (env: RunEnvelope) => void): () => void
  }
  conversations: {
    list(): Promise<ConversationMeta[]>
    create(init: Partial<ConversationPatch> & { cwd?: string }): Promise<ConversationMeta>
    update(id: string, patch: ConversationPatch): Promise<ConversationMeta>
    remove(id: string): Promise<void>
    messages(id: string): Promise<StoredMessage[]>
    search(q: string): Promise<SearchHit[]>
    exportTo(id: string, format: 'markdown' | 'json'): Promise<string | null>
    activity(id?: string, limit?: number): Promise<ActivityEntry[]>
    onChanged(cb: (c: ConversationMeta) => void): () => void
    onRemoved(cb: (id: string) => void): () => void
  }
  projects: {
    list(): Promise<Project[]>
    add(path?: string): Promise<Project | null>
    remove(id: string): Promise<void>
    git(path: string): Promise<GitInfo>
    gitDiff(path: string): Promise<string>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  terminal: {
    create(cwd?: string): Promise<{ id: string; shell: string }>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): Promise<void>
    onData(cb: (id: string, data: string) => void): () => void
    onExit(cb: (id: string, code: number) => void): () => void
  }
  app: {
    info(): Promise<{ version: string; platform: string; home: string; electron: string }>
    pickDirectory(): Promise<string | null>
    pickFiles(): Promise<Attachment[]>
    pathForFile(file: File): string
    openExternal(url: string): Promise<void>
    reveal(path: string): Promise<void>
    readFilePreview(path: string): Promise<string | null>
    onShortcut(cb: (name: string) => void): () => void
  }
}

declare global {
  interface Window {
    clivra: ClivraAPI
  }
}
