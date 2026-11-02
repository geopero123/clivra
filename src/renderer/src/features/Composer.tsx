import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowUp, BarChart3, Check, ChevronDown, FolderOpen, Gauge, GitBranch, Paperclip, PencilLine, Plus, Search, ShieldCheck, ShieldOff, Sparkles, Square, TriangleAlert, Map as MapIcon
} from 'lucide-react'
import type { Attachment, PermissionMode, ProviderId } from '@shared/types'
import { PROVIDER_IDS } from '@shared/types'
import { cn } from '@/lib/cn'
import { spring, springLiquid } from '@/lib/motion'
import { shortPath } from '@/lib/format'
import { useApp, useChatConfig } from '@/lib/store'
import { Button, Kbd, MenuItem, MenuLabel, MenuSep, Modal, Popover, PROVIDER_NAME, ProviderMark, StateBadge, Switch, Spinner } from '@/ui'
import { AttachmentThumb } from './Attachments'
import { AgentActivity } from './AgentActivity'

const MODES: { id: PermissionMode; label: string; desc: string; icon: typeof ShieldCheck }[] = [
  { id: 'ask', label: 'Ask first', desc: 'Approve commands and edits as they come up', icon: ShieldCheck },
  { id: 'auto-edit', label: 'Auto-accept edits', desc: 'Edit files freely, still ask before running commands', icon: PencilLine },
  { id: 'plan', label: 'Plan only', desc: 'Read and reason without changing anything', icon: MapIcon },
  { id: 'full', label: 'Full access', desc: 'No prompts. Only for projects you fully trust', icon: ShieldOff }
]

const chip = 'no-drag inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12.5px] text-muted transition-colors hover:bg-sunken hover:text-fg data-[open=true]:bg-sunken data-[open=true]:text-fg'

function effortLabel(e: string): string {
  return { xhigh: 'Extra high', max: 'Max', none: 'Off' }[e] ?? e.charAt(0).toUpperCase() + e.slice(1)
}

function ProviderPicker() {
  const cfg = useChatConfig()
  const providers = useApp((s) => s.providers)
  const setProvider = useApp((s) => s.setProvider)
  const setView = useApp((s) => s.setView)
  const messages = useApp((s) => (cfg.id ? s.messages[cfg.id] : undefined))
  const [open, setOpen] = useState(false)
  const hasHistory = (messages?.length ?? 0) > 0
  return (
    <Popover open={open} onOpenChange={setOpen} side="top" className="w-[300px]" trigger={
      <button data-open={open} className={chip} disabled={cfg.running}>
        <ProviderMark id={cfg.provider} size={12} className="!size-5" />
        <span className="font-medium text-fg">{PROVIDER_NAME[cfg.provider]}</span>
        <ChevronDown size={13} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
    }>
      <div className="p-1.5">
        <MenuLabel>Agent</MenuLabel>
        {PROVIDER_IDS.map((id) => {
          const p = providers.find((x) => x.id === id)
          const usable = p && (p.state === 'ready' || p.state === 'update-recommended')
          return (
            <button
              key={id}
              onClick={() => {
                if (!usable) return (setOpen(false), setView('providers'))
                setOpen(false)
                if (id !== cfg.provider) void setProvider(id)
              }}
              className={cn('flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-sunken', id === cfg.provider && 'bg-accent-soft')}
            >
              <ProviderMark id={id} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{PROVIDER_NAME[id]}</span>
                <span className="block truncate text-[11.5px] text-muted">{p?.version ? `v${p.version}` : p?.message}</span>
              </span>
              {p && !usable ? <StateBadge state={p.state} /> : id === cfg.provider ? <Check size={14} className="text-accent" /> : null}
            </button>
          )
        })}
        {hasHistory && (
          <>
            <MenuSep />
            <p className="px-2.5 pb-1.5 pt-1 text-[11.5px] leading-snug text-faint">Sessions can’t be shared between agents. Switching starts a new session and passes the earlier conversation along as a transcript.</p>
          </>
        )}
      </div>
    </Popover>
  )
}

