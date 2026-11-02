export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function groupLabel(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(now) - day(d)) / 86_400_000)
  if (diff <= 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return 'Previous 7 days'
  if (diff < 30) return 'Previous 30 days'
  return 'Older'
}

export function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

export function shortPath(p: string, home?: string): string {
  let out = home && p.startsWith(home) ? '~' + p.slice(home.length) : p
  if (out.length > 38) out = '…' + out.slice(-37)
  return out
}

export function bytes(n?: number): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}

/** Split markdown on blank lines outside fenced code so finished chunks can be memoised while streaming. */
export function splitMarkdown(src: string): { text: string; open: boolean }[] {
  const out: { text: string; open: boolean }[] = []
  const lines = src.split('\n')
  let cur: string[] = []
  let fence: string | null = null
  const push = (open: boolean) => {
    if (cur.length) out.push({ text: cur.join('\n'), open })
    cur = []
  }
  for (const line of lines) {
    const m = line.match(/^\s*(`{3,}|~{3,})/)
    if (m) {
      if (!fence) fence = m[1][0]
      else if (m[1][0] === fence) fence = null
    }
    if (!fence && line.trim() === '' && cur.length && !m) {
      push(false)
      continue
    }
    cur.push(line)
  }
  push(!!fence)
  return out
}
