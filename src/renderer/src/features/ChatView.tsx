import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowDown, Download, FileJson, FileText as FileMd, GitBranch, MoreHorizontal, PanelLeft, PanelRight, SquareTerminal, Trash2, Pin, PinOff } from 'lucide-react'
import type { StoredMessage } from '@shared/types'
import { cn } from '@/lib/cn'
import { base, spring } from '@/lib/motion'
import { useActiveConversation, useApp, useChatConfig } from '@/lib/store'
import { IconButton, MenuItem, MenuSep, Popover, PROVIDER_NAME, ProviderMark } from '@/ui'
import { MessageView, BlocksView } from './Message'
import { Composer } from './Composer'
import { PROVIDER_COLOR } from '@/ui'

const SUGGESTIONS = [
  'Give me a tour of this codebase and how it fits together',
  'Review my uncommitted changes and point out risks',
  'Find and fix the most likely bug in this project',
  'Write tests for the code I changed most recently'
]

export function Header({ onToggleSidebar, sidebarOpen }: { onToggleSidebar: () => void; sidebarOpen: boolean }) {
  const conv = useActiveConversation()
  const cfg = useChatConfig()
  const git = useApp((s) => s.git[cfg.cwd])
  const panels = useApp((s) => s.panels)
  const toggle = useApp((s) => s.togglePanel)
  const rename = useApp((s) => s.renameConversation)
  const pin = useApp((s) => s.pinConversation)
  const remove = useApp((s) => s.removeConversation)
  const toast = useApp((s) => s.toast)
  const platform = useApp((s) => s.info.platform)
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState('')
  const [menu, setMenu] = useState(false)
  const mac = platform === 'darwin'
  return (
    <header className={cn('drag flex h-11 shrink-0 items-center gap-1 border-b border-line/0 px-3', !sidebarOpen && mac && 'pl-[84px]', platform !== 'darwin' && 'pr-[150px]')}>
      <IconButton label={sidebarOpen ? 'Hide sidebar (Ctrl+B)' : 'Show sidebar (Ctrl+B)'} onClick={onToggleSidebar}><PanelLeft size={17} /></IconButton>
      <div className="flex min-w-0 flex-1 items-center justify-center gap-3">
        {editing && conv ? (
          <input
            autoFocus value={val} onChange={(e) => setVal(e.target.value)}
            onBlur={() => { setEditing(false); if (val.trim() && val !== conv.title) void rename(conv.id, val) }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setVal(conv.title); setEditing(false) } }}
            className="no-drag w-72 rounded-lg border border-line-strong bg-surface px-2.5 py-1 text-center text-[13.5px] font-medium outline-none focus:border-accent"
          />
        ) : (
          <button className="no-drag max-w-[420px] truncate rounded-lg px-2.5 py-1 text-[13.5px] font-medium transition-colors hover:bg-sunken" onDoubleClick={() => conv && (setVal(conv.title), setEditing(true))} title={conv ? 'Double-click to rename' : undefined}>
            {conv?.title ?? 'New chat'}
          </button>
        )}
        {git?.isRepo && (
          <span className="hidden items-center gap-1 rounded-full border border-line bg-sunken px-2 py-0.5 font-mono text-[11px] text-muted md:inline-flex" title={`${git.dirty ?? 0} changed file(s)`}>
            <GitBranch size={11} /> {git.branch}{git.dirty ? <span className="text-warn">●{git.dirty}</span> : null}
          </span>
        )}
      </div>
      <IconButton label="Activity & changes" active={panels.activity} onClick={() => toggle('activity')}><PanelRight size={17} /></IconButton>
      <IconButton label="Terminal (Ctrl+`)" active={panels.terminal} onClick={() => toggle('terminal')}><SquareTerminal size={17} /></IconButton>
      {conv && (
        <Popover open={menu} onOpenChange={setMenu} align="end" className="w-52" trigger={<IconButton label="More" active={menu}><MoreHorizontal size={17} /></IconButton>}>
          <div className="p-1.5">
            <MenuItem icon={conv.pinned ? <PinOff size={14} /> : <Pin size={14} />} onClick={() => { setMenu(false); void pin(conv.id, !conv.pinned) }}>{conv.pinned ? 'Unpin' : 'Pin'}</MenuItem>
            <MenuItem icon={<FileMd size={14} />} onClick={async () => { setMenu(false); const p = await window.clivra.conversations.exportTo(conv.id, 'markdown'); if (p) toast({ kind: 'success', title: 'Exported', body: p }) }}>Export as Markdown</MenuItem>
            <MenuItem icon={<FileJson size={14} />} onClick={async () => { setMenu(false); const p = await window.clivra.conversations.exportTo(conv.id, 'json'); if (p) toast({ kind: 'success', title: 'Exported', body: p }) }}>Export as JSON</MenuItem>
            <MenuSep />
            <MenuItem danger icon={<Trash2 size={14} />} onClick={() => { setMenu(false); void remove(conv.id) }}>Delete chat</MenuItem>
          </div>
        </Popover>
      )}
      {!conv && <span className="w-8" />}
      <Download className="hidden" />
    </header>
  )
}

