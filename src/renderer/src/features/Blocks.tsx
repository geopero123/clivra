import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  AlertTriangle, Bot, Brain, Check, ChevronRight, FilePen, FileText, Globe, ListChecks, Plug, Search, ShieldAlert, SquareTerminal, Wrench, X, Info
} from 'lucide-react'
import type { Block, ToolKind } from '@shared/events'
import { cn } from '@/lib/cn'
import { base, fast, spring } from '@/lib/motion'
import { duration } from '@/lib/format'
import { Button, Spinner } from '@/ui'
import { useApp } from '@/lib/store'
import { CopyButton, Markdown } from './Markdown'
import { DiffView } from './DiffView'

type ToolBlock = Extract<Block, { kind: 'tool' }>
type PermBlock = Extract<Block, { kind: 'permission' }>

export const KIND_ICON: Record<ToolKind, typeof Wrench> = {
  read: FileText, edit: FilePen, write: FilePen, bash: SquareTerminal, search: Search, fetch: Globe, agent: Bot, todo: ListChecks, mcp: Plug, other: Wrench
}
const KIND_VERB: Record<ToolKind, [string, string]> = {
  read: ['Reading', 'Read'], edit: ['Editing', 'Edited'], write: ['Writing', 'Wrote'], bash: ['Running', 'Ran'], search: ['Searching', 'Searched'],
  fetch: ['Fetching', 'Fetched'], agent: ['Agent', 'Agent'], todo: ['Tasks', 'Tasks'], mcp: ['Tool', 'Tool'], other: ['Tool', 'Tool']
}

function useElapsed(running: boolean, since: number): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [running])
  return now - since
}

