import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { ProviderId } from '@shared/types'
import { cn } from '@/lib/cn'
import { fmt, niceMax, type DayTotal } from '@/lib/stats'
import { PROVIDER_COLOR, PROVIDER_NAME } from '@/ui'

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export function useCountUp(value: number, ms = 900): number {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (document.documentElement.dataset.motion !== 'full') return setV(value)
    const t0 = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      setV(value * (1 - Math.pow(1 - k, 4)))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return v
}

export function CountUp({ value, format = (n: number) => Math.round(n).toLocaleString() }: { value: number; format?: (n: number) => string }) {
  return <>{format(useCountUp(value))}</>
}

export function Card({ title, sub, aside, children, className }: { title?: string; sub?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('min-w-0 rounded-3xl border border-line bg-surface p-5 shadow-[var(--shadow-card)]', className)}>
      {(title || aside) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h3 className="text-[14px] font-semibold tracking-tight">{title}</h3>}
            {sub && <p className="mt-0.5 text-[12.5px] text-muted">{sub}</p>}
          </div>
          {aside}
        </div>
      )}
      {children}
    </section>
  )
}

export function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
      {items.map(([l, c]) => (
        <span key={l} className="flex items-center gap-1.5"><i className="inline-block size-2 rounded-[3px]" style={{ background: c }} />{l}</span>
      ))}
    </div>
  )
}

const PK: ProviderId[] = ['claude', 'codex', 'opencode']
const dl = (d: Date, long?: boolean) => d.toLocaleDateString(undefined, long ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' })

function Tip({ x, w, children }: { x: number; w: number; children: ReactNode }) {
  const left = x < w / 2 ? x + 14 : undefined
  const right = x >= w / 2 ? w - x + 14 : undefined
  return <div className="pointer-events-none absolute top-1 z-10 min-w-[130px] rounded-xl border border-line-strong bg-raised px-3 py-2 text-[12px] shadow-[var(--shadow-pop)]" style={{ left, right }}>{children}</div>
}

/** Tokens per day, stacked by provider, drawn to one shared scale. */
export function StackedBars({ days, height = 210 }: { days: DayTotal[]; height?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [hi, setHi] = useState<number | null>(null)
  const L = 38, R = 6, T = 8, B = 22, n = days.length
  const mx = niceMax(Math.max(1, ...days.map((d) => d.tokens)))
  const cw = (w - L - R) / n
  const bw = Math.max(3, Math.min(24, cw * 0.66))
  const step = Math.ceil(n / (w < 520 ? 5 : 10))
  return (
    <div ref={ref} className="chart relative" onPointerLeave={() => setHi(null)} onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const i = Math.floor((e.clientX - r.left - L) / cw); setHi(i >= 0 && i < n ? i : null) }}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label="Tokens per day by agent">
          {[0, 1, 2, 3, 4].map((g) => { const y = T + (height - T - B) * (1 - g / 4); return <g key={g}><line className="grid-l" x1={L} x2={w - R} y1={y} y2={y} /><text x={L - 6} y={y + 3.5} textAnchor="end">{fmt((mx * g) / 4)}</text></g> })}
          {days.map((d, i) => {
            let acc = 0
            const x = L + cw * i + (cw - bw) / 2
            return (
              <g key={d.day} opacity={hi === null || hi === i ? 1 : 0.45}>
                {PK.map((p) => { const v = d.byProvider[p]; if (!v) return null; const bh = (v / mx) * (height - T - B); const y = height - B - acc - bh; acc += bh; return <rect key={p} className="bar-r" x={x} y={y} width={bw} height={Math.max(0, bh - 1)} rx={Math.min(3, bw / 2)} fill={PROVIDER_COLOR[p]} style={{ animationDelay: `${Math.min(i, 60) * 12}ms` }} /> })}
                {i % step === 0 && <text x={x + bw / 2} y={height - 6} textAnchor="middle">{dl(d.date)}</text>}
              </g>
            )
          })}
        </svg>
      )}
      {hi !== null && days[hi] && (
        <Tip x={L + cw * hi + cw / 2} w={w}>
          <b className="mb-1 block">{dl(days[hi].date, true)}</b>
          {PK.map((p) => <div key={p} className="flex justify-between gap-4 text-muted"><span className="flex items-center gap-1.5"><i className="size-2 rounded-[2px]" style={{ background: PROVIDER_COLOR[p] }} />{PROVIDER_NAME[p]}</span><span className="text-fg">{fmt(days[hi!].byProvider[p])}</span></div>)}
          <div className="mt-1 flex justify-between border-t border-line pt-1 text-muted"><span>{days[hi].prompts} prompts</span><span className="text-fg">{fmt(days[hi].tokens)}</span></div>
        </Tip>
      )}
    </div>
  )
}

function smooth(pts: [number, number][]): string {
  if (!pts.length) return ''
  let d = `M${pts[0][0]} ${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6},${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6},${p2[0]} ${p2[1]}`
  }
  return d
}

