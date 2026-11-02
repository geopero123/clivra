import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Bell, Cable, Cpu, FolderGit2, Keyboard, Palette, RefreshCw, ShieldCheck, Sparkles, SquareTerminal, Trash2, Plus, Gauge } from 'lucide-react'
import type { ProviderId, Settings } from '@shared/types'
import { PROVIDER_IDS } from '@shared/types'
import { cn } from '@/lib/cn'
import { base, spring } from '@/lib/motion'
import { useApp } from '@/lib/store'
import { Button, Kbd, PROVIDER_NAME, ProviderMark, Row, Section, Segmented, StateBadge, Switch } from '@/ui'

const ACCENTS = ['#7c6cf0', '#e0734a', '#3fb67a', '#4a9fe0', '#d9628b', '#d9a441']

const SECTIONS = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'providers', label: 'AI providers', icon: Cable },
  { id: 'models', label: 'Models & reasoning', icon: Cpu },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'permissions', label: 'Permissions', icon: ShieldCheck },
  { id: 'terminal', label: 'Terminal', icon: SquareTerminal },
  { id: 'workspaces', label: 'Workspaces', icon: FolderGit2 },
  { id: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'updates', label: 'Updates', icon: RefreshCw }
]

function useDebounced<T>(value: T, onCommit: (v: T) => void, ms = 500) {
  useEffect(() => {
    const t = setTimeout(() => onCommit(value), ms)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
}

function Select({ value, onChange, options, disabled }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; disabled?: boolean }) {
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="no-drag h-8 max-w-[260px] rounded-[10px] border border-line bg-raised px-2.5 text-[13px] outline-none transition focus:border-accent disabled:opacity-50">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function Appearance({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const a = s.appearance
  const up = (p: Partial<Settings['appearance']>) => set({ appearance: { ...a, ...p } })
  return (
    <>
      <Section title="Theme">
        <Row title="Color mode" desc="Follows your system unless you choose one."><Segmented value={a.theme} onChange={(v) => up({ theme: v })} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} /></Row>
        <Row title="Accent color" desc="Used for focus, selection and primary actions.">
          <div className="flex items-center gap-2">
            {ACCENTS.map((c) => (
              <button key={c} aria-label={`Accent ${c}`} onClick={() => up({ accent: c })} className="relative size-6 rounded-full transition-transform hover:scale-110 active:scale-90" style={{ background: c }}>
                {a.accent === c && <motion.span layoutId="accent-ring" transition={spring} className="absolute -inset-[3px] rounded-full border-2" style={{ borderColor: c }} />}
              </button>
            ))}
            <input type="color" value={a.accent} onChange={(e) => up({ accent: e.target.value })} aria-label="Custom accent" className="size-6 cursor-pointer rounded-full border-0 bg-transparent p-0" />
          </div>
        </Row>
      </Section>
      <Section title="Motion & density">
        <Row title="Animation" desc="“Reduced” keeps fades but removes movement and looping effects. The system reduced-motion preference is always respected."><Segmented value={a.motion} onChange={(v) => up({ motion: v })} options={[{ value: 'full', label: 'Full' }, { value: 'reduced', label: 'Reduced' }, { value: 'off', label: 'Off' }]} /></Row>
        <Row title="Density"><Segmented value={a.density} onChange={(v) => up({ density: v })} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} /></Row>
        <Row title="Text size" desc={`${Math.round(a.fontScale * 100)}%`}><input type="range" min={0.85} max={1.25} step={0.05} value={a.fontScale} onChange={(e) => up({ fontScale: Number(e.target.value) })} aria-label="Text size" className="w-40 accent-[var(--accent)]" /></Row>
      </Section>
    </>
  )
}

function Providers({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const providers = useApp((x) => x.providers)
  const recheck = useApp((x) => x.recheck)
  const setView = useApp((x) => x.setView)
  const [paths, setPaths] = useState(s.providers.executables)
  return (
    <Section title="Executables" aside={<Button size="sm" variant="ghost" onClick={() => setView('providers')}>Open dashboard</Button>}>
      {PROVIDER_IDS.map((id) => {
        const p = providers.find((x) => x.id === id)
        return (
          <div key={id} className="border-b border-line px-4 py-3.5 last:border-0">
            <div className="flex items-center gap-3"><ProviderMark id={id} /><div className="flex-1 text-[13.5px] font-medium">{PROVIDER_NAME[id]}</div>{p && <StateBadge state={p.state} />}</div>
            <div className="mt-3 flex gap-2">
              <input value={paths[id] ?? ''} onChange={(e) => setPaths({ ...paths, [id]: e.target.value })} placeholder={p?.executable ?? 'Auto-detect from PATH'} aria-label={`${PROVIDER_NAME[id]} executable path`} className="h-8 min-w-0 flex-1 rounded-[10px] border border-line bg-raised px-3 font-mono text-[12px] outline-none focus:border-accent" />
              <Button size="sm" onClick={() => { const ex = { ...s.providers.executables, [id]: paths[id] || undefined }; set({ providers: { executables: ex } }); void recheck(id) }}>Apply</Button>
            </div>
          </div>
        )
      })}
    </Section>
  )
}

function Models({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const models = useApp((x) => x.models)
  const load = useApp((x) => x.loadModels)
  const [instr, setInstr] = useState(s.instructions)
  useDebounced(instr, (v) => v !== s.instructions && set({ instructions: v }))
  useEffect(() => { PROVIDER_IDS.forEach((id) => void load(id)) }, [load])
  return (
    <>
      <Section title="Defaults for new chats">
        <Row title="Default agent"><Select value={s.defaults.provider} onChange={(v) => set({ defaults: { ...s.defaults, provider: v as ProviderId } })} options={PROVIDER_IDS.map((id) => ({ value: id, label: PROVIDER_NAME[id] }))} /></Row>
        {PROVIDER_IDS.map((id) => {
          const list = models[id]
          const m = list?.find((x) => x.id === s.defaults.model[id])
          return (
            <div key={id}>
              <Row title={`${PROVIDER_NAME[id]} model`} desc={list ? undefined : 'Not available — provider not ready'}>
                <Select value={s.defaults.model[id] ?? ''} disabled={!list?.length} onChange={(v) => set({ defaults: { ...s.defaults, model: { ...s.defaults.model, [id]: v || undefined } } as any })} options={[{ value: '', label: 'Provider default' }, ...(list ?? []).map((x) => ({ value: x.id, label: x.name }))]} />
              </Row>
              {m && m.efforts.length > 0 && (
                <Row title={`${PROVIDER_NAME[id]} reasoning effort`}>
                  <Select value={s.defaults.effort[id] ?? ''} onChange={(v) => set({ defaults: { ...s.defaults, effort: { ...s.defaults.effort, [id]: v || undefined } } as any })} options={[{ value: '', label: 'Model default' }, ...m.efforts.map((e) => ({ value: e, label: e }))]} />
                </Row>
              )}
            </div>
          )
        })}
      </Section>
      <Section title="Agent instructions">
        <div className="p-4">
          <p className="mb-2 text-[12.5px] text-muted">Appended to the system prompt of every run (Claude Code: <code className="font-mono">--append-system-prompt</code>, Codex: developer instructions, OpenCode: system). Project files like CLAUDE.md and AGENTS.md still apply.</p>
          <textarea value={instr} onChange={(e) => setInstr(e.target.value)} rows={6} placeholder="e.g. Prefer small, reviewable commits. Explain risky changes before making them." aria-label="Agent instructions" className="selectable w-full resize-y rounded-xl border border-line bg-raised p-3 text-[13px] outline-none focus:border-accent" />
        </div>
      </Section>
    </>
  )
}

function Perms({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  return (
    <Section title="Default approval level">
      <Row title="New chats start in" desc="Each chat can change this from the composer. “Full access” is never the default and always needs confirmation in the composer."><Select value={s.defaults.permissionMode === 'full' ? 'ask' : s.defaults.permissionMode} onChange={(v) => set({ defaults: { ...s.defaults, permissionMode: v as any } })} options={[{ value: 'ask', label: 'Ask first' }, { value: 'auto-edit', label: 'Auto-accept edits' }, { value: 'plan', label: 'Plan only' }]} /></Row>
      <div className="px-4 py-3 text-[12.5px] leading-relaxed text-muted">Approvals use each provider’s native mechanism: Claude Code’s permission prompts, Codex’s approval policy + sandbox, and OpenCode’s permission rules. Every command and edit is recorded in the Activity panel.</div>
    </Section>
  )
}

function TerminalSettings({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const [shell, setShell] = useState(s.terminal.shell)
  useDebounced(shell, (v) => v !== s.terminal.shell && set({ terminal: { ...s.terminal, shell: v } }))
  return (
    <Section title="Integrated terminal">
      <Row title="Font size" desc={`${s.terminal.fontSize}px`}><input type="range" min={10} max={20} value={s.terminal.fontSize} onChange={(e) => set({ terminal: { ...s.terminal, fontSize: Number(e.target.value) } })} aria-label="Terminal font size" className="w-40 accent-[var(--accent)]" /></Row>
      <Row title="Shell" desc="Leave empty to use $SHELL. Applies to new terminals."><input value={shell} onChange={(e) => setShell(e.target.value)} placeholder="/bin/zsh" aria-label="Shell path" className="h-8 w-56 rounded-[10px] border border-line bg-raised px-3 font-mono text-[12px] outline-none focus:border-accent" /></Row>
    </Section>
  )
}

function Workspaces() {
  const projects = useApp((x) => x.projects)
  const add = useApp((x) => x.addProject)
  const remove = useApp((x) => x.removeProject)
  return (
    <Section title="Project folders" aside={<Button size="sm" onClick={() => void add()}><Plus size={13} /> Add</Button>}>
      {projects.length === 0 && <div className="p-8 text-center text-[13px] text-muted">No projects yet. Add a folder to group its chats in the sidebar.</div>}
      {projects.map((p) => (
        <div key={p.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
          <FolderGit2 size={16} className="text-muted" />
          <div className="min-w-0 flex-1"><div className="text-[13.5px] font-medium">{p.name}</div><div className="selectable truncate font-mono text-[12px] text-muted">{p.path}</div></div>
          <Button size="sm" variant="ghost" onClick={() => void remove(p.id)} aria-label={`Remove ${p.name}`}><Trash2 size={13} /></Button>
        </div>
      ))}
    </Section>
  )
}

const SHORTCUTS: [string, string][] = [['New chat', 'Ctrl N'], ['Search & commands', 'Ctrl K'], ['Toggle sidebar', 'Ctrl B'], ['Toggle terminal', 'Ctrl `'], ['Toggle activity panel', 'Ctrl \\'], ['Settings', 'Ctrl ,'], ['Focus message box', 'Ctrl L'], ['Send message', 'Enter'], ['New line', 'Shift Enter'], ['Stop generation', 'Esc']]

export function SettingsView() {
  const section = useApp((s) => s.settingsSection)
  const setSection = (id: string) => useApp.setState({ settingsSection: id })
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const setView = useApp((s) => s.setView)
  const info = useApp((s) => s.info)
  const set = (p: Partial<Settings>) => void setSettings(p)
  let body: ReactNode
  switch (section) {
    case 'appearance': body = <Appearance s={settings} set={set} />; break
    case 'providers': body = <Providers s={settings} set={set} />; break
    case 'models': body = <Models s={settings} set={set} />; break
    case 'skills': body = <Section title="Skills"><div className="p-5 text-[13px] text-muted">Skills are discovered live from each provider for your current project. <Button className="ml-2" size="sm" onClick={() => setView('skills')}>Open Skills</Button></div></Section>; break
    case 'permissions': body = <Perms s={settings} set={set} />; break
    case 'terminal': body = <TerminalSettings s={settings} set={set} />; break
    case 'workspaces': body = <Workspaces />; break
    case 'shortcuts': body = <Section title="Keyboard shortcuts">{SHORTCUTS.map(([a, k]) => <Row key={a} title={a}><div className="flex gap-1">{k.split(' ').map((x) => <Kbd key={x}>{x}</Kbd>)}</div></Row>)}</Section>; break
    case 'notifications': body = <Section title="Desktop notifications"><Row title="When a run finishes" desc="Only shown while Clivra is in the background."><Switch checked={settings.notifications.onComplete} onChange={(v) => set({ notifications: { ...settings.notifications, onComplete: v } })} label="Notify on completion" /></Row><Row title="When approval is needed" desc="Alerts you if an agent is waiting on a permission."><Switch checked={settings.notifications.onPermission} onChange={(v) => set({ notifications: { ...settings.notifications, onPermission: v } })} label="Notify on approval request" /></Row></Section>; break
    default: body = (
      <Section title="Application updates">
        <Row title="Clivra" desc={`Version ${info.version} · Electron ${info.electron} · ${info.platform}`}><span className="text-[12.5px] text-muted">Updated manually</span></Row>
        <div className="px-4 py-3 text-[12.5px] leading-relaxed text-muted">No update feed is configured in this build, so Clivra does not check for or install updates by itself. Update the agents themselves (Claude Code, Codex, OpenCode) with their own update commands — the Providers page tells you when a newer version is recommended.</div>
      </Section>
    )
  }
  return (
    <div className="flex h-full min-w-0">
      <nav className="w-[220px] shrink-0 space-y-px overflow-y-auto border-r border-line px-3 pb-6 pt-4" aria-label="Settings sections">
        <h1 className="font-display mb-3 px-3 pt-2 text-[30px] leading-none tracking-tight">Settings</h1>
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setSection(id)} className={cn('relative flex w-full items-center gap-2.5 rounded-[10px] px-3 py-1.5 text-left text-[13px] transition-colors', section === id ? 'text-fg' : 'text-muted hover:bg-sunken hover:text-fg')}>
            {section === id && <motion.span layoutId="settings-nav" transition={spring} className="absolute inset-0 rounded-[10px] bg-raised shadow-[var(--shadow-card)] ring-1 ring-line" />}
            <Icon size={15} className="relative" /><span className="relative">{label}</span>
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={section} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={base} className="mx-auto max-w-[680px] px-8 pb-16 pt-14">
            <h2 className="mb-6 text-[22px] font-semibold tracking-tight">{SECTIONS.find((x) => x.id === section)?.label}</h2>
            {body}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

export { Gauge }