function ModelPicker() {
  const cfg = useChatConfig()
  const models = useApp((s) => s.models[cfg.provider])
  const st = useApp((s) => s.modelState[cfg.provider])
  const loadModels = useApp((s) => s.loadModels)
  const patch = useApp((s) => s.patchActive)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const current = models?.find((m) => m.id === cfg.model)
  useEffect(() => {
    if (open) {
      void loadModels(cfg.provider)
      setQ('')
    }
  }, [open, cfg.provider, loadModels])
  const filtered = (models ?? []).filter((m) => (m.name + m.id + (m.group ?? '')).toLowerCase().includes(q.toLowerCase()))
  const groups = new Map<string, typeof filtered>()
  for (const m of filtered) groups.set(m.group ?? '', [...(groups.get(m.group ?? '') ?? []), m])
  return (
    <Popover open={open} onOpenChange={setOpen} side="top" className="w-[340px]" trigger={
      <button data-open={open} className={chip} disabled={cfg.running}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={cfg.model ?? 'none'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.14 }} className="max-w-[170px] truncate text-fg">
            {current?.name ?? cfg.model ?? (st?.loading ? 'Loading…' : 'Model')}
          </motion.span>
        </AnimatePresence>
        <ChevronDown size={13} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
    }>
      {(models?.length ?? 0) > 7 && (
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <Search size={14} className="text-faint" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models" className="w-full bg-transparent text-[13px] outline-none placeholder:text-faint" />
        </div>
      )}
      <div className="max-h-[340px] overflow-y-auto p-1.5">
        {st?.loading && !models && (
          <div className="space-y-2 p-2">
            {[0, 1, 2].map((i) => <div key={i} className="skeleton h-9 rounded-lg" />)}
          </div>
        )}
        {st?.error && (
          <div className="p-3 text-[12.5px]">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-danger"><TriangleAlert size={14} /> Couldn’t load models</div>
            <p className="mb-2 line-clamp-3 text-muted">{st.error}</p>
            <Button size="sm" onClick={() => void loadModels(cfg.provider, true)}>Retry</Button>
          </div>
        )}
        {models && models.length === 0 && !st?.error && <p className="p-3 text-[12.5px] text-muted">No models available. Check the provider’s sign-in on the Providers page.</p>}
        {[...groups.entries()].map(([g, list]) => (
          <div key={g}>
            {g && <MenuLabel>{g}</MenuLabel>}
            {list.map((m) => (
              <MenuItem
                key={m.id}
                selected={m.id === cfg.model}
                onClick={() => {
                  const eff = cfg.effort && m.efforts.includes(cfg.effort) ? cfg.effort : (m.defaultEffort && m.efforts.includes(m.defaultEffort) ? m.defaultEffort : null)
                  void patch({ model: m.id, effort: eff })
                  setOpen(false)
                }}
              >
                <span className="block truncate">{m.name}</span>
                {m.description && !m.group && <span className="block truncate text-[11.5px] text-muted">{m.description}</span>}
              </MenuItem>
            ))}
          </div>
        ))}
      </div>
    </Popover>
  )
}

function EffortPicker() {
  const cfg = useChatConfig()
  const models = useApp((s) => s.models[cfg.provider])
  const patch = useApp((s) => s.patchActive)
  const [open, setOpen] = useState(false)
  const m = models?.find((x) => x.id === cfg.model)
  if (!m || m.efforts.length === 0) return null
  const idx = Math.max(0, m.efforts.indexOf(cfg.effort ?? ''))
  return (
    <Popover open={open} onOpenChange={setOpen} side="top" className="w-[220px]" trigger={
      <button data-open={open} className={chip} disabled={cfg.running} title="Reasoning effort">
        <Gauge size={13} />
        <span>{cfg.effort ? effortLabel(cfg.effort) : 'Effort'}</span>
      </button>
    }>
      <div className="p-1.5">
        <MenuLabel>Reasoning effort</MenuLabel>
        {m.efforts.map((e, i) => (
          <MenuItem
            key={e}
            selected={e === cfg.effort}
            onClick={() => {
              void patch({ effort: e })
              setOpen(false)
            }}
            trailing={
              <span className="flex items-end gap-[2px]">
                {m.efforts.map((_, j) => <span key={j} className={cn('w-[3px] rounded-full', j <= i ? 'bg-accent' : 'bg-line-strong')} style={{ height: 4 + j * 2.5 }} />)}
              </span>
            }
          >
            {effortLabel(e)}
            {e === m.defaultEffort ? <span className="ml-1.5 text-[11px] text-faint">default</span> : null}
          </MenuItem>
        ))}
        {cfg.effort === null && <p className="px-2.5 pt-1 text-[11.5px] text-faint">Using the provider’s default (level {idx + 1}).</p>}
      </div>
    </Popover>
  )
}

