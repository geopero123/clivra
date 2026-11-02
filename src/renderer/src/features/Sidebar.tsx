import { memo, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronRight, FileJson, FileText, FolderGit2, FolderOpen, MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Settings as Gear, Sparkles, Trash2, Cable, X } from 'lucide-react'
import type { ConversationMeta } from '@shared/types'
import { PROVIDER_IDS } from '@shared/types'
import { cn } from '@/lib/cn'
import { base, spring } from '@/lib/motion'
import { groupLabel, timeAgo } from '@/lib/format'
import { useApp } from '@/lib/store'
import { Kbd, MenuItem, MenuSep, Popover, PROVIDER_COLOR, PROVIDER_NAME, Spinner } from '@/ui'

const ConvRow = memo(function ConvRow({ c, active }: { c: ConversationMeta; active: boolean }) {
  const open = useApp((s) => s.openConversation)
  const rename = useApp((s) => s.renameConversation)
  const pin = useApp((s) => s.pinConversation)
  const remove = useApp((s) => s.removeConversation)
  const toast = useApp((s) => s.toast)
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(c.title)
  const [confirmDel, setConfirmDel] = useState(false)
  const inView = active
  return (
    <div className="group/row relative" onContextMenu={(e) => { e.preventDefault(); setMenu(true) }}>
      {inView && <motion.span layoutId="conv-active" transition={spring} className="absolute inset-0 rounded-[10px] bg-raised shadow-[var(--shadow-card)] ring-1 ring-line" />}
      {editing ? (
        <input
          autoFocus value={val} onChange={(e) => setVal(e.target.value)}
          onBlur={() => { setEditing(false); if (val.trim() && val !== c.title) void rename(c.id, val) }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setVal(c.title); setEditing(false) } }}
          className="relative w-full rounded-[10px] border border-accent bg-surface px-2.5 py-1.5 text-[13px] outline-none"
        />
      ) : (
        <button onClick={() => void open(c.id)} className={cn('no-drag relative flex w-full items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-left transition-colors', active ? 'text-fg' : 'text-muted hover:bg-sunken hover:text-fg')}>
          <span className="size-1.5 shrink-0 rounded-full" style={{ background: PROVIDER_COLOR[c.provider], opacity: active ? 1 : 0.55 }} title={PROVIDER_NAME[c.provider]} />
          <span className="min-w-0 flex-1 truncate text-[13px]">{c.title}</span>
          {c.running ? <Spinner size={11} /> : <span className="text-[11px] text-faint group-hover/row:hidden">{timeAgo(c.updatedAt)}</span>}
        </button>
      )}
      {!editing && (
        <div className={cn('absolute right-1 top-1/2 -translate-y-1/2', menu ? 'block' : 'hidden group-hover/row:block')}>
          <Popover open={menu} onOpenChange={(o) => { setMenu(o); if (!o) setConfirmDel(false) }} align="end" className="w-48" trigger={
            <button aria-label="Conversation options" className="no-drag grid size-6 place-items-center rounded-md bg-sunken text-muted hover:text-fg"><MoreHorizontal size={14} /></button>
          }>
            <div className="p-1.5">
              <MenuItem icon={<Pencil size={14} />} onClick={() => { setMenu(false); setVal(c.title); setEditing(true) }}>Rename</MenuItem>
              <MenuItem icon={c.pinned ? <PinOff size={14} /> : <Pin size={14} />} onClick={() => { setMenu(false); void pin(c.id, !c.pinned) }}>{c.pinned ? 'Unpin' : 'Pin'}</MenuItem>
              <MenuItem icon={<FileText size={14} />} onClick={async () => { setMenu(false); const p = await window.clivra.conversations.exportTo(c.id, 'markdown'); if (p) toast({ kind: 'success', title: 'Exported', body: p }) }}>Export Markdown</MenuItem>
              <MenuItem icon={<FileJson size={14} />} onClick={async () => { setMenu(false); const p = await window.clivra.conversations.exportTo(c.id, 'json'); if (p) toast({ kind: 'success', title: 'Exported', body: p }) }}>Export JSON</MenuItem>
              <MenuSep />
              <MenuItem danger icon={<Trash2 size={14} />} onClick={() => { if (confirmDel) { setMenu(false); void remove(c.id) } else setConfirmDel(true) }}>{confirmDel ? 'Click again to delete' : 'Delete'}</MenuItem>
            </div>
          </Popover>
        </div>
      )}
    </div>
  )
})