export function ToolCard({ block }: { block: ToolBlock }) {
  const hasDiff = block.diffs.length > 0
  const [open, setOpen] = useState(hasDiff)
  const Icon = KIND_ICON[block.toolKind]
  const running = block.status === 'running'
  const elapsed = useElapsed(running, block.startedAt)
  const ms = block.endedAt ? block.endedAt - block.startedAt : elapsed
  const detailInput = block.input && typeof block.input === 'object' && !hasDiff && block.toolKind !== 'bash' ? JSON.stringify(block.input, null, 2) : null
  const hasBody = hasDiff || !!block.output || !!detailInput || block.toolKind === 'bash'
  // Diffs arrive after the card first renders; open once they do.
  useEffect(() => {
    if (hasDiff) setOpen(true)
  }, [hasDiff])
  return (
    <div className={cn('overflow-hidden rounded-xl border bg-surface transition-colors', running ? 'border-[color-mix(in_oklab,var(--accent)_45%,var(--line))]' : 'border-line')}>
      <button disabled={!hasBody} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors enabled:hover:bg-sunken">
        <span className={cn('grid size-6 shrink-0 place-items-center rounded-lg', block.status === 'error' ? 'bg-[color-mix(in_oklab,var(--danger)_14%,transparent)] text-danger' : 'bg-sunken text-muted')}>
          <Icon size={13} />
        </span>
        <span className="shrink-0 text-[12.5px] text-muted">{KIND_VERB[block.toolKind][running ? 0 : 1]}</span>
        <span className={cn('min-w-0 flex-1 truncate text-[12.5px]', block.toolKind === 'bash' && 'font-mono')}>{block.title}</span>
        <span className="shrink-0 font-mono text-[11px] text-faint">{ms > 800 ? duration(ms) : ''}</span>
        <span className="grid size-5 shrink-0 place-items-center">
          {running ? <Spinner size={12} /> : block.status === 'error' ? <X size={14} className="text-danger" /> : <Check size={14} className="text-ok" />}
        </span>
        {hasBody && <ChevronRight size={14} className={cn('shrink-0 text-faint transition-transform duration-200', open && 'rotate-90')} />}
      </button>
      <AnimatePresence initial={false}>
        {open && hasBody && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={base} className="overflow-hidden">
            <div className="space-y-2 border-t border-line p-2.5">
              {block.diffs.map((d) => (
                <DiffView key={d.path} diff={d} />
              ))}
              {block.toolKind === 'bash' && (
                <div className="group/out relative">
                  <pre className="selectable max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-sunken p-3 font-mono text-[12px] leading-[1.55]">
                    <span className="text-accent">$ </span>
                    {block.title}
                    {block.output ? `\n${block.output}` : running ? '' : '\n(no output)'}
                  </pre>
                  <CopyButton text={block.output ?? ''} className="absolute right-1.5 top-1.5 opacity-0 group-hover/out:opacity-100" label="Copy output" />
                </div>
              )}
              {!hasDiff && block.toolKind !== 'bash' && block.output && (
                <pre className="selectable max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-sunken p-3 font-mono text-[12px] leading-[1.55]">{block.output.slice(0, 20000)}</pre>
              )}
              {detailInput && !block.output && <pre className="selectable max-h-48 overflow-auto rounded-lg bg-sunken p-3 font-mono text-[11.5px] text-muted">{detailInput}</pre>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function ThinkingBlock({ block, streaming }: { block: Extract<Block, { kind: 'thinking' }>; streaming: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="group flex items-center gap-2 rounded-lg py-1 text-[12.5px] text-muted transition-colors hover:text-fg">
        <Brain size={14} className={cn(streaming && 'text-accent')} />
        <span className={cn(streaming && 'shimmer-text')}>{streaming ? 'Thinking' : 'Reasoning'}</span>
        <ChevronRight size={13} className={cn('text-faint transition-transform duration-200', open && 'rotate-90')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={base} className="overflow-hidden">
            <div className="ml-[7px] mt-1 border-l-2 border-line pl-4 text-[13px] text-muted">
              <Markdown text={block.text} streaming={streaming} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function PermissionCard({ block }: { block: PermBlock }) {
  const respond = useApp((s) => s.respondPermission)
  const pending = block.status === 'pending'
  const Icon = KIND_ICON[block.toolKind]
  if (!pending) {
    const denied = block.status === 'denied'
    const chosen = block.options.find((o) => o.id === block.chosen)
    return (
      <motion.div layout initial={{ opacity: 0.6 }} animate={{ opacity: 1 }} className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2 text-[12.5px] text-muted">
        {denied ? <X size={14} className="text-danger" /> : <Check size={14} className="text-ok" />}
        <span className="min-w-0 flex-1 truncate">
          {denied ? 'Denied' : chosen?.kind === 'allow_always' ? 'Always allowed' : 'Allowed'} · {block.title}
        </span>
      </motion.div>
    )
  }
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring}
      role="alertdialog"
      aria-label="Permission request"
      className="relative overflow-hidden rounded-2xl border border-[color-mix(in_oklab,var(--warn)_55%,var(--line))] bg-[color-mix(in_oklab,var(--warn)_7%,var(--surface))] p-4 shadow-[var(--shadow-card)]"
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-warn to-transparent opacity-70" />
      <div className="flex items-start gap-3">
        <span className="relative mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-[color-mix(in_oklab,var(--warn)_18%,transparent)] text-warn">
          <ShieldAlert size={16} />
          <span className="pulse absolute inset-0 rounded-xl border border-warn" style={{ animation: 'pulse-ring 2s ease-out infinite' }} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold">Approval needed</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted">
            <Icon size={13} /> <span className="selectable break-all">{block.title}</span>
          </div>
          {block.detail && <pre className="selectable mt-2.5 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-sunken p-3 font-mono text-[12px] leading-[1.55]">{block.detail}</pre>}
          <div className="mt-3.5 flex flex-wrap gap-2">
            {block.options.map((o) => (
              <Button key={o.id} size="sm" variant={o.kind === 'allow_once' ? 'primary' : o.kind === 'deny' ? 'outline' : 'secondary'} onClick={() => void respond(block.requestId, o.id)}>
                {o.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

export function NoticeBlock({ block }: { block: Extract<Block, { kind: 'notice' }> }) {
  const Icon = block.level === 'error' ? AlertTriangle : block.level === 'warning' ? AlertTriangle : Info
  const color = block.level === 'error' ? 'var(--danger)' : block.level === 'warning' ? 'var(--warn)' : 'var(--accent)'
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={fast} className="flex items-start gap-3 rounded-xl border px-3.5 py-2.5 text-[13px]" style={{ borderColor: `color-mix(in oklab, ${color} 35%, var(--line))`, background: `color-mix(in oklab, ${color} 7%, transparent)` }}>
      <Icon size={15} className="mt-0.5 shrink-0" style={{ color }} />
      <div className="selectable min-w-0 flex-1 whitespace-pre-wrap break-words">
        {block.message}
        {block.action && (
          <button onClick={() => void window.clivra.app.openExternal(block.action!.url)} className="ml-2 font-medium underline underline-offset-2" style={{ color }}>
            {block.action.label}
          </button>
        )}
      </div>
    </motion.div>
  )
}