export function AreaLine({ days, pick, color, label, height = 190 }: { days: DayTotal[]; pick: (d: DayTotal) => number; color: string; label: string; height?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [hi, setHi] = useState<number | null>(null)
  const id = useRef(`g${Math.random().toString(36).slice(2, 7)}`).current
  const L = 38, R = 8, T = 10, B = 22, n = days.length
  const mx = niceMax(Math.max(1, ...days.map(pick)))
  const X = (i: number) => L + ((w - L - R) * i) / Math.max(1, n - 1)
  const Y = (v: number) => T + (height - T - B) * (1 - v / mx)
  const pts = days.map((d, i) => [X(i), Y(pick(d))] as [number, number])
  const line = smooth(pts)
  const step = Math.ceil(n / (w < 520 ? 5 : 10))
  return (
    <div ref={ref} className="chart relative" onPointerLeave={() => setHi(null)} onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHi(Math.max(0, Math.min(n - 1, Math.round((e.clientX - r.left - L) / ((w - L - R) / Math.max(1, n - 1)))))) }}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={label}>
          <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".4" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
          {[0, 1, 2, 3, 4].map((g) => { const y = T + (height - T - B) * (1 - g / 4); return <g key={g}><line className="grid-l" x1={L} x2={w - R} y1={y} y2={y} /><text x={L - 6} y={y + 3.5} textAnchor="end">{fmt((mx * g) / 4)}</text></g> })}
          <path className="fadein" d={`${line} L${X(n - 1)} ${height - B} L${L} ${height - B}Z`} fill={`url(#${id})`} />
          <path className="draw" d={line} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" pathLength={1000} style={{ ['--len' as string]: 1000 }} />
          {days.map((d, i) => i % step === 0 && <text key={d.day} x={X(i)} y={height - 6} textAnchor="middle">{dl(d.date)}</text>)}
          {hi !== null && <><line x1={X(hi)} x2={X(hi)} y1={T} y2={height - B} stroke="var(--fg)" strokeOpacity=".3" strokeDasharray="3 3" /><circle cx={X(hi)} cy={Y(pick(days[hi]))} r={5} fill={color} stroke="var(--bg)" strokeWidth={2.5} /></>}
        </svg>
      )}
      {hi !== null && days[hi] && <Tip x={X(hi)} w={w}><b className="mb-1 block">{dl(days[hi].date, true)}</b><div className="flex justify-between gap-4 text-muted"><span>{label}</span><span className="text-fg">{fmt(pick(days[hi]))}</span></div></Tip>}
    </div>
  )
}

