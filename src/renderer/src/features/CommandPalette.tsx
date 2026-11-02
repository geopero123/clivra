import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Activity, Network, Cable, MessageSquare, Moon, Plus, Search, Settings as Gear, Sparkles, SquareTerminal, Sun } from 'lucide-react'
import type { SearchHit } from '@shared/types'
import { cn } from '@/lib/cn'
import { spring } from '@/lib/motion'
import { timeAgo } from '@/lib/format'
import { useApp } from '@/lib/store'
import { Modal } from '@/ui'

interface Item { id: string; label: string; hint?: string; icon: React.ReactNode; run: () => void; snippet?: string }

function Snippet({ s }: { s: string }) {
  // eslint-disable-next-line no-control-regex
  const parts = s.split(/(\u0001[^\u0002]*\u0002)/)
  return <>{parts.map((p, i) => (p.startsWith('\u0001') ? <mark key={i} className="rounded bg-accent-soft px-0.5 text-accent">{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>))}</>
}

export function CommandPalette() {
  const open = useApp((s) => s.palette)
  const setOpen = useApp((s) => s.setPalette)
  const conversations = useApp((s) => s.conversations)
  const setView = useApp((s) => s.setView)
  const newChat = useApp((s) => s.newChat)
  const openConv = useApp((s) => s.openConversation)
  const toggle = useApp((s) => s.togglePanel)
  const setSettings = useApp((s) => s.setSettings)
  const theme = useApp((s) => s.settings.appearance.theme)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [sel, setSel] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const close = () => setOpen(false)

  useEffect(() => {
    if (!open) return
    setQ(''); setHits([]); setSel(0)
  }, [open])

  useEffect(() => {
    if (!q.trim()) return setHits([])
    const t = setTimeout(() => void window.clivra.conversations.search(q).then(setHits), 100)
    return () => clearTimeout(t)
  }, [q])

  const items = useMemo<Item[]>(() => {
    const actions: Item[] = [
      { id: 'new', label: 'New chat', hint: 'Ctrl N', icon: <Plus size={15} />, run: () => newChat() },
      { id: 'prov', label: 'Providers', icon: <Cable size={15} />, run: () => setView('providers') },
      { id: 'skills', label: 'Skills', icon: <Sparkles size={15} />, run: () => setView('skills') },
      { id: 'ana', label: 'Analytics', icon: <Activity size={15} />, run: () => setView('analytics') },
      { id: 'brain', label: 'Brain', icon: <Network size={15} />, run: () => setView('brain') },
      { id: 'set', label: 'Settings', hint: 'Ctrl ,', icon: <Gear size={15} />, run: () => setView('settings') },
      { id: 'term', label: 'Toggle terminal', hint: 'Ctrl `', icon: <SquareTerminal size={15} />, run: () => toggle('terminal') },
      { id: 'theme', label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', icon: theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />, run: () => void setSettings({ appearance: { theme: theme === 'dark' ? 'light' : 'dark' } } as any) }
    ]
    const needle = q.trim().toLowerCase()
    const acts = needle ? actions.filter((a) => a.label.toLowerCase().includes(needle)) : actions
    const convItems: Item[] = needle
      ? hits.map((h) => ({ id: `${h.conversationId}:${h.messageId}`, label: h.title, hint: timeAgo(h.updatedAt), snippet: h.snippet, icon: <MessageSquare size={15} />, run: () => void openConv(h.conversationId) }))
      : conversations.slice(0, 6).map((c) => ({ id: c.id, label: c.title, hint: timeAgo(c.updatedAt), icon: <MessageSquare size={15} />, run: () => void openConv(c.id) }))
    return [...acts, ...convItems]
  }, [q, hits, conversations, theme, newChat, setView, toggle, openConv, setSettings])

  useEffect(() => setSel(0), [q])
  useEffect(() => { (list.current?.querySelector(`[data-i="${sel}"]`) as HTMLElement | null)?.scrollIntoView({ block: 'nearest' }) }, [sel])

  const run = (it?: Item) => { if (!it) return; close(); it.run() }

  return (
    <Modal open={open} onClose={close} label="Command palette" className="max-w-[600px]">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
        <Search size={17} className="text-faint" />
        <input
          autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search conversations or run a command…"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)) }
            else if (e.key === 'Enter') { e.preventDefault(); run(items[sel]) }
          }}
          className="w-full bg-transparent text-[15px] outline-none placeholder:text-faint"
        />
      </div>
      <div ref={list} className="max-h-[380px] overflow-y-auto p-2">
        {items.length === 0 && <div className="px-4 py-10 text-center text-[13px] text-muted">No matches for “{q}”.</div>}
        {items.map((it, i) => (
          <button key={it.id} data-i={i} onMouseMove={() => setSel(i)} onClick={() => run(it)} className="relative flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left">
            {sel === i && <motion.span layoutId="palette-sel" transition={spring} className="absolute inset-0 rounded-xl bg-sunken" />}
            <span className={cn('relative mt-0.5 text-muted', sel === i && 'text-accent')}>{it.icon}</span>
            <span className="relative min-w-0 flex-1">
              <span className="block truncate text-[13.5px]">{it.label}</span>
              {it.snippet && <span className="selectable mt-0.5 line-clamp-2 block text-[12px] text-muted"><Snippet s={it.snippet} /></span>}
            </span>
            {it.hint && <span className="relative font-mono text-[11px] text-faint">{it.hint}</span>}
          </button>
        ))}
      </div>
    </Modal>
  )
}
