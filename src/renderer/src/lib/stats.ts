import type { Analytics, DayStat, ProviderId } from '@shared/types'

export const isoDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export interface Streaks { current: number; longest: number; activeDays: number; longestEnd: string | null; todayActive: boolean }

/** A day counts as active if you sent a prompt or an agent replied, in any provider. */
export function streaks(days: DayStat[], today = new Date()): Streaks {
  const active = new Set(days.filter((d) => d.prompts > 0 || d.replies > 0).map((d) => d.day))
  const sorted = [...active].sort()
  let longest = 0
  let run = 0
  let longestEnd: string | null = null
  let prev: Date | null = null
  for (const s of sorted) {
    const [y, m, dd] = s.split('-').map(Number)
    const d = new Date(y, m - 1, dd)
    run = prev && Math.round((d.getTime() - prev.getTime()) / 86_400_000) === 1 ? run + 1 : 1
    if (run > longest) {
      longest = run
      longestEnd = s
    }
    prev = d
  }
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const todayActive = active.has(isoDay(t))
  // The streak is still alive if you were active yesterday but haven't been yet today.
  const cursor = new Date(t)
  if (!todayActive) cursor.setDate(cursor.getDate() - 1)
  let current = 0
  while (active.has(isoDay(cursor))) {
    current++
    cursor.setDate(cursor.getDate() - 1)
  }
  return { current, longest, activeDays: active.size, longestEnd, todayActive }
}

export interface DayTotal { day: string; date: Date; prompts: number; replies: number; tokens: number; tin: number; tout: number; cache: number; cost: number; byProvider: Record<ProviderId, number> }

export function dailyTotals(a: Analytics, n: number, today = new Date()): DayTotal[] {
  const map = new Map<string, DayTotal>()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    map.set(isoDay(d), { day: isoDay(d), date: d, prompts: 0, replies: 0, tokens: 0, tin: 0, tout: 0, cache: 0, cost: 0, byProvider: { claude: 0, codex: 0, opencode: 0 } })
  }
  for (const s of a.days) {
    const t = map.get(s.day)
    if (!t) continue
    t.prompts += s.prompts
    t.replies += s.replies
    t.tin += s.tin
    t.tout += s.tout
    t.cache += s.cache
    t.cost += s.cost
    t.tokens += s.tin + s.tout
    t.byProvider[s.provider] += s.tin + s.tout
  }
  return [...map.values()]
}

export function fmt(n: number): string {
  return n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(Math.round(n))
}

export function niceMax(m: number): number {
  const e = Math.pow(10, Math.floor(Math.log10(m || 1)))
  const f = (m || 1) / e
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e
}

/** A plain-language recap built locally from the numbers (no model involved). */
export function recap(a: Analytics, days: DayTotal[]): string[] {
  const out: string[] = []
  const sess = a.sessions.filter((s) => s.end >= days[0].date.getTime())
  const tokens = days.reduce((n, d) => n + d.tokens, 0)
  if (!sess.length && !tokens) return ['No activity in this period yet.']
  out.push(`${sess.length} chat${sess.length === 1 ? '' : 's'} and ${days.reduce((n, d) => n + d.prompts, 0)} prompts across ${new Set(sess.map((s) => s.provider)).size || 1} agent(s), using ${fmt(tokens)} tokens.`)
  const best = [...days].sort((x, y) => y.tokens - x.tokens)[0]
  if (best?.tokens) out.push(`Busiest day: ${best.date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} (${fmt(best.tokens)} tokens).`)
  let hi = 0
  let hd = 0
  let hh = 0
  a.hours.forEach((row, d) => row.forEach((v, h) => v > hi && ((hi = v), (hd = d), (hh = h))))
  if (hi) out.push(`You prompt most on ${['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][hd]} around ${hh}:00.`)
  if (a.tools[0]) out.push(`Most-used tool: ${a.tools[0].name} (${a.tools[0].count.toLocaleString()} calls).`)
  return out
}