function ModePicker() {
  const cfg = useChatConfig()
  const patch = useApp((s) => s.patchActive)
  const providers = useApp((s) => s.providers)
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const mode = MODES.find((m) => m.id === cfg.permissionMode) ?? MODES[0]
  const p = providers.find((x) => x.id === cfg.provider)
  const Icon = mode.icon
  return (
    <>
      <Popover open={open} onOpenChange={setOpen} side="top" className="w-[310px]" trigger={
        <button data-open={open} className={cn(chip, cfg.permissionMode === 'full' && 'text-danger hover:text-danger')} disabled={cfg.running}>
          <Icon size={13} />
          <span>{mode.label}</span>
        </button>
      }>
        <div className="p-1.5">
          <MenuLabel>Permissions</MenuLabel>
          {MODES.map((m) => (
            <button key={m.id} onClick={() => { setOpen(false); if (m.id === 'full') setConfirm(true); else void patch({ permissionMode: m.id }) }} className={cn('flex w-full items-start gap-3 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-sunken', m.id === cfg.permissionMode && 'bg-accent-soft')}>
              <m.icon size={15} className={cn('mt-0.5 shrink-0', m.id === 'full' ? 'text-danger' : 'text-muted')} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{m.label}</span>
                <span className="block text-[11.5px] leading-snug text-muted">{m.desc}</span>
                {m.id === 'plan' && p && !p.capabilities.planMode && <span className="mt-0.5 block text-[11.5px] text-warn">{PROVIDER_NAME[p.id]} has no native plan mode; this uses a read-only sandbox.</span>}
              </span>
              {m.id === cfg.permissionMode && <Check size={14} className="mt-0.5 text-accent" />}
            </button>
          ))}
        </div>
      </Popover>
      <Modal open={confirm} onClose={() => setConfirm(false)} label="Enable full access" className="max-w-md">
        <div className="p-6">
          <div className="mb-3 grid size-10 place-items-center rounded-xl bg-[color-mix(in_oklab,var(--danger)_14%,transparent)] text-danger"><ShieldOff size={20} /></div>
          <h2 className="text-lg font-semibold tracking-tight">Enable full access?</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted">The agent will be able to run any command and change any file in <span className="font-mono text-fg">{shortPath(cfg.cwd)}</span> without asking. Sandboxing is relaxed where the provider supports it. Use it only on projects you trust and can restore.</p>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => { void patch({ permissionMode: 'full' }); setConfirm(false) }}>Enable full access</Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

function SkillsPicker() {
  const cfg = useChatConfig()
  const skills = useApp((s) => s.skills[cfg.provider])
  const st = useApp((s) => s.skillState[cfg.provider])
  const load = useApp((s) => s.loadSkills)
  const toggle = useApp((s) => s.toggleSkill)
  const setView = useApp((s) => s.setView)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (open) void load(cfg.provider)
  }, [open, cfg.provider, load])
  const list = (skills ?? []).filter((s) => s.kind === 'skill')
  const total = skills?.length ?? 0
  return (
    <Popover open={open} onOpenChange={setOpen} side="top" className="w-[340px]" trigger={
      <button data-open={open} className={chip} title="Skills & tools"><Sparkles size={13} /><span>Skills</span></button>
    }>
      <div className="max-h-[320px] overflow-y-auto p-1.5">
        <MenuLabel>{PROVIDER_NAME[cfg.provider]} skills</MenuLabel>
        {st?.loading && !skills && <div className="flex items-center gap-2 p-3 text-[12.5px] text-muted"><Spinner /> Reading skills…</div>}
        {st?.error && <p className="p-3 text-[12.5px] text-danger">{st.error}</p>}
        {skills && list.length === 0 && <p className="px-3 py-2 text-[12.5px] text-muted">{total ? `${total} commands and agents are available. No installable skills found.` : 'No skills configured for this provider.'}</p>}
        {list.map((s) => (
          <div key={s.id} className="flex items-center gap-3 rounded-[10px] px-2.5 py-1.5 hover:bg-sunken">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{s.name}</div>
              <div className="line-clamp-1 text-[11.5px] text-muted">{s.description}</div>
            </div>
            {s.toggleable ? <Switch checked={s.enabled} onChange={(v) => void toggle(s, v)} label={`Enable ${s.name}`} /> : <span className="text-[11px] text-faint">always on</span>}
          </div>
        ))}
      </div>
      <div className="border-t border-line p-1.5"><MenuItem onClick={() => { setOpen(false); setView('skills') }} icon={<BarChart3 size={14} />}>Manage skills…</MenuItem></div>
    </Popover>
  )
}

