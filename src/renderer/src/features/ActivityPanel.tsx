import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { FileDiff as FileDiffIcon, GitCompare, History, ShieldCheck } from 'lucide-react'
import type { ActivityEntry } from '@shared/types'
import type { FileDiff } from '@shared/events'
import { cn } from '@/lib/cn'
import { base, spring } from '@/lib/motion'
import { timeAgo } from '@/lib/format'
import { useApp, useChatConfig } from '@/lib/store'
import { Button, Segmented, Spinner } from '@/ui'
import { DiffView } from './DiffView'
import { splitGitDiff } from '@/lib/diff'
import { KIND_ICON } from './Blocks'

const KIND_TO_ICON = { command: KIND_ICON.bash, edit: KIND_ICON.edit, read: KIND_ICON.read, tool: KIND_ICON.other, permission: ShieldCheck }

function ActivityList() {
  const cfg = useChatConfig()
  const live = useApp((s) => (cfg.id ? s.live[cfg.id] : undefined))
  const [scope, setScope] = useState<'chat' | 'all'>('chat')
  const [rows, setRows] = useState<ActivityEntry[]>([])
  const tick = useApp((s) => s.conversations.find((c) => c.id === cfg.id)?.updatedAt)
  const liveTools = live?.blocks.filter((b) => b.kind === 'tool' && b.status === 'running') ?? []
  useEffect(() => {
    void window.clivra.conversations.activity(scope === 'chat' ? (cfg.id ?? undefined) : undefined, 150).then(setRows)
  }, [scope, cfg.id, tick, live?.blocks.length])
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pb-2"><Segmented value={scope} onChange={setScope} options={[{ value: 'chat', label: 'This chat' }, { value: 'all', label: 'All chats' }]} /></div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {liveTools.map((t) => t.kind === 'tool' && (
          <div key={t.id} className="mb-1 flex items-center gap-2.5 rounded-xl border border-[color-mix(in_oklab,var(--accent)_40%,var(--line))] bg-accent-soft px-3 py-2">
            <Spinner size={12} /><span className="min-w-0 flex-1 truncate font-mono text-[12px]">{t.title}</span>
          </div>
        ))}
        {rows.length === 0 && liveTools.length === 0 && <div className="px-3 py-10 text-center text-[12.5px] text-faint">Commands, edits and approvals will be listed here as the agent works.</div>}
        <AnimatePresence initial={false}>
          {rows.map((r) => {
            const Icon = KIND_TO_ICON[r.kind]
            return (
              <motion.div key={r.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={base} className="flex items-start gap-2.5 rounded-xl px-3 py-2 hover:bg-sunken">
                <Icon size={14} className={cn('mt-0.5 shrink-0', r.status === 'error' || r.status === 'denied' ? 'text-danger' : 'text-muted')} />
                <div className="min-w-0 flex-1">
                  <div className={cn('truncate text-[12.5px]', r.kind === 'command' && 'font-mono text-[12px]')} title={r.summary}>{r.summary}</div>
                  <div className="text-[11px] text-faint">{r.provider} · {timeAgo(r.ts)}{r.status === 'error' ? ' · failed' : ''}</div>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}

function Changes() {
  const cfg = useChatConfig()
  const messages = useApp((s) => (cfg.id ? s.messages[cfg.id] : undefined))
  const live = useApp((s) => (cfg.id ? s.live[cfg.id] : undefined))
  const [tree, setTree] = useState<FileDiff[] | null>(null)
  const [loading, setLoading] = useState(false)
  const git = useApp((s) => s.git[cfg.cwd])
  const session = useMemo(() => {
    const map = new Map<string, FileDiff>()
    const blocks = [...(messages ?? []).flatMap((m) => m.blocks), ...(live?.blocks ?? [])]
    for (const b of blocks) if (b.kind === 'tool') for (const d of b.diffs) map.set(d.path, d)
    return [...map.values()]
  }, [messages, live])
  const load = async () => {
    setLoading(true)
    try { setTree(splitGitDiff(await window.clivra.projects.gitDiff(cfg.cwd))) } finally { setLoading(false) }
  }
  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
      <div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-faint">Edited in this chat · {session.length}</div>
        {session.length === 0 && <p className="text-[12.5px] text-faint">No file edits reported yet.</p>}
        <div className="space-y-2">{session.map((d) => <DiffView key={d.path} diff={d} defaultOpen={false} compact />)}</div>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-faint">Working tree {git?.isRepo ? `· ${git.dirty ?? 0} changed` : ''}</span>
          <Button size="sm" variant="ghost" disabled={!git?.isRepo || loading} onClick={() => void load()}>{loading ? <Spinner size={12} /> : <GitCompare size={13} />} {tree ? 'Refresh' : 'Load git diff'}</Button>
        </div>
        {!git?.isRepo && <p className="text-[12.5px] text-faint">This folder is not a git repository.</p>}
        {tree && tree.length === 0 && <p className="text-[12.5px] text-faint">No uncommitted changes.</p>}
        <div className="space-y-2">{tree?.map((d) => <DiffView key={d.path} diff={d} defaultOpen={false} compact />)}</div>
      </div>
    </div>
  )
}

export function ActivityPanel() {
  const open = useApp((s) => s.panels.activity)
  const [tab, setTab] = useState<'activity' | 'changes'>('activity')
  return (
    <motion.aside initial={false} animate={{ width: open ? 360 : 0, opacity: open ? 1 : 0 }} transition={spring} className="shrink-0 overflow-hidden border-l border-line bg-surface/60" aria-hidden={!open}>
      <div className="flex h-full w-[360px] flex-col">
        <div className="drag h-11 shrink-0" />
        <div className="px-4 pb-3">
          <Segmented value={tab} onChange={setTab} options={[{ value: 'activity', label: <span className="flex items-center gap-1.5"><History size={13} />Activity</span> }, { value: 'changes', label: <span className="flex items-center gap-1.5"><FileDiffIcon size={13} />Changes</span> }]} />
        </div>
        {tab === 'activity' ? <ActivityList /> : <Changes />}
      </div>
    </motion.aside>
  )
}