function Group({ label, children, collapsible, icon, count, onAdd, onRemove }: { label: string; children: React.ReactNode; collapsible?: boolean; icon?: React.ReactNode; count?: number; onAdd?: () => void; onRemove?: () => void }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="mb-2">
      <div className="group/g flex items-center">
        <button onClick={() => collapsible && setOpen((o) => !o)} className={cn('no-drag flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-faint', collapsible && 'hover:text-muted')}>
          {collapsible && <ChevronRight size={12} className={cn('transition-transform duration-200', open && 'rotate-90')} />}
          {icon}
          <span className="truncate">{label}</span>
          {count !== undefined && <span className="font-mono text-[10px] normal-case">{count}</span>}
        </button>
        {onAdd && <button aria-label={`New chat in ${label}`} onClick={onAdd} className="no-drag mr-1 hidden size-5 place-items-center rounded text-faint hover:bg-sunken hover:text-fg group-hover/g:grid"><Plus size={12} /></button>}
        {onRemove && <button aria-label={`Remove ${label}`} onClick={onRemove} className="no-drag mr-1 hidden size-5 place-items-center rounded text-faint hover:bg-sunken hover:text-danger group-hover/g:grid"><X size={12} /></button>}
      </div>
      <AnimatePresence initial={false}>
        {open && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={base} className="overflow-hidden"><div className="space-y-px">{children}</div></motion.div>}
      </AnimatePresence>
    </div>
  )
}

