import type { ModelInfo, ProviderId, ProviderStatus, SkillInfo } from '@shared/types'
import { PROVIDER_IDS } from '@shared/types'
import { findExecutable } from './proc'
import type { Store } from './db'
import type { ProviderAdapter } from '../providers/types'
import { claudeAdapter } from '../providers/claude'
import { codexAdapter } from '../providers/codex'
import { opencodeAdapter } from '../providers/opencode'

const BIN: Record<ProviderId, string> = { claude: 'claude', codex: 'codex', opencode: 'opencode' }

export class ProviderRegistry {
  readonly adapters: Record<ProviderId, ProviderAdapter> = { claude: claudeAdapter, codex: codexAdapter, opencode: opencodeAdapter }
  private statuses = new Map<ProviderId, ProviderStatus>()
  private modelCache = new Map<string, { at: number; models: ModelInfo[] }>()
  listeners = new Set<(s: ProviderStatus[]) => void>()

  constructor(private store: Store) {}

  all(): ProviderStatus[] {
    return PROVIDER_IDS.map((id) => this.statuses.get(id) ?? this.placeholder(id))
  }

  private placeholder(id: ProviderId): ProviderStatus {
    return { ...this.adapterSkeleton(id), state: 'checking', message: 'Checking…' }
  }

  private adapterSkeleton(id: ProviderId): ProviderStatus {
    const names = { claude: 'Claude Code', codex: 'Codex CLI', opencode: 'OpenCode' }
    return {
      id, name: names[id], state: 'checking', executable: null, version: null, minVersion: '', account: null, message: '',
      setup: { installCommand: '', loginCommand: '', docsUrl: '' },
      capabilities: { models: true, effort: true, resume: true, skills: true, skillToggle: false, permissions: true, planMode: false, attachments: true, streaming: true, limitations: [] },
      checkedAt: Date.now()
    }
  }

  async executable(id: ProviderId): Promise<string | null> {
    return findExecutable(BIN[id], this.store.getSettings().providers.executables[id])
  }

  async detect(id: ProviderId): Promise<ProviderStatus> {
    this.modelCache.forEach((_, k) => k.startsWith(id + '|') && this.modelCache.delete(k))
    let status: ProviderStatus
    try {
      status = await this.adapters[id].detect(await this.executable(id))
    } catch (e) {
      status = { ...this.adapterSkeleton(id), state: 'error', message: 'Detection failed.', detail: (e as Error).message }
    }
    this.statuses.set(id, status)
    this.listeners.forEach((l) => l(this.all()))
    return status
  }

  async detectAll(only?: ProviderId): Promise<ProviderStatus[]> {
    const ids = only ? [only] : PROVIDER_IDS
    for (const id of ids) this.statuses.set(id, { ...(this.statuses.get(id) ?? this.adapterSkeleton(id)), state: 'checking', message: 'Checking…' })
    this.listeners.forEach((l) => l(this.all()))
    await Promise.all(ids.map((id) => this.detect(id)))
    return this.all()
  }

  async models(id: ProviderId, cwd: string): Promise<ModelInfo[]> {
    const exe = await this.executable(id)
    if (!exe) return []
    const key = `${id}|${exe}`
    const hit = this.modelCache.get(key)
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.models
    const models = await this.adapters[id].listModels(exe, cwd)
    this.modelCache.set(key, { at: Date.now(), models })
    return models
  }

  async skills(id: ProviderId, cwd: string): Promise<SkillInfo[]> {
    const exe = await this.executable(id)
    if (!exe) return []
    return this.adapters[id].listSkills(exe, cwd, this.store.getSettings().skills.disabled[id] ?? [])
  }

  async toggleSkill(skill: SkillInfo, enabled: boolean, cwd: string): Promise<SkillInfo[]> {
    const id = skill.provider
    const adapter = this.adapters[id]
    const exe = await this.executable(id)
    if (!exe) throw new Error('Provider not installed')
    if (adapter.setSkillEnabled) {
      await adapter.setSkillEnabled(exe, cwd, skill, enabled)
    } else if (id === 'opencode') {
      const s = this.store.getSettings()
      const set = new Set(s.skills.disabled[id] ?? [])
      if (enabled) set.delete(skill.name)
      else set.add(skill.name)
      this.store.setSettings({ skills: { disabled: { ...s.skills.disabled, [id]: [...set] } } } as any)
    } else {
      throw new Error(`${id} does not support toggling skills`)
    }
    return this.skills(id, cwd)
  }

  async shutdown(): Promise<void> {
    await Promise.all(PROVIDER_IDS.map((id) => this.adapters[id].shutdown?.()))
  }
}