function EmptyState() {
  const cfg = useChatConfig()
  const providers = useApp((s) => s.providers)
  const setView = useApp((s) => s.setView)
  const git = useApp((s) => s.git[cfg.cwd])
  const ready = providers.filter((p) => p.state === 'ready' || p.state === 'update-recommended')
  const checking = providers.some((p) => p.state === 'checking')
  return (
    <div className="relative h-full">
    <div className="ambient" aria-hidden><i className="loop" /><i className="loop" /><i className="loop" /></div>
    <div className="relative mx-auto flex h-full max-w-[640px] flex-col items-center justify-center px-6 pb-24 text-center">
      <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={spring} className="mb-6 flex gap-3">
        {(['claude', 'codex', 'opencode'] as const).map((id, i) => (
          <motion.span key={id} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ ...spring, delay: 0.06 * i }} className={cn('rounded-xl transition-all duration-300', id === cfg.provider ? 'scale-110' : 'opacity-50 grayscale-[.5]')}>
            <ProviderMark id={id} size={20} />
          </motion.span>
        ))}
      </motion.div>
      <motion.h1 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...base, delay: 0.1 }} className="font-display text-[44px] leading-[1.05] tracking-tight">
        What shall we build?
      </motion.h1>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ ...base, delay: 0.2 }} className="mt-3 text-[14px] text-muted">
        {PROVIDER_NAME[cfg.provider]} is working in <span className="font-mono text-fg">{cfg.cwd.split(/[\\/]/).filter(Boolean).pop() ?? '~'}</span>
        {git?.isRepo ? <> on <span className="font-mono text-fg">{git.branch}</span></> : null}.
      </motion.p>
      {!checking && ready.length === 0 && (
        <motion.button initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={base} onClick={() => setView('providers')} className="mt-6 rounded-2xl border border-[color-mix(in_oklab,var(--warn)_45%,var(--line))] bg-[color-mix(in_oklab,var(--warn)_8%,transparent)] px-4 py-3 text-left text-[13px] transition hover:brightness-110">
          <div className="font-medium">No AI agent is ready yet</div>
          <div className="text-muted">Install or sign in to Claude Code, Codex or OpenCode — open Providers for guided setup.</div>
        </motion.button>
      )}
      <div className="mt-8 grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s, i) => (
          <motion.button key={s} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...base, delay: 0.25 + i * 0.05 }} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} onClick={() => window.dispatchEvent(new CustomEvent('clivra:fill-composer', { detail: s }))} className="rounded-2xl border border-line bg-surface px-3.5 py-3 text-left text-[13px] leading-snug text-muted shadow-[var(--shadow-card)] transition-colors hover:border-line-strong hover:text-fg">
            {s}
          </motion.button>
        ))}
      </div>
    </div>
    </div>
  )
}