export function Donut({ items, total, unit }: { items: { label: string; value: number; color: string }[]; total: number; unit: string }) {
  const [hi, setHi] = useState<number | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => { const r = requestAnimationFrame(() => setReady(true)); return () => cancelAnimationFrame(r) }, [])
  const R = 62, C = 2 * Math.PI * R
  let off = 0
  const shown = hi === null ? total : items[hi].value
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative mx-auto size-[168px] shrink-0">
        <svg viewBox="0 0 168 168" className="size-full -rotate-90">
          <circle cx="84" cy="84" r={R} fill="none" stroke="var(--sunken)" strokeWidth="18" />
          {items.map((it, i) => {
            const len = total ? (it.value / total) * C : 0
            const el = <circle key={it.label} cx="84" cy="84" r={R} fill="none" stroke={it.color} strokeLinecap="round" strokeWidth={hi === i ? 24 : 18} opacity={hi === null || hi === i ? 1 : 0.35} strokeDasharray={`${ready ? Math.max(0, len - 4) : 0} ${C}`} strokeDashoffset={-off} style={{ transition: `stroke-dasharray 1.1s cubic-bezier(.34,1.3,.64,1) ${i * 120}ms, stroke-width .3s, opacity .25s`, cursor: 'pointer' }} onPointerEnter={() => setHi(i)} onPointerLeave={() => setHi(null)} />
            off += len
            return el
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-content-center text-center"><b className="font-display text-[26px] tabular-nums leading-none">{fmt(shown)}</b><span className="mt-1 text-[11.5px] text-muted">{hi === null ? unit : items[hi].label}</span></div>
      </div>
      <div className="grid min-w-[150px] flex-1 gap-2 text-[12.5px]">
        {items.map((it, i) => <div key={it.label} onPointerEnter={() => setHi(i)} onPointerLeave={() => setHi(null)} className="grid grid-cols-[auto_1fr_auto] items-center gap-2"><i className="size-2.5 rounded-[3px]" style={{ background: it.color }} />{it.label}<span className="tabular-nums text-muted">{fmt(it.value)} · {total ? Math.round((it.value / total) * 100) : 0}%</span></div>)}
      </div>
    </div>
  )
}

export function HeatHours({ hours }: { hours: number[][] }) {
  const mx = Math.max(1, ...hours.flat())
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const order = [1, 2, 3, 4, 5, 6, 0]
  const [tip, setTip] = useState('')
  return (
    <div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1">
        <div className="grid grid-rows-7 text-[10.5px] text-faint">{order.map((d) => <span key={d} className="flex items-center">{names[d]}</span>)}</div>
        <div className="grid min-w-0 grid-cols-[repeat(24,minmax(0,1fr))] gap-[3px]">
          {order.flatMap((d, ri) => hours[d].map((v, h) => <i key={`${d}-${h}`} title={`${names[d]} ${h}:00 · ${v} prompts`} onPointerEnter={() => setTip(`${names[d]} ${h}:00 · ${v} prompts`)} className="cell-in aspect-square min-w-0 rounded-[4px]" style={{ background: `color-mix(in oklab, var(--accent) ${Math.round((v / mx) * 95)}%, var(--sunken))`, animationDelay: `${(ri * 24 + h) * 4}ms` }} />))}
        </div>
        <span />
        <div className="flex justify-between text-[10.5px] text-faint"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>
      </div>
      <p className="mt-2 h-4 text-[11.5px] text-muted">{tip}</p>
    </div>
  )
}

export function HBars({ rows }: { rows: { label: string; value: number; sub?: string; color: string }[] }) {
  const [on, setOn] = useState(false)
  useEffect(() => { const r = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true))); return () => cancelAnimationFrame(r) }, [])
  const mx = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="grid gap-3">
      {rows.length === 0 && <p className="text-[12.5px] text-faint">Nothing recorded yet.</p>}
      {rows.map((r, i) => (
        <div key={r.label} className="grid gap-1.5">
          <div className="flex justify-between gap-3 text-[12.5px]"><b className="min-w-0 truncate font-medium">{r.label}</b><span className="shrink-0 tabular-nums text-muted">{r.value.toLocaleString()}{r.sub ? ` · ${r.sub}` : ''}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full" style={{ width: on ? `${(r.value / mx) * 100}%` : 0, background: r.color, transition: `width 1.1s cubic-bezier(.34,1.56,.64,1) ${i * 80}ms` }} /></div>
        </div>
      ))}
    </div>
  )
}

/** GitHub-style year strip: 53 weeks × 7 days, intensity by tokens, tinted by the busiest provider. */
export function CalendarHeat({ days }: { days: DayTotal[] }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<{ x: number; d: DayTotal } | null>(null)
  const weeks = Math.ceil((days.length + days[0].date.getDay()) / 7)
  const gap = 3
  const cell = Math.max(7, Math.min(16, (w - 30 - gap * weeks) / weeks))
  const mx = Math.max(1, ...days.map((d) => d.tokens))
  const h = 7 * (cell + gap) + 18
  return (
    <div ref={ref} className="chart relative overflow-hidden">
      {w > 0 && (
        <svg width={w} height={h} role="img" aria-label="Activity calendar">
          {days.map((d, i) => {
            const idx = i + days[0].date.getDay()
            const x = 26 + Math.floor(idx / 7) * (cell + gap)
            const y = (idx % 7) * (cell + gap)
            const lvl = d.tokens ? 0.18 + 0.82 * Math.sqrt(d.tokens / mx) : 0
            return <rect key={d.day} className="cell-in" x={x} y={y} width={cell} height={cell} rx={Math.min(5, cell / 3)} fill={d.tokens || d.prompts ? `color-mix(in oklab, var(--accent) ${Math.round(lvl * 100)}%, var(--sunken))` : 'var(--sunken)'} style={{ animationDelay: `${Math.min(i, 400) * 2}ms` }} onPointerEnter={() => setTip({ x: x + cell / 2, d })} onPointerLeave={() => setTip(null)} />
          })}
          {['Mon', 'Wed', 'Fri'].map((t, i) => <text key={t} x={0} y={(i * 2 + 1) * (cell + gap) + cell * 0.8}>{t}</text>)}
        </svg>
      )}
      {tip && <Tip x={tip.x} w={w}><b className="block">{dl(tip.d.date, true)}</b><span className="text-muted">{tip.d.prompts} prompts · {fmt(tip.d.tokens)} tokens</span></Tip>}
    </div>
  )
}

export function Sparkline({ values, color }: { values: number[]; color: string }) {
  const mx = Math.max(1, ...values)
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * 100, 30 - (v / mx) * 28] as [number, number])
  const line = smooth(pts)
  const id = useRef(`s${Math.random().toString(36).slice(2, 7)}`).current
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="mt-2 block h-8 w-full overflow-visible">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".35" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path className="fadein" d={`${line} L100 32 L0 32Z`} fill={`url(#${id})`} />
      <path className="draw" d={line} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" pathLength={400} style={{ ['--len' as string]: 400 }} />
    </svg>
  )
}
