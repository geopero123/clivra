import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { RefreshCw, Check } from 'lucide-react'
import type { Analytics, ProviderId } from '@shared/types'
import { PROVIDER_IDS } from '@shared/types'
import { base, fadeUp } from '@/lib/motion'
import { dailyTotals, fmt, recap, streaks } from '@/lib/stats'
import { Button, PROVIDER_COLOR, PROVIDER_NAME, Segmented, Spinner } from '@/ui'
import { AreaLine, CalendarHeat, Card, CountUp, Donut, HBars, HeatHours, Legend, Sparkline, StackedBars } from './Charts'

const RANGES = [{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '365', label: 'Year' }]

/** A small vessel whose liquid level shows how close the current streak is to the record. */
function Vessel({ level }: { level: number }) {
  const [h, setH] = useState(0)
  useEffect(() => { const r = requestAnimationFrame(() => setH(Math.max(0, Math.min(1, level)))); return () => cancelAnimationFrame(r) }, [level])
  return <div className="vessel h-[92px] w-[74px] shrink-0" role="img" aria-label={`Streak at ${Math.round(level * 100)}% of record`}><div className="liq" style={{ height: `${h * 100}%` }} /></div>
}

function Kpi({ label, value, format, spark, color, hint }: { label: string; value: number; format?: (n: number) => string; spark: number[]; color: string; hint?: string }) {
  return (
    <motion.div variants={fadeUp} className="rounded-3xl border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
      <div className="text-[12px] font-medium text-muted">{label}</div>
      <div className="mt-1 font-display text-[28px] leading-tight tabular-nums"><CountUp value={value} format={format} /></div>
      <div className="text-[11.5px] text-faint">{hint ?? ' '}</div>
      <Sparkline values={spark} color={color} />
    </motion.div>
  )
}