function ProjectPicker() {
  const cfg = useChatConfig()
  const projects = useApp((s) => s.projects)
  const git = useApp((s) => s.git[cfg.cwd])
  const addProject = useApp((s) => s.addProject)
  const patch = useApp((s) => s.patchActive)
  const home = useApp((s) => s.info.home)
  const refreshGit = useApp((s) => s.refreshGit)
  const [open, setOpen] = useState(false)
  const name = cfg.cwd === home ? '~' : cfg.cwd.split(/[\\/]/).filter(Boolean).pop() ?? cfg.cwd
  useEffect(() => { void refreshGit(cfg.cwd) }, [cfg.cwd, refreshGit])
  const choose = async (dir: string, projectId: string | null) => { await patch({ cwd: dir, projectId }); setOpen(false) }
  return (
    <Popover open={open} onOpenChange={setOpen} side="top" className="w-[320px]" trigger={
      <button data-open={open} className={chip} disabled={cfg.running} title={cfg.cwd}>
        <FolderOpen size={13} />
        <span className="max-w-[130px] truncate text-fg">{name}</span>
        {git?.isRepo && <span className="flex items-center gap-1 text-faint"><GitBranch size={11} />{git.branch}{git.dirty ? <span className="text-warn">●{git.dirty}</span> : null}</span>}
      </button>
    }>
      <div className="max-h-[320px] overflow-y-auto p-1.5">
        <MenuLabel>Working directory</MenuLabel>
        <div className="mb-1 truncate px-3 font-mono text-[11.5px] text-muted" title={cfg.cwd}>{shortPath(cfg.cwd, home)}</div>
        <MenuSep />
        {projects.map((p) => <MenuItem key={p.id} selected={p.path === cfg.cwd} onClick={() => void choose(p.path, p.id)} icon={<FolderOpen size={14} />}>{p.name}</MenuItem>)}
        <MenuItem icon={<Plus size={14} />} onClick={async () => { const p = await addProject(); if (p) await choose(p.path, p.id) }}>Add project folder…</MenuItem>
        {cfg.cwd !== home && <MenuItem onClick={() => void choose(home, null)} icon={<FolderOpen size={14} />}>Use home folder</MenuItem>}
      </div>
    </Popover>
  )
}

