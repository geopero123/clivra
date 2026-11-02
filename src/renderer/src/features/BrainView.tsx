import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Trash2, X } from 'lucide-react'
import type { BrainGraph, BrainKind, BrainNode } from '@shared/types'
import { BrainEngine, KIND_COLOR } from '@/lib/brain'
import { springLiquid } from '@/lib/motion'
import { useApp } from '@/lib/store'
import { Button, Spinner } from '@/ui'

const KINDS: [BrainKind, string][] = [['provider', 'Agents'], ['project', 'Projects'], ['model', 'Models'], ['tool', 'Tools'], ['category', 'Memory'], ['chat', 'Chats']]

export default function BrainView() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const engine = useRef<BrainEngine | null>(null)
  const [graph, setGraph] = useState<BrainGraph | null>(null)
  const [hover, setHover] = useState<BrainNode | null>(null)
  const [sel, setSel] = useState<BrainNode | null>(null)
  const [off, setOff] = useState<Set<BrainKind>>(new Set())
  const motionLevel = useApp((s) => s.settings.appearance.motion)
  const open = useApp((s) => s.openConversation)
  const live = useApp((s) => s.live)
  const conversations = useApp((s) => s.conversations)

  const load = () => void window.clivra.brain.get().then(setGraph)
  useEffect(load, [])
  useEffect(() => window.clivra.memory.onChanged(load), [])

  useEffect(() => {
    if (!graph || !canvas.current) return
    const e = new BrainEngine(canvas.current, graph, { onHover: setHover, onSelect: setSel }, { animate: motionLevel === 'full' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches })
    engine.current = e
    return () => { e.destroy(); engine.current = null }
  }, [graph, motionLevel])

  useEffect(() => {
    const kinds = new Set<BrainKind>(KINDS.map(([k]) => k).filter((k) => !off.has(k)))
    engine.current?.setFilter(off.size ? kinds : null)
  }, [off, graph])

  // Neurons fire for real: while an agent runs, its node and its conversation light up.
  useEffect(() => {
    const ids = Object.keys(live)
    if (!ids.length) return
    const t = setInterval(() => {
      for (const id of ids) {
        const c = conversations.find((x) => x.id === id)
        if (!c) continue
        engine.current?.fire(`p:${c.provider}`)
        engine.current?.fire(`h:${c.id}`)
      }
    }, 900)
    return () => clearInterval(t)
  }, [live, conversations])

  const stats = useMemo(() => (graph ? { n: graph.nodes.length, l: graph.links.length } : null), [graph])
  const shown = sel ?? hover

  return (
    <div className="relative h-full overflow-hidden text-fg">
      <canvas ref={canvas} className="absolute inset-0 size-full touch-none" aria-label="Neuron graph of your agents, projects, tools and memories" />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-3 px-8 pt-4">
        <div>
          <h1 className="font-display text-[40px] leading-none tracking-tight">Brain</h1>
          <p className="mt-2 max-w-[440px] text-[13px] text-muted">Everything your agents have touched, wired together. Drag nodes, scroll to zoom, click to inspect. Pulses are live signals.</p>
        </div>
        {stats && <div className="rounded-full border border-line bg-surface px-3 py-1 font-mono text-[11.5px] text-muted">{stats.n} neurons · {stats.l} synapses</div>}
      </div>
      <div className="absolute bottom-5 left-8 flex flex-wrap gap-1.5">
        {KINDS.map(([k, label]) => (
          <button key={k} onClick={() => setOff((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n })} className="no-drag flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-[12px] transition active:scale-95" style={{ opacity: off.has(k) ? 0.4 : 1 }}>
            <i className="size-2 rounded-full" style={{ background: KIND_COLOR[k], boxShadow: `0 0 8px ${KIND_COLOR[k]}` }} />{label}
          </button>
        ))}
      </div>
      {!graph && <div className="absolute inset-0 grid place-items-center"><Spinner size={22} /></div>}
      {graph && graph.nodes.length <= 4 && <div className="absolute inset-x-0 top-1/2 text-center text-[13px] text-muted">Your brain grows as you work. Chat with an agent and it will wire itself up.</div>}
      <AnimatePresence>
        {shown && (
          <motion.aside key={shown.id} initial={{ opacity: 0, x: 24, scale: 0.97 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 24 }} transition={springLiquid} className="absolute bottom-5 right-6 w-[300px] rounded-3xl border border-line-strong bg-raised p-4 shadow-[var(--shadow-pop)]">
            <div className="flex items-start gap-3">
              <span className="mt-1.5 size-3 shrink-0 rounded-full" style={{ background: KIND_COLOR[shown.kind], boxShadow: `0 0 12px ${KIND_COLOR[shown.kind]}` }} />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium uppercase tracking-wider text-faint">{shown.kind === 'category' ? 'memory group' : shown.kind}</div>
                <div className="selectable break-words text-[15px] font-semibold tracking-tight">{shown.label}</div>
                {shown.detail && <p className="selectable mt-1 break-words text-[13px] text-muted">{shown.detail}</p>}
              </div>
              {sel && <button onClick={() => setSel(null)} aria-label="Close" className="grid size-6 place-items-center rounded-md text-faint hover:bg-sunken"><X size={14} /></button>}
            </div>
            {sel?.kind === 'chat' && sel.ref && <Button className="mt-3" size="sm" variant="primary" onClick={() => void open(sel.ref!)}>Open chat</Button>}
            {sel?.kind === 'memory' && sel.ref && <Button className="mt-3" size="sm" variant="outline" onClick={() => { void window.clivra.memory.remove(Number(sel.ref)); setSel(null) }}><Trash2 size={13} /> Forget this</Button>}
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  )
}