export default function AnalyticsView() {
  const [a, setA] = useState<Analytics | null>(null)
  const [range, setRange] = useState('30')
  useEffect(() => {
    let live = true
    void window.clivra.analytics.get().then((x) => live && setA(x))
    const off = window.clivra.analytics.onUpdate((x) => live && setA(x))
    void window.clivra.analytics.refresh().then((x) => live && setA(x))
    return () => { live = false; off() }
  }, [])
  const n = Number(range)
  const year = useMemo(() => (a ? dailyTotals(a, 371) : []), [a])
  const days = useMemo(() => year.slice(-n), [year, n])
  const st = useMemo(() => (a ? streaks(a.days) : null), [a])
  if (!a || !st) return <div className="grid h-full place-items-center"><Spinner size={22} /></div>

  const tokens = days.reduce((s, d) => s + d.tokens, 0)
  const prompts = days.reduce((s, d) => s + d.prompts, 0)
  const cache = days.reduce((s, d) => s + d.cache, 0)
  const tin = days.reduce((s, d) => s + d.tin, 0)
  const cost = days.reduce((s, d) => s + d.cost, 0)
  const since = days[0].date.getTime()
  const chats = a.sessions.filter((s) => s.end >= since)
  const provTokens = PROVIDER_IDS.map((p) => ({ label: PROVIDER_NAME[p], value: days.reduce((s, d) => s + d.byProvider[p], 0), color: PROVIDER_COLOR[p] }))
  const models = new Map<string, { v: number; p: ProviderId }>()
  for (const d of a.days) if (d.model !== '__prompt__' && d.day >= days[0].day) models.set(d.model, { v: (models.get(d.model)?.v ?? 0) + d.replies, p: d.provider })
  const projects = new Map<string, { s: number; t: number }>()
  for (const s of chats) projects.set(s.project, { s: (projects.get(s.project)?.s ?? 0) + 1, t: (projects.get(s.project)?.t ?? 0) + s.tokens })
  const cl = a.clivra
  const okRate = cl.runs ? Math.round(((cl.runs - cl.errors) / cl.runs) * 100) : 100
  const noHistory = !a.scanning && a.days.length === 0

  return (
    <div className="h-full overflow-y-auto">
      <motion.div initial="hidden" animate="show" transition={{ staggerChildren: 0.05 }} className="mx-auto max-w-[1060px] px-8 pb-20 pt-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-[40px] leading-none tracking-tight">Analytics</h1>
            <p className="mt-2 max-w-[560px] text-[13.5px] text-muted">Read from the history each agent keeps on this computer, so it includes work done outside Clivra too. Nothing leaves your machine.</p>
          </div>
          <div className="flex items-center gap-3">
            <Segmented value={range} onChange={setRange} options={RANGES} />
            <Button size="sm" onClick={() => void window.clivra.analytics.refresh().then(setA)} disabled={a.scanning} aria-label="Rescan history">{a.scanning ? <Spinner size={12} /> : <RefreshCw size={13} />} Rescan</Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px]">
          {a.sources.map((s) => (
            <span key={s.provider} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-sunken px-2.5 py-1 text-muted" title={s.note}>
              <i className="size-2 rounded-full" style={{ background: s.available ? PROVIDER_COLOR[s.provider] : 'var(--fg-faint)' }} />
              {PROVIDER_NAME[s.provider]}: {s.available ? `${s.sessions} chats` : s.note ?? 'no history'}
            </span>
          ))}
          {a.scanning && <span className="flex items-center gap-2 text-accent"><Spinner size={11} /> Reading history {a.progress.done}/{a.progress.total}</span>}
        </div>

        {noHistory && <div className="mt-8 rounded-3xl border border-dashed border-line-strong p-10 text-center text-[13.5px] text-muted">No history found yet. Use Claude Code, Codex or OpenCode and your charts will fill in.</div>}

        {/* Streak */}
        <motion.div variants={fadeUp} className="mt-6 grid gap-4 rounded-3xl border border-line bg-surface p-6 shadow-[var(--shadow-card)] md:grid-cols-[auto_1fr]">
          <div className="flex items-center gap-5">
            <Vessel level={st.longest ? st.current / st.longest : 0} />
            <div>
              <div className="font-display text-[52px] leading-none tabular-nums"><CountUp value={st.current} /></div>
              <div className="mt-1 text-[13px] text-muted">day streak{st.longest ? ` · of a ${st.longest}-day record` : ''}</div>
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-sunken px-2.5 py-1 text-[11.5px] text-muted">
                {st.todayActive ? <><Check size={12} className="text-ok" /> Today counted</> : st.current ? 'Prompt today to keep it going' : 'Start one today'}
              </div>
            </div>
          </div>
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap gap-x-8 gap-y-1 text-[12.5px] text-muted">
              <span><b className="text-[15px] text-fg tabular-nums">{st.longest}</b> longest</span>
              <span><b className="text-[15px] text-fg tabular-nums">{st.activeDays}</b> active days</span>
              <span><b className="text-[15px] text-fg tabular-nums">{a.sessions.length}</b> chats total</span>
            </div>
            <CalendarHeat days={year} />
          </div>
        </motion.div>

        <div className="mt-4 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr))]">
          <Kpi label="Tokens" value={tokens} format={fmt} spark={days.map((d) => d.tokens)} color="var(--fg)" hint={`${fmt(tokens / Math.max(1, n))} / day`} />
          <Kpi label="Chats" value={chats.length} spark={days.map((d) => a.sessions.filter((s) => isoOf(s.end) === d.day).length)} color="var(--accent)" hint="started or continued" />
          <Kpi label="Prompts" value={prompts} spark={days.map((d) => d.prompts)} color="var(--ok)" hint={chats.length ? `${(prompts / chats.length).toFixed(1)} per chat` : ''} />
          <Kpi label="Cache hits" value={tin + cache ? (cache / (tin + cache)) * 100 : 0} format={(v) => `${v.toFixed(0)}%`} spark={days.map((d) => (d.tin + d.cache ? d.cache / (d.tin + d.cache) : 0))} color="var(--warn)" hint="of input reused" />
          <Kpi label="Reported cost" value={cost} format={(v) => `$${v.toFixed(2)}`} spark={days.map((d) => d.cost)} color="#e0734a" hint="Claude/OpenCode only" />
        </div>

        <div className="mt-4 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr))]">
          <Card className="col-span-full" title="Tokens per day" sub="Input + output, by agent. Hover a bar." aside={<Legend items={PROVIDER_IDS.map((p) => [PROVIDER_NAME[p], PROVIDER_COLOR[p]])} />}><StackedBars days={days} /></Card>
          <Card className="col-span-full" title="Prompts per day" sub="How often you asked an agent for something."><AreaLine days={days} pick={(d) => d.prompts} color="var(--accent)" label="Prompts" /></Card>
          <Card title="Share of tokens" sub="By agent"><Donut items={provTokens} total={tokens} unit="tokens" /></Card>
          <Card title="When you work" sub="Prompts by weekday and hour, all time"><HeatHours hours={a.hours} /></Card>
          <Card title="What the agents did" sub="Tool calls, all time"><HBars rows={a.tools.slice(0, 8).map((t) => ({ label: t.name, value: t.count, sub: PROVIDER_NAME[t.provider], color: PROVIDER_COLOR[t.provider] }))} /></Card>
          <Card title="Models" sub="Replies in this period"><HBars rows={[...models.entries()].sort((x, y) => y[1].v - x[1].v).slice(0, 7).map(([m, v]) => ({ label: m, value: v.v, sub: PROVIDER_NAME[v.p], color: PROVIDER_COLOR[v.p] }))} /></Card>
          <Card title="Projects" sub="Where the chats happened"><HBars rows={[...projects.entries()].sort((x, y) => y[1].s - x[1].s).slice(0, 7).map(([p, v]) => ({ label: p, value: v.s, sub: `${fmt(v.t)} tokens`, color: 'var(--accent)' }))} /></Card>
          <Card title="Through Clivra" sub="This app's own runs">
            <div className="grid grid-cols-2 gap-3 text-[12.5px] text-muted">
              {([['Runs', cl.runs], ['Success', `${okRate}%`], ['Chats', cl.chats], ['Messages', cl.messages], ['Approvals asked', cl.approvals], ['Denied', cl.denied]] as [string, string | number][]).map(([k, v]) => <div key={k} className="rounded-2xl bg-sunken px-3 py-2.5"><div>{k}</div><div className="text-[18px] font-semibold text-fg tabular-nums">{v}</div></div>)}
            </div>
          </Card>
          <Card className="col-span-full" title="Recap" sub={`Last ${n} days, written from your numbers`}>
            <ul className="grid gap-2 text-[13.5px]">{recap(a, days).map((l) => <li key={l} className="flex gap-2.5"><i className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />{l}</li>)}</ul>
          </Card>
        </div>
        <motion.p variants={fadeUp} transition={base} className="mt-6 text-[12px] leading-relaxed text-faint">Tokens count input (including cache writes) and output; cached reads are shown separately. Cost appears only where an agent reports it. Codex history is read from its session files when present.</motion.p>
      </motion.div>
    </div>
  )
}

const isoOf = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
