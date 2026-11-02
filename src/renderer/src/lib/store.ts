import { create } from 'zustand'
import type {
  Attachment, ConversationMeta, GitInfo, ModelInfo, PermissionMode, Project, ProviderId, ProviderStatus, Settings, SkillInfo, StoredMessage, UsageInfo
} from '@shared/types'
import { DEFAULT_SETTINGS, PROVIDER_IDS } from '@shared/types'
import type { AgentState, Block, RunEnvelope } from '@shared/events'
import { applyEvent } from '@shared/events'
import type { ConversationPatch } from '@shared/ipc'

export type View = 'chat' | 'providers' | 'skills' | 'analytics' | 'brain' | 'settings'

export interface LiveRun {
  runId: string
  blocks: Block[]
  agent: AgentState
  detail?: string
  startedAt: number
  usage?: UsageInfo
  model?: string
}

export interface Draft {
  provider: ProviderId
  model: string | null
  effort: string | null
  permissionMode: PermissionMode
  cwd: string
  projectId: string | null
}

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error' | 'warning'
  title: string
  body?: string
}

interface State {
  ready: boolean
  settings: Settings
  info: { version: string; platform: string; home: string; electron: string }
  providers: ProviderStatus[]
  conversations: ConversationMeta[]
  projects: Project[]
  activeId: string | null
  draft: Draft
  view: View
  settingsSection: string
  messages: Record<string, StoredMessage[]>
  live: Record<string, LiveRun>
  models: Partial<Record<ProviderId, ModelInfo[]>>
  modelState: Partial<Record<ProviderId, { loading: boolean; error?: string }>>
  skills: Partial<Record<ProviderId, SkillInfo[]>>
  skillState: Partial<Record<ProviderId, { loading: boolean; error?: string }>>
  composer: Record<string, { text: string; attachments: Attachment[] }>
  git: Record<string, GitInfo>
  panels: { terminal: boolean; activity: boolean }
  palette: boolean
  toasts: Toast[]
  scrollTick: number

  boot(): Promise<void>
  setView(v: View, section?: string): void
  newChat(opts?: Partial<Draft>): void
  openConversation(id: string): Promise<void>
  send(prompt: string, attachments: Attachment[]): Promise<void>
  cancel(): Promise<void>
  respondPermission(requestId: string, optionId: string): Promise<void>
  patchActive(patch: Partial<ConversationPatch & Draft>): Promise<void>
  setProvider(p: ProviderId): Promise<void>
  renameConversation(id: string, title: string): Promise<void>
  pinConversation(id: string, pinned: boolean): Promise<void>
  removeConversation(id: string): Promise<void>
  setSettings(patch: Partial<Settings>): Promise<void>
  recheck(id?: ProviderId): Promise<void>
  loadModels(p: ProviderId, force?: boolean): Promise<void>
  loadSkills(p: ProviderId): Promise<void>
  toggleSkill(s: SkillInfo, enabled: boolean): Promise<void>
  addProject(path?: string): Promise<Project | null>
  removeProject(id: string): Promise<void>
  refreshGit(cwd: string): Promise<void>
  setComposer(key: string, v: { text: string; attachments: Attachment[] }): void
  togglePanel(p: 'terminal' | 'activity'): void
  setPalette(open: boolean): void
  toast(t: Omit<Toast, 'id'>): void
  dismissToast(id: number): void
}

let toastSeq = 1
const api = () => window.clivra

function sortConvs(list: ConversationMeta[]): ConversationMeta[] {
  return list.slice().sort((a, b) => b.updatedAt - a.updatedAt)
}

