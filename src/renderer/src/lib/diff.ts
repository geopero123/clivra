import type { FileDiff } from '@shared/events'

interface Line {
  t: 'add' | 'del' | 'ctx' | 'hunk'
  text: string
  o?: number
  n?: number
}

export function parseUnifiedDiff(diff: string): { lines: Line[]; add: number; del: number } {
  const lines: Line[] = []
  let o = 0
  let n = 0
  let add = 0
  let del = 0
  for (const raw of diff.split('\n')) {
    if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(raw) && !lines.length) continue
    if (/^(--- |\+\+\+ )/.test(raw) && lines.length === 0) continue
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw)
    if (h) {
      o = Number(h[1])
      n = Number(h[2])
      lines.push({ t: 'hunk', text: raw })
    } else if (raw.startsWith('+')) {
      lines.push({ t: 'add', text: raw.slice(1), n: n++ })
      add++
    } else if (raw.startsWith('-')) {
      lines.push({ t: 'del', text: raw.slice(1), o: o++ })
      del++
    }
    else if (raw.startsWith('\\')) continue
    else if (lines.length) lines.push({ t: 'ctx', text: raw.startsWith(' ') ? raw.slice(1) : raw, o: o++, n: n++ })
  }
  while (lines.length && lines[lines.length - 1].t === 'ctx' && lines[lines.length - 1].text === '') lines.pop()
  return { lines, add, del }
}

/** Split a multi-file `git diff` into per-file diffs. */
export function splitGitDiff(text: string): FileDiff[] {
  const out: FileDiff[] = []
  const parts = text.split(/^(?=diff --git )/m).filter((p) => p.startsWith('diff --git'))
  for (const p of parts) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/m.exec(p)
    const path = m?.[2] ?? 'file'
    out.push({ path, kind: /^new file/m.test(p) ? 'add' : /^deleted file/m.test(p) ? 'delete' : 'update', diff: p })
  }
  return out
}
