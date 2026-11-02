import type { Attachment, ModelInfo, PermissionMode, ProviderId, ProviderStatus, SkillInfo } from '@shared/types'
import type { NormalizedEvent } from '@shared/events'

export interface RunContext {
  runId: string
  conversationId: string
  prompt: string
  attachments: Attachment[]
  cwd: string
  model: string | null
  effort: string | null
  permissionMode: PermissionMode
  /** Native session id for this provider, when resuming. */
  providerSessionId?: string
  /** Global instructions plus any cross-provider handoff context. */
  instructions: string
  disabledSkills: string[]
  executable: string
  emit(event: NormalizedEvent): void
}

export interface RunHandle {
  cancel(): Promise<void>
  respondPermission(requestId: string, optionId: string): void
  /** Resolves once the run is fully finished (after the terminal event was emitted). */
  done: Promise<void>
}

export interface ProviderAdapter {
  readonly id: ProviderId
  detect(executable: string | null): Promise<ProviderStatus>
  listModels(executable: string, cwd: string): Promise<ModelInfo[]>
  listSkills(executable: string, cwd: string, disabled: string[]): Promise<SkillInfo[]>
  /** Toggle a skill natively when supported. */
  setSkillEnabled?(executable: string, cwd: string, skill: SkillInfo, enabled: boolean): Promise<void>
  start(ctx: RunContext): RunHandle
  /** Release long-lived resources (servers, caches). */
  shutdown?(): Promise<void>
}