export const useApp = create<State>((set, get) => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  info: { version: '', platform: '', home: '', electron: '' },
  providers: [],
  conversations: [],
  projects: [],
  activeId: null,
  draft: { provider: 'claude', model: null, effort: null, permissionMode: 'ask', cwd: '', projectId: null },
  view: 'chat',
  settingsSection: 'appearance',
  messages: {},
  live: {},
  models: {},
  modelState: {},
  skills: {},
  skillState: {},
  composer: {},
  git: {},
  panels: { terminal: false, activity: false },
  palette: false,
  toasts: [],
  scrollTick: 0,

  async boot() {
    const step = (pct: number, msg: string) => (window as unknown as { __splash?: { set(p: number, m: string): void } }).__splash?.set(pct, msg)
    step(12, 'Opening your workspace')
    const [settings, info] = await Promise.all([api().settings.get(), api().app.info()])
    step(38, 'Loading conversations')
    const [conversations, projects] = await Promise.all([api().conversations.list(), api().projects.list()])
    step(68, 'Waking your agents')
    // Detection runs in the background after first paint; this is only the cached/placeholder status.
    const providers = await api().providers.list()
    step(90, 'Almost there')
    set({
      settings, info, providers, conversations, projects, ready: true,
      draft: { provider: settings.defaults.provider, model: settings.defaults.model[settings.defaults.provider] ?? null, effort: settings.defaults.effort[settings.defaults.provider] ?? null, permissionMode: settings.defaults.permissionMode, cwd: info.home, projectId: null }
    })

    api().providers.onStatus((s) => set({ providers: s }))
    api().conversations.onChanged((c) =>
      set((st) => {
        const exists = st.conversations.some((x) => x.id === c.id)
        return { conversations: sortConvs(exists ? st.conversations.map((x) => (x.id === c.id ? { ...x, ...c, preview: c.preview ?? x.preview } : x)) : [c, ...st.conversations]) }
      })
    )
    api().conversations.onRemoved((id) => set((st) => ({ conversations: st.conversations.filter((c) => c.id !== id), activeId: st.activeId === id ? null : st.activeId })))

    api().chat.onEvents((env: RunEnvelope) => {
      const st = get()
      const prev = st.live[env.conversationId] ?? { runId: env.runId, blocks: [], agent: 'starting' as AgentState, startedAt: Date.now() }
      let { blocks, agent, detail, usage, model } = prev
      let terminal = false
      for (const ev of env.events) {
        if (ev.type === 'status') {
          agent = ev.state
          detail = ev.detail
        }
        else if (ev.type === 'usage') usage = { ...usage, ...ev.usage }
        else if (ev.type === 'run.started') model = ev.model
        else if (ev.type === 'run.completed' || ev.type === 'run.error') terminal = true
        else if (ev.type === 'permission.request') {
          agent = 'waiting_approval'
          detail = ev.title
        }
        blocks = applyEvent(blocks, ev)
      }
      if (!terminal) {
        set((s) => ({ live: { ...s.live, [env.conversationId]: { ...prev, blocks, agent, detail, usage, model } }, scrollTick: s.scrollTick + 1 }))
        return
      }
      // Run ended: the database is authoritative, so reload the persisted message and drop the live copy.
      void api().conversations.messages(env.conversationId).then((msgs) =>
        set((s) => {
          const live = { ...s.live }
          delete live[env.conversationId]
          return { messages: { ...s.messages, [env.conversationId]: msgs }, live, scrollTick: s.scrollTick + 1 }
        })
      )
      const git = get().conversations.find((c) => c.id === env.conversationId)?.cwd
      if (git) void get().refreshGit(git)
    })

    // Initial model list for the default provider (lazy for the others); deferred so first paint stays light.
    setTimeout(() => void get().loadModels(get().draft.provider), 1200)
    if (get().draft.cwd) void get().refreshGit(get().draft.cwd)
  },

  setView(view, section) {
    set((s) => ({ view, settingsSection: section ?? s.settingsSection }))
  },

  newChat(opts) {
    const s = get()
    const last = s.conversations.find((c) => c.id === s.activeId)
    const base = s.draft
    const draft: Draft = {
      provider: opts?.provider ?? base.provider,
      model: opts?.model !== undefined ? opts.model : base.model,
      effort: opts?.effort !== undefined ? opts.effort : base.effort,
      permissionMode: opts?.permissionMode ?? base.permissionMode,
      cwd: opts?.cwd ?? last?.cwd ?? base.cwd ?? s.info.home,
      projectId: opts?.projectId !== undefined ? opts.projectId : (last?.projectId ?? base.projectId)
    }
    set({ activeId: null, draft, view: 'chat' })
  },

  async openConversation(id) {
    set({ activeId: id, view: 'chat' })
    const c = get().conversations.find((x) => x.id === id)
    if (c) {
      void get().loadModels(c.provider)
      void get().refreshGit(c.cwd)
    }
    const msgs = await api().conversations.messages(id)
    set((s) => {
      const live = { ...s.live }
      let shown = msgs
      // A run that was streaming when the renderer (re)loaded continues from its persisted state.
      const last = msgs[msgs.length - 1]
      if (last?.status === 'streaming' && c?.running && !live[id]) {
        live[id] = { runId: 'resume', blocks: last.blocks, agent: 'thinking', startedAt: last.createdAt }
        shown = msgs.slice(0, -1)
      }
      return { messages: { ...s.messages, [id]: shown }, live, scrollTick: s.scrollTick + 1 }
    })
  },

  async send(prompt, attachments) {
    const s = get()
    let conv = s.conversations.find((c) => c.id === s.activeId)
    const cfg = conv ?? s.draft
    if (!conv) {
      conv = await api().conversations.create({ provider: cfg.provider, model: cfg.model, effort: cfg.effort, permissionMode: cfg.permissionMode, cwd: cfg.cwd, projectId: cfg.projectId })
      set((st) => ({ conversations: sortConvs([conv!, ...st.conversations.filter((c) => c.id !== conv!.id)]), activeId: conv!.id, messages: { ...st.messages, [conv!.id]: [] } }))
    }
    const id = conv.id
    const now = Date.now()
    // Optimistic user message + live assistant surface.
    set((st) => ({
      messages: {
        ...st.messages,
        [id]: [...(st.messages[id] ?? []), { id: `tmp_${now}`, conversationId: id, role: 'user', blocks: [{ kind: 'text', id: 'u', text: prompt }], attachments, status: 'complete', createdAt: now }]
      },
      live: { ...st.live, [id]: { runId: 'pending', blocks: [], agent: 'starting', startedAt: now } },
      composer: { ...st.composer, [id]: { text: '', attachments: [] }, draft: { text: '', attachments: [] } },
      scrollTick: st.scrollTick + 1
    }))
    try {
      await api().chat.send({ conversationId: id, prompt, attachments, provider: cfg.provider, model: cfg.model, effort: cfg.effort, permissionMode: cfg.permissionMode, cwd: cfg.cwd })
    } catch (e) {
      set((st) => {
        const live = { ...st.live }
        delete live[id]
        return { live }
      })
      const msgs = await api().conversations.messages(id)
      set((st) => ({ messages: { ...st.messages, [id]: msgs } }))
      get().toast({ kind: 'error', title: 'Could not send', body: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
      // Restore what the user typed so nothing is lost.
      set((st) => ({ composer: { ...st.composer, [id]: { text: prompt, attachments } } }))
    }
  },

  async cancel() {
    const id = get().activeId
    if (id) await api().chat.cancel(id)
  },

  async respondPermission(requestId, optionId) {
    const id = get().activeId
    if (!id) return
    // Optimistic: collapse the card immediately; the adapter confirms with permission.resolved.
    set((s) => {
      const l = s.live[id]
      if (!l) return {}
      return { live: { ...s.live, [id]: { ...l, agent: 'executing', blocks: applyEvent(l.blocks, { type: 'permission.resolved', requestId, optionId }) } } }
    })
    await api().chat.respondPermission(id, requestId, optionId)
  },

  async patchActive(patch) {
    const s = get()
    const conv = s.conversations.find((c) => c.id === s.activeId)
    if (!conv) {
      set({ draft: { ...s.draft, ...(patch as Partial<Draft>) } })
      return
    }
    const updated = await api().conversations.update(conv.id, patch as ConversationPatch)
    set((st) => ({ conversations: st.conversations.map((c) => (c.id === updated.id ? { ...c, ...updated, preview: c.preview } : c)) }))
  },

  async setProvider(provider) {
    await get().loadModels(provider)
    const s = get()
    const list = s.models[provider] ?? []
    const wantModel = s.settings.defaults.model[provider]
    const m = list.find((x) => x.id === wantModel) ?? list.find((x) => x.isDefault) ?? list[0]
    const wantEffort = s.settings.defaults.effort[provider]
    const effort = m && wantEffort && m.efforts.includes(wantEffort) ? wantEffort : (m?.defaultEffort && m.efforts.includes(m.defaultEffort) ? m.defaultEffort : null)
    await get().patchActive({ provider, model: m?.id ?? null, effort })
  },

  async renameConversation(id, title) {
    const t = title.trim()
    if (!t) return
    await api().conversations.update(id, { title: t })
  },
  async pinConversation(id, pinned) {
    await api().conversations.update(id, { pinned })
  },
  async removeConversation(id) {
    await api().conversations.remove(id)
    set((s) => {
      const messages = { ...s.messages }
      delete messages[id]
      return { messages, conversations: s.conversations.filter((c) => c.id !== id), activeId: s.activeId === id ? null : s.activeId }
    })
  },

  async setSettings(patch) {
    const next = await api().settings.set(patch)
    set({ settings: next })
  },

  async recheck(id) {
    set({ providers: get().providers.map((p) => (!id || p.id === id ? { ...p, state: 'checking', message: 'Checking…' } : p)) })
    const providers = await api().providers.recheck(id)
    set({ providers })
    for (const p of id ? [id] : PROVIDER_IDS) {
      set((s) => ({ models: { ...s.models, [p]: undefined }, skills: { ...s.skills, [p]: undefined } }))
    }
    void get().loadModels(get().conversations.find((c) => c.id === get().activeId)?.provider ?? get().draft.provider, true)
  },

  async loadModels(p, force) {
    const s = get()
    if (!force && (s.models[p] || s.modelState[p]?.loading)) return
    set((st) => ({ modelState: { ...st.modelState, [p]: { loading: true } } }))
    try {
      const cwd = (s.conversations.find((c) => c.id === s.activeId) ?? s.draft).cwd
      const list = await api().providers.models(p, cwd || undefined)
      set((st) => {
        const next: Partial<State> = { models: { ...st.models, [p]: list }, modelState: { ...st.modelState, [p]: { loading: false } } }
        return next
      })
      // Fill in a model/effort for drafts that don't have one yet.
      const st = get()
      const cur = st.conversations.find((c) => c.id === st.activeId) ?? st.draft
      if (cur.provider === p && !cur.model && list.length) {
        const m = list.find((x) => x.id === st.settings.defaults.model[p]) ?? list.find((x) => x.isDefault) ?? list[0]
        const e = st.settings.defaults.effort[p]
        await get().patchActive({ model: m.id, effort: e && m.efforts.includes(e) ? e : null })
      }
    } catch (e) {
      set((st) => ({ modelState: { ...st.modelState, [p]: { loading: false, error: (e as Error).message } } }))
    }
  },

  async loadSkills(p) {
    set((st) => ({ skillState: { ...st.skillState, [p]: { loading: true } } }))
    try {
      const s = get()
      const cwd = (s.conversations.find((c) => c.id === s.activeId) ?? s.draft).cwd
      const list = await api().providers.skills(p, cwd || undefined)
      set((st) => ({ skills: { ...st.skills, [p]: list }, skillState: { ...st.skillState, [p]: { loading: false } } }))
    } catch (e) {
      set((st) => ({ skillState: { ...st.skillState, [p]: { loading: false, error: (e as Error).message } } }))
    }
  },

  async toggleSkill(skill, enabled) {
    const s = get()
    const cwd = (s.conversations.find((c) => c.id === s.activeId) ?? s.draft).cwd
    // Optimistic flip so the switch animates instantly.
    set((st) => ({ skills: { ...st.skills, [skill.provider]: (st.skills[skill.provider] ?? []).map((x) => (x.id === skill.id ? { ...x, enabled } : x)) } }))
    try {
      const list = await api().providers.toggleSkill(skill, enabled, cwd || undefined)
      set((st) => ({ skills: { ...st.skills, [skill.provider]: list } }))
    } catch (e) {
      set((st) => ({ skills: { ...st.skills, [skill.provider]: (st.skills[skill.provider] ?? []).map((x) => (x.id === skill.id ? { ...x, enabled: !enabled } : x)) } }))
      get().toast({ kind: 'error', title: 'Could not change skill', body: (e as Error).message })
    }
  },

  async addProject(path) {
    const p = await api().projects.add(path)
    if (p) set((s) => ({ projects: [p, ...s.projects.filter((x) => x.id !== p.id)] }))
    return p
  },
  async removeProject(id) {
    await api().projects.remove(id)
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id), conversations: s.conversations.map((c) => (c.projectId === id ? { ...c, projectId: null } : c)) }))
  },

  async refreshGit(cwd) {
    if (!cwd) return
    try {
      const g = await api().projects.git(cwd)
      set((s) => ({ git: { ...s.git, [cwd]: g } }))
    } catch {
      /* directory vanished */
    }
  },

  setComposer(key, v) {
    set((s) => ({ composer: { ...s.composer, [key]: v } }))
  },
  togglePanel(p) {
    set((s) => ({ panels: { ...s.panels, [p]: !s.panels[p] } }))
  },
  setPalette(palette) {
    set({ palette })
  },
  toast(t) {
    const id = toastSeq++
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }))
    setTimeout(() => get().dismissToast(id), t.kind === 'error' ? 8000 : 4500)
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  }
}))

export function useActiveConversation(): ConversationMeta | null {
  return useApp((s) => s.conversations.find((c) => c.id === s.activeId) ?? null)
}

/** The configuration shown in the composer: the active conversation, or the draft for a new chat. */
export function useChatConfig(): Draft & { id: string | null; running: boolean } {
  const conv = useActiveConversation()
  const draft = useApp((s) => s.draft)
  const live = useApp((s) => (s.activeId ? !!s.live[s.activeId] : false))
  if (conv) return { id: conv.id, provider: conv.provider, model: conv.model, effort: conv.effort, permissionMode: conv.permissionMode, cwd: conv.cwd, projectId: conv.projectId, running: conv.running || live }
  return { id: null, ...draft, running: false }
}
