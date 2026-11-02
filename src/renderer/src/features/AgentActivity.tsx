import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Square } from 'lucide-react'
import type { AgentState } from '@shared/events'
import { cn } from '@/lib/cn'
import { spring } from '@/lib/motion'
import { duration } from '@/lib/format'
import { useApp } from '@/lib/store'

const META: Record<AgentState, { label: string; color: string }> = {
  idle: { label: 'Idle', color: 'var(--fg-faint)' },
  starting: { label: 'Starting', color: 'var(--accent)' },
  thinking: { label: 'Thinking', color: 'var(--accent)' },
  responding: { label: 'Writing', color: 'var(--ok)' },
  executing: { label: 'Working', color: 'var(--warn)' },
  waiting_approval: { label: 'Waiting for your approval', color: 'var(--warn)' }
}

export function Orb({ state, size = 22 }: { state: AgentState; size?: number }) {
  const m = META[state]
  const waiting = state === 'waiting_approval'
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <span className="pulse absolute inset-0 rounded-full" style={{ background: m.color, opacity: 0.25, animation: `pulse-ring ${waiting ? 1.1 : 1.8}s ease-out infinite` }} />
      <motion.span
        className="orb relative block rounded-full"
        animate={{ background: m.color, scale: state === 'executing' ? [1, 0.82, 1] : waiting ? [1, 1.12, 1] : 1 }}
        transition={{ background: { duration: 0.3 }, scale: { duration: state === 'executing' ? 0.9 : 1.2, repeat: Infinity, ease: 'easeInOut' } }}
        style={{ width: size * 0.45, height: size * 0.45, boxShadow: `0 0 14px ${m.color}` }}
      />
    </span>
  )
}

export function AgentActivity() {
  const id = useApp((s) => s.activeId)
  const live = useApp((s) => (s.activeId ? s.live[s.activeId] : undefined))
  const cancel = useApp((s) => s.cancel)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [live])
  const tools = live?.blocks.filter((b) => b.kind === 'tool' && b.status === 'running').length ?? 0
  return (
    <AnimatePresence initial={false}>
      {live && id && (
        <motion.div
          key="island"
          initial={{ opacity: 0, y: 10, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: 6, height: 0 }}
          transition={spring}
          className="overflow-hidden"
        >
          <div className="mx-2 mb-[-1px] flex items-center gap-3 rounded-t-2xl border border-b-0 border-line bg-sunken px-4 py-2.5">
            <Orb state={live.agent} />
            <div className="min-w-0 flex-1">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div key={live.agent} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16 }} className="flex items-baseline gap-2">
                  <span className={cn('text-[13px] font-medium', live.agent !== 'waiting_approval' && 'shimmer-text')} style={live.agent === 'waiting_approval' ? { color: 'var(--warn)' } : undefined}>
                    {META[live.agent].label}
                  </span>
                  {live.detail && live.agent !== 'responding' && <span className={cn('min-w-0 truncate text-[12.5px] text-muted', live.agent === 'executing' && 'font-mono text-[12px]')}>{live.detail}</span>}
                </motion.div>
              </AnimatePresence>
            </div>
            {tools > 1 && <span className="rounded-full bg-raised px-2 py-0.5 text-[11px] text-muted">{tools} running</span>}
            <span className="font-mono text-[11.5px] tabular-nums text-faint">{duration(now - live.startedAt)}</span>
            <button onClick={() => void cancel()} className="no-drag inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-raised px-2.5 text-[12px] font-medium transition hover:border-line-strong active:scale-95" aria-label="Stop generation">
              <Square size={10} fill="currentColor" /> Stop
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
