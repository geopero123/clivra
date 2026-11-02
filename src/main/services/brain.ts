import type { Analytics, BrainGraph, BrainLink, BrainNode, ConversationMeta, MemoryItem, Project } from '@shared/types'

/** Build the "neuron" graph from everything the app knows: history, memory, projects, tools. */
export function buildBrain(a: Analytics, memories: MemoryItem[], convs: ConversationMeta[], projects: Project[]): BrainGraph {
  const nodes = new Map<string, BrainNode>()
  const links = new Map<string, BrainLink>()
  const node = (n: BrainNode) => {
    const e = nodes.get(n.id)
    if (e) e.weight += n.weight
    else nodes.set(n.id, { ...n })
  }
  const link = (x: string, y: string, w = 1) => {
    if (!nodes.has(x) || !nodes.has(y) || x === y) return
    const k = x < y ? `${x}|${y}` : `${y}|${x}`
    const e = links.get(k)
    if (e) e.weight += w
    else links.set(k, { a: x, b: y, weight: w })
  }

  node({ id: 'core', kind: 'core', label: 'You', weight: 30 })
  const provTokens: Record<string, number> = {}
  const modelTokens = new Map<string, { provider: string; tokens: number }>()
  for (const d of a.days) {
    if (d.model === '__prompt__') continue
    const t = d.tin + d.tout
    provTokens[d.provider] = (provTokens[d.provider] ?? 0) + t
    const m = modelTokens.get(d.model) ?? { provider: d.provider, tokens: 0 }
    m.tokens += t
    modelTokens.set(d.model, m)
  }
  for (const p of ['claude', 'codex', 'opencode'] as const) {
    node({ id: `p:${p}`, kind: 'provider', label: p === 'claude' ? 'Claude Code' : p === 'codex' ? 'Codex' : 'OpenCode', weight: 8 + Math.log10(1 + (provTokens[p] ?? 0)) * 3, provider: p, detail: `${(provTokens[p] ?? 0).toLocaleString()} tokens` })
    link('core', `p:${p}`, 3)
  }
  for (const [name, m] of [...modelTokens.entries()].sort((x, y) => y[1].tokens - x[1].tokens).slice(0, 8)) {
    node({ id: `m:${name}`, kind: 'model', label: name.replace(/^claude-/, ''), weight: 4 + Math.log10(1 + m.tokens), provider: m.provider as never, detail: `${m.tokens.toLocaleString()} tokens` })
    link(`p:${m.provider}`, `m:${name}`, 2)
  }
  const projStats = new Map<string, { sessions: number; prompts: number; byProv: Record<string, number> }>()
  for (const s of a.sessions) {
    const p = projStats.get(s.project) ?? { sessions: 0, prompts: 0, byProv: {} }
    p.sessions++
    p.prompts += s.prompts
    p.byProv[s.provider] = (p.byProv[s.provider] ?? 0) + 1
    projStats.set(s.project, p)
  }
  for (const [name, p] of [...projStats.entries()].sort((x, y) => y[1].sessions - x[1].sessions).slice(0, 14)) {
    node({ id: `r:${name}`, kind: 'project', label: name, weight: 4 + Math.sqrt(p.sessions) * 2, detail: `${p.sessions} sessions · ${p.prompts} prompts` })
    link('core', `r:${name}`, 1)
    for (const [prov, n] of Object.entries(p.byProv)) link(`p:${prov}`, `r:${name}`, n)
  }
  const toolTotals = new Map<string, { count: number; provs: Record<string, number> }>()
  for (const t of a.tools) {
    const e = toolTotals.get(t.name) ?? { count: 0, provs: {} }
    e.count += t.count
    e.provs[t.provider] = (e.provs[t.provider] ?? 0) + t.count
    toolTotals.set(t.name, e)
  }
  for (const [name, t] of [...toolTotals.entries()].sort((x, y) => y[1].count - x[1].count).slice(0, 10)) {
    node({ id: `t:${name}`, kind: 'tool', label: name, weight: 3 + Math.log10(1 + t.count) * 2, detail: `${t.count.toLocaleString()} calls` })
    for (const [prov, n] of Object.entries(t.provs)) link(`p:${prov}`, `t:${name}`, Math.log10(1 + n))
  }
  const cats = new Set(memories.map((m) => m.category))
  for (const c of cats) {
    node({ id: `c:${c}`, kind: 'category', label: c, weight: 6 })
    link('core', `c:${c}`, 2)
  }
  for (const m of memories) {
    node({ id: `f:${m.id}`, kind: 'memory', label: m.key, weight: 3, detail: m.value, ref: String(m.id) })
    link(`c:${m.category}`, `f:${m.id}`, 1)
    if (m.provider) link(`p:${m.provider}`, `f:${m.id}`, 0.4)
  }
  for (const c of convs.slice(0, 40)) {
    node({ id: `h:${c.id}`, kind: 'chat', label: c.title, weight: 3 + (c.pinned ? 2 : 0), provider: c.provider, ref: c.id, detail: c.model ?? c.provider })
    link(`p:${c.provider}`, `h:${c.id}`, 1)
    const proj = c.projectId ? projects.find((p) => p.id === c.projectId) : undefined
    if (proj) {
      node({ id: `r:${proj.name}`, kind: 'project', label: proj.name, weight: 4 })
      link(`r:${proj.name}`, `h:${c.id}`, 1)
      link('core', `r:${proj.name}`, 1)
    }
  }
  return { nodes: [...nodes.values()], links: [...links.values()] }
}
