import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Square } from 'lucide-react'
import type { AgentState } from '@shared/events'
import { cn } from '@/lib/cn'
import { springLiquid as spring } from '@/lib/motion'
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
  const fast = state === 'executing' || state === 'waiting_approval'
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size, ['--c' as string]: m.color }}>
      <span className="pulse loop absolute inset-0 rounded-full" style={{ background: m.color, opacity: 0.22, animation: `pulse-ring ${fast ? 1.1 : 1.9}s ease-out infinite` }} />
      <span className={cn('blob loop absolute block transition-[--c] duration-300', fast && 'fast')} style={{ width: size * 0.62, height: size * 0.62, transition: 'background 0.3s' }} />
      <span className="blob loop absolute block opacity-60" style={{ width: size * 0.34, height: size * 0.34, animationDirection: 'reverse', animationDuration: '5s', translate: `${size * 0.14}px ${-size * 0.1}px` }} />
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
          <div className="relative mx-2 mb-[-1px] flex items-center gap-3 overflow-hidden rounded-t-2xl border border-b-0 border-line bg-sunken px-4 py-2.5" style={{ ['--c' as string]: META[live.agent].color }}>
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
            <div className="wave-line loop pointer-events-none absolute inset-x-0 bottom-0" />
            <button onClick={() => void cancel()} className="ripple no-drag inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-raised px-2.5 text-[12px] font-medium transition hover:border-line-strong active:scale-95" aria-label="Stop generation">
              <Square size={10} fill="currentColor" /> Stop
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