export function Composer({ onHeight }: { onHeight?: (h: number) => void }) {
  const cfg = useChatConfig()
  const key = cfg.id ?? 'draft'
  const saved = useApp((s) => s.composer[key])
  const setComposer = useApp((s) => s.setComposer)
  const send = useApp((s) => s.send)
  const cancel = useApp((s) => s.cancel)
  const providers = useApp((s) => s.providers)
  const setView = useApp((s) => s.setView)
  const toast = useApp((s) => s.toast)
  const text = saved?.text ?? ''
  const attachments = useMemo(() => saved?.attachments ?? [], [saved?.attachments])
  const ta = useRef<HTMLTextAreaElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState(false)

  const set = useCallback((patch: Partial<{ text: string; attachments: Attachment[] }>) => setComposer(key, { text, attachments, ...patch }), [key, text, attachments, setComposer])

  useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = Math.min(el.scrollHeight, 240) + 'px'
  }, [text, key])

  useEffect(() => {
    const el = wrap.current
    if (!el || !onHeight) return
    const ro = new ResizeObserver(() => onHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [onHeight])

  useEffect(() => { ta.current?.focus() }, [key])
  useEffect(() => {
    const f = () => ta.current?.focus()
    window.addEventListener('clivra:focus-composer', f)
    return () => window.removeEventListener('clivra:focus-composer', f)
  }, [])
  useEffect(() => {
    const fill = (e: Event) => { set({ text: (e as CustomEvent<string>).detail }); ta.current?.focus() }
    window.addEventListener('clivra:fill-composer', fill)
    return () => window.removeEventListener('clivra:fill-composer', fill)
  }, [set])

  const provider = providers.find((p) => p.id === cfg.provider)
  const usable = provider && (provider.state === 'ready' || provider.state === 'update-recommended')
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !cfg.running

  const submit = () => {
    if (!canSend) return
    if (!usable) {
      toast({ kind: 'warning', title: `${PROVIDER_NAME[cfg.provider]} isn’t ready`, body: provider?.message ?? 'Open Providers to finish setup.' })
      return setView('providers')
    }
    void send(text.trim(), attachments)
  }

  const addFiles = (files: Attachment[]) => set({ attachments: [...attachments, ...files.filter((f) => !attachments.some((a) => a.path === f.path))].slice(0, 12) })
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDrag(false)
    const files = [...e.dataTransfer.files].map((f) => {
      const path = window.clivra.app.pathForFile(f)
      return { path, name: f.name, size: f.size, kind: /\.(png|jpe?g|gif|webp)$/i.test(f.name) ? 'image' : 'file' } as Attachment
    }).filter((f) => f.path)
    if (files.length) addFiles(files)
  }

  return (
    <div ref={wrap} className="mx-auto w-full max-w-[780px] px-4 pb-4">
      <AgentActivity />
      <motion.div
        layout
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cn('sheen relative rounded-[22px] border bg-[var(--glass)] shadow-[var(--shadow-pop)] backdrop-blur-xl transition-[border-color,box-shadow] duration-200 focus-within:border-[color-mix(in_oklab,var(--accent)_55%,var(--line))] focus-within:shadow-[var(--shadow-pop),0_0_0_4px_var(--accent-soft)]', cfg.running && 'liquid-ring loop', drag ? 'border-accent' : 'border-line-strong')}
      >
        <AnimatePresence>
          {drag && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-[22px] bg-accent-soft text-[13px] font-medium text-accent">Drop files to attach</motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {attachments.length > 0 && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="flex flex-wrap gap-2 overflow-hidden px-4 pt-3">
              <AnimatePresence initial={false}>
                {attachments.map((a) => <AttachmentThumb key={a.path} a={a} onRemove={() => set({ attachments: attachments.filter((x) => x.path !== a.path) })} />)}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
        <textarea
          ref={ta}
          value={text}
          rows={1}
          onChange={(e) => set({ text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
            else if (e.key === 'Escape' && cfg.running) void cancel()
          }}
          placeholder={cfg.id && cfg.running ? 'The agent is working…' : 'Ask anything, or describe what to build'}
          aria-label="Message"
          className="selectable block w-full resize-none bg-transparent px-5 pb-1 pt-4 text-[15px] leading-relaxed outline-none placeholder:text-faint"
        />
        <div className="flex items-center gap-0.5 px-2.5 pb-2.5 pt-1">
          <button className={cn(chip, 'px-1.5')} title="Attach files" aria-label="Attach files" onClick={async () => addFiles(await window.clivra.app.pickFiles())}>
            <Paperclip size={15} />
          </button>
          <ProjectPicker />
          <ModePicker />
          <SkillsPicker />
          <div className="flex-1" />
          <ProviderPicker />
          <ModelPicker />
          <EffortPicker />
          <div className="ml-1.5">
            <AnimatePresence mode="wait" initial={false}>
              {cfg.running ? (
                <motion.button key="stop" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={spring} onClick={() => void cancel()} aria-label="Stop" title="Stop (Esc)" className="no-drag grid size-8 place-items-center rounded-full bg-fg text-[var(--bg)] active:scale-90 ripple">
                  <Square size={11} fill="currentColor" />
                </motion.button>
              ) : (
                <motion.button key="send" initial={{ scale: 0.4, opacity: 0, rotate: -40 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} exit={{ scale: 0.4, opacity: 0 }} transition={springLiquid} onClick={submit} disabled={!canSend} aria-label="Send" title="Send (Enter)" className={cn('ripple on-accent no-drag grid size-8 place-items-center rounded-full transition-[background,color,transform,box-shadow] active:scale-90', canSend ? 'grad-accent text-accent-fg shadow-[0_6px_16px_-4px_var(--accent)] hover:scale-105' : 'bg-sunken text-faint')}>
                  <ArrowUp size={16} strokeWidth={2.4} />
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
      <div className="mt-2 flex justify-center gap-4 text-[11px] text-faint"><span><Kbd>Enter</Kbd> send</span><span><Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> newline</span><span><Kbd>Esc</Kbd> stop</span></div>
    </div>
  )
}

export type { ProviderId }