function MessageList({ composerH }: { composerH: number }) {
  const id = useApp((s) => s.activeId)
  const messages = useApp((s) => (s.activeId ? s.messages[s.activeId] : undefined))
  const live = useApp((s) => (s.activeId ? s.live[s.activeId] : undefined))
  const scrollTick = useApp((s) => s.scrollTick)
  const conv = useActiveConversation()
  const parent = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [away, setAway] = useState(false)
  const initialCount = useRef(0)

  const rows = useMemo<StoredMessage[]>(() => {
    const list = messages ?? []
    if (!live) return list
    return [...list, { id: 'live', conversationId: id ?? '', role: 'assistant', blocks: live.blocks, provider: conv?.provider, model: live.model ?? conv?.model ?? undefined, status: 'streaming', createdAt: live.startedAt }]
  }, [messages, live, id, conv?.provider, conv?.model])

  useEffect(() => {
    initialCount.current = messages?.length ?? 0
    stick.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 160,
    overscan: 6,
    getItemKey: (i) => rows[i]?.id ?? i
  })

  const toBottom = useCallback((smooth = false) => {
    const el = parent.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  const totalSize = virt.getTotalSize()
  useLayoutEffect(() => {
    if (stick.current) toBottom()
  }, [scrollTick, rows.length, totalSize, id, toBottom, composerH])

  const onScroll = () => {
    const el = parent.current!
    const d = el.scrollHeight - el.scrollTop - el.clientHeight
    stick.current = d < 100
    setAway(d > 400)
  }

  if (messages === undefined && id) {
    return (
      <div className="mx-auto max-w-[780px] space-y-6 px-6 pt-8">
        {[0, 1, 2].map((i) => <div key={i} className="space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-16 w-full" /></div>)}
      </div>
    )
  }
  if (rows.length === 0) return <EmptyState />

  return (
    <div className="relative h-full">
      <div ref={parent} onScroll={onScroll} className="h-full overflow-y-auto overflow-x-hidden" style={{ paddingBottom: composerH + 16 }}>
        <div className="relative mx-auto w-full max-w-[780px] px-6" style={{ height: virt.getTotalSize() }}>
          {virt.getVirtualItems().map((v) => {
            const m = rows[v.index]
            return (
              <div key={v.key} data-index={v.index} ref={virt.measureElement} className="absolute left-0 top-0 w-full px-6" style={{ transform: `translateY(${v.start}px)` }}>
                {m.id === 'live' ? <LiveAssistant msg={m} /> : <MessageView msg={m} animate={v.index >= initialCount.current} />}
              </div>
            )
          })}
        </div>
      </div>
      <AnimatePresence>
        {away && (
          <motion.button initial={{ opacity: 0, y: 8, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.9 }} transition={spring} onClick={() => { stick.current = true; toBottom(true) }} aria-label="Scroll to latest" className="no-drag absolute left-1/2 grid size-9 -translate-x-1/2 place-items-center rounded-full border border-line-strong bg-[var(--glass)] shadow-[var(--shadow-pop)] backdrop-blur-xl" style={{ bottom: composerH + 20 }}>
            <ArrowDown size={16} />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}

function LiveAssistant({ msg }: { msg: StoredMessage }) {
  return (
    <div className="py-3">
      <div className="mb-2 flex items-center gap-2">
        {msg.provider && <ProviderMark id={msg.provider} size={13} />}
        <span className="text-[12.5px] font-medium text-muted">{msg.provider ? PROVIDER_NAME[msg.provider] : 'Assistant'}</span>
        {msg.model && <span className="truncate font-mono text-[11px] text-faint">{msg.model}</span>}
      </div>
      {msg.blocks.length === 0 ? <TypingDots color={msg.provider ? PROVIDER_COLOR[msg.provider] : undefined} /> : <BlocksView blocks={msg.blocks} streaming />}
    </div>
  )
}

export function TypingDots({ color = 'var(--accent)' }: { color?: string }) {
  return (
    <div className="flex h-6 items-center gap-1" aria-label="Working">
      {[0, 1, 2].map((i) => <span key={i} className="loop size-1.5 rounded-full" style={{ background: color, animation: `wobble 1.2s ${i * 0.16}s infinite ease-in-out` }} />)}
    </div>
  )
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-xl', className)} />
}

export function ChatView({ onToggleSidebar, sidebarOpen }: { onToggleSidebar: () => void; sidebarOpen: boolean }) {
  const [composerH, setComposerH] = useState(150)
  const id = useApp((s) => s.activeId)
  return (
    <div className="flex h-full min-w-0 flex-col">
      <Header onToggleSidebar={onToggleSidebar} sidebarOpen={sidebarOpen} />
      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={id ?? 'draft'} className="absolute inset-0" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            <MessageList composerH={composerH} />
          </motion.div>
        </AnimatePresence>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[var(--bg)] via-[var(--bg)]/85 to-transparent" />
        <div className="absolute inset-x-0 bottom-0">
          <Composer onHeight={setComposerH} />
        </div>
      </div>
    </div>
  )
}