export function Sidebar({ open }: { open: boolean }) {
  const conversations = useApp((s) => s.conversations)
  const projects = useApp((s) => s.projects)
  const activeId = useApp((s) => s.activeId)
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const newChat = useApp((s) => s.newChat)
  const setPalette = useApp((s) => s.setPalette)
  const providers = useApp((s) => s.providers)
  const addProject = useApp((s) => s.addProject)
  const removeProject = useApp((s) => s.removeProject)
  const width = useApp((s) => s.settings.sidebar.width)
  const setSettings = useApp((s) => s.setSettings)
  const platform = useApp((s) => s.info.platform)
  const [w, setW] = useState<number | null>(null)
  const drag = useRef(false)

  const { pinned, byProject, recent } = useMemo(() => {
    const pinned = conversations.filter((c) => c.pinned)
    const rest = conversations.filter((c) => !c.pinned)
    const byProject = new Map<string, ConversationMeta[]>()
    const recent: ConversationMeta[] = []
    for (const c of rest) {
      if (c.projectId && projects.some((p) => p.id === c.projectId)) byProject.set(c.projectId, [...(byProject.get(c.projectId) ?? []), c])
      else recent.push(c)
    }
    return { pinned, byProject, recent }
  }, [conversations, projects])

  const grouped = useMemo(() => {
    const m = new Map<string, ConversationMeta[]>()
    for (const c of recent) m.set(groupLabel(c.updatedAt), [...(m.get(groupLabel(c.updatedAt)) ?? []), c])
    return [...m.entries()]
  }, [recent])

  const current = w ?? width
  const row = (c: ConversationMeta) => <ConvRow key={c.id} c={c} active={view === 'chat' && c.id === activeId} />

  return (
    <motion.aside initial={false} animate={{ width: open ? current : 0, opacity: open ? 1 : 0 }} transition={drag.current ? { duration: 0 } : spring} className="relative shrink-0 overflow-hidden border-r border-line bg-surface/60" aria-hidden={!open}>
      <div className="flex h-full flex-col" style={{ width: current }}>
        <div className={cn('drag h-11 shrink-0', platform === 'darwin' && 'pl-[84px]')} />
        <div className="space-y-1 px-2.5 pb-2">
          <button onClick={() => newChat()} className="no-drag group flex w-full items-center gap-2.5 rounded-[11px] border border-line bg-raised px-3 py-2 text-[13px] font-medium shadow-[var(--shadow-card)] transition hover:border-line-strong active:scale-[0.98]">
            <span className="grid size-5 place-items-center rounded-md bg-accent text-accent-fg"><Plus size={13} strokeWidth={2.6} /></span>
            New chat
            <span className="ml-auto opacity-0 transition-opacity group-hover:opacity-100"><Kbd>Ctrl N</Kbd></span>
          </button>
          <button onClick={() => setPalette(true)} className="no-drag flex w-full items-center gap-2.5 rounded-[11px] px-3 py-1.5 text-[13px] text-muted transition-colors hover:bg-sunken hover:text-fg">
            <Search size={14} /> Search
            <span className="ml-auto"><Kbd>Ctrl K</Kbd></span>
          </button>
        </div>
        <nav className="space-y-px px-2.5 pb-2">
          {([['providers', Cable, 'Providers'], ['skills', Sparkles, 'Skills']] as const).map(([id, Icon, label]) => (
            <button key={id} onClick={() => setView(id)} className={cn('no-drag relative flex w-full items-center gap-2.5 rounded-[10px] px-3 py-1.5 text-[13px] transition-colors', view === id ? 'text-fg' : 'text-muted hover:bg-sunken hover:text-fg')}>
              {view === id && <motion.span layoutId="nav-active" transition={spring} className="absolute inset-0 rounded-[10px] bg-raised ring-1 ring-line shadow-[var(--shadow-card)]" />}
              <Icon size={15} className="relative" /> <span className="relative">{label}</span>
            </button>
          ))}
        </nav>
        <div className="mx-4 h-px bg-line" />
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          {conversations.length === 0 && projects.length === 0 && (
            <div className="px-3 py-8 text-center text-[12.5px] leading-relaxed text-faint">Your conversations will live here.<br />Start with a new chat.</div>
          )}
          {pinned.length > 0 && <Group label="Pinned" icon={<Pin size={11} />}>{pinned.map(row)}</Group>}
          <Group label="Projects" collapsible count={projects.length} onAdd={() => void addProject()}>
            {projects.length === 0 && <button onClick={() => void addProject()} className="no-drag mx-1 my-1 flex w-[calc(100%-8px)] items-center gap-2 rounded-lg border border-dashed border-line-strong px-2.5 py-2 text-left text-[12.5px] text-muted transition hover:border-accent hover:text-accent"><FolderOpen size={14} /> Add a project folder</button>}
            {projects.map((p) => (
              <Group key={p.id} label={p.name} collapsible icon={<FolderGit2 size={12} />} count={byProject.get(p.id)?.length ?? 0} onAdd={() => newChat({ cwd: p.path, projectId: p.id })} onRemove={() => void removeProject(p.id)}>
                {(byProject.get(p.id) ?? []).map(row)}
              </Group>
            ))}
          </Group>
          {grouped.map(([label, list]) => <Group key={label} label={label}>{list.map(row)}</Group>)}
        </div>
        <div className="flex items-center gap-1 border-t border-line p-2.5">
          <button onClick={() => setView('settings')} className={cn('no-drag flex flex-1 items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-[13px] transition-colors', view === 'settings' ? 'bg-raised text-fg ring-1 ring-line' : 'text-muted hover:bg-sunken hover:text-fg')}>
            <Gear size={15} /> Settings
          </button>
          <button onClick={() => setView('providers')} className="no-drag flex items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-sunken" aria-label="Provider status" title={providers.map((p) => `${p.name}: ${p.state}`).join('\n')}>
            {PROVIDER_IDS.map((id) => {
              const p = providers.find((x) => x.id === id)
              const color = p?.state === 'ready' ? 'var(--ok)' : p?.state === 'checking' ? 'var(--accent)' : p?.state === 'missing' ? 'var(--fg-faint)' : 'var(--warn)'
              return <span key={id} className={cn('size-2 rounded-full', p?.state === 'checking' && 'animate-pulse')} style={{ background: color }} />
            })}
          </button>
        </div>
      </div>
      {open && (
        <div
          onPointerDown={(e) => {
            drag.current = true
            const startX = e.clientX
            const start = width
            const move = (ev: PointerEvent) => setW(Math.min(420, Math.max(220, start + ev.clientX - startX)))
            const up = (ev: PointerEvent) => {
              window.removeEventListener('pointermove', move)
              window.removeEventListener('pointerup', up)
              const final = Math.min(420, Math.max(220, start + ev.clientX - startX))
              drag.current = false
              setW(null)
              void setSettings({ sidebar: { width: final } } as any)
            }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up)
          }}
          className="no-drag absolute inset-y-0 right-0 w-1.5 cursor-col-resize transition-colors hover:bg-accent/30"
          aria-label="Resize sidebar" role="separator"
        />
      )}
    </motion.aside>
  )
}
