import type { BrainGraph, BrainKind, BrainNode } from '@shared/types'

export const KIND_COLOR: Record<BrainKind, string> = {
  core: '#e8e8ec', provider: '#2f54eb', project: '#d4a72c', model: '#8b7cf6', tool: '#22a389', memory: '#d9557f', category: '#c2416d', chat: '#5b8def'
}
export const PROVIDER_HUE: Record<string, string> = { claude: '#e08a5b', codex: '#3fb68b', opencode: '#5aa0ee' }

interface N extends BrainNode { x: number; y: number; vx: number; vy: number; r: number; color: string; deg: number; flash: number; pinned: boolean; hidden: boolean }
interface L { a: N; b: N; w: number; bend: number }
interface Pulse { l: L; t: number; dir: 1 | -1; speed: number; color: string }
export interface BrainHandlers { onHover?(n: BrainNode | null): void; onSelect?(n: BrainNode | null): void }

/** Dependency-free neuron graph: force layout + glowing nodes + pulses that travel along synapses. */
export class BrainEngine {
  nodes: N[] = []
  links: L[] = []
  private byId = new Map<string, N>()
  private pulses: Pulse[] = []
  private ctx: CanvasRenderingContext2D
  private raf = 0
  private alpha = 1
  private w = 0
  private h = 0
  private dpr = 1
  private cam = { x: 0, y: 0, k: 1 }
  private hover: N | null = null
  private selected: N | null = null
  private drag: { node?: N; px: number; py: number; moved: boolean } | null = null
  private lastFire = 0
  private last = 0
  private ro: ResizeObserver
  private visible = true
  animate = true
  filter: Set<BrainKind> | null = null
  private cleanup: (() => void)[] = []

  constructor(private canvas: HTMLCanvasElement, graph: BrainGraph, private handlers: BrainHandlers = {}, opts: { animate?: boolean; colors?: Partial<Record<BrainKind, string>> } = {}) {
    this.ctx = canvas.getContext('2d')!
    this.animate = opts.animate ?? true
    this.setGraph(graph, opts.colors)
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(canvas)
    this.resize()
    this.bind()
    if (!this.animate) this.settle(260)
    this.loop = this.loop.bind(this)
    this.raf = requestAnimationFrame(this.loop)
  }

  setGraph(g: BrainGraph, colors: Partial<Record<BrainKind, string>> = {}): void {
    const old = this.byId
    this.nodes = g.nodes.map((n, i) => {
      const prev = old.get(n.id)
      const ang = (i / Math.max(1, g.nodes.length)) * Math.PI * 2
      const ring = n.kind === 'core' ? 0 : n.kind === 'provider' || n.kind === 'category' ? 150 : 260 + (i % 7) * 18
      const color = n.provider && (n.kind === 'chat' || n.kind === 'model') ? PROVIDER_HUE[n.provider] : n.kind === 'provider' ? PROVIDER_HUE[n.provider ?? ''] ?? KIND_COLOR.provider : (colors[n.kind] ?? KIND_COLOR[n.kind])
      return { ...n, x: prev?.x ?? Math.cos(ang) * ring, y: prev?.y ?? Math.sin(ang) * ring, vx: 0, vy: 0, r: 3 + Math.sqrt(n.weight) * 1.9, color, deg: 0, flash: 0, pinned: false, hidden: false }
    })
    this.byId = new Map(this.nodes.map((n) => [n.id, n]))
    this.links = []
    for (const l of g.links) {
      const a = this.byId.get(l.a)
      const b = this.byId.get(l.b)
      if (a && b) {
        a.deg++
        b.deg++
        this.links.push({ a, b, w: l.weight, bend: (Math.random() - 0.5) * 0.35 })
      }
    }
    this.alpha = 1
    if (!this.animate) this.settle(260)
  }

  private resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    const r = this.canvas.getBoundingClientRect()
    this.w = r.width
    this.h = r.height
    this.canvas.width = Math.round(r.width * this.dpr)
    this.canvas.height = Math.round(r.height * this.dpr)
  }

  private step(): void {
    const ns = this.nodes
    const a = this.alpha
    for (let i = 0; i < ns.length; i++) {
      const p = ns[i]
      if (p.hidden) continue
      for (let j = i + 1; j < ns.length; j++) {
        const q = ns[j]
        if (q.hidden) continue
        let dx = q.x - p.x
        let dy = q.y - p.y
        let d2 = dx * dx + dy * dy
        if (d2 > 90000) continue
        if (d2 < 1) {
          dx = Math.random() - 0.5
          dy = Math.random() - 0.5
          d2 = 1
        }
        const d = Math.sqrt(d2)
        const f = ((p.r + q.r + 26) * 38 * a) / d2
        p.vx -= (dx / d) * f
        p.vy -= (dy / d) * f
        q.vx += (dx / d) * f
        q.vy += (dy / d) * f
      }
    }
    for (const l of this.links) {
      if (l.a.hidden || l.b.hidden) continue
      const dx = l.b.x - l.a.x
      const dy = l.b.y - l.a.y
      const d = Math.sqrt(dx * dx + dy * dy) || 1
      const rest = 70 + (l.a.kind === 'core' || l.b.kind === 'core' ? 80 : 0) + (l.a.kind === 'provider' || l.b.kind === 'provider' ? 40 : 0)
      const f = (d - rest) * 0.012 * a * Math.min(2, 0.6 + l.w * 0.15)
      l.a.vx += (dx / d) * f
      l.a.vy += (dy / d) * f
      l.b.vx -= (dx / d) * f
      l.b.vy -= (dy / d) * f
    }
    for (const n of ns) {
      if (n.pinned || n.hidden) {
        n.vx = n.vy = 0
        continue
      }
      n.vx += -n.x * 0.0025 * a
      n.vy += -n.y * 0.0025 * a
      n.vx *= 0.84
      n.vy *= 0.84
      n.x += n.vx
      n.y += n.vy
      if (n.kind === 'core') {
        n.x *= 0.9
        n.y *= 0.9
      }
    }
    this.alpha = Math.max(0.0, this.alpha * 0.985 - 0.0004)
  }

  private settle(n: number): void {
    for (let i = 0; i < n; i++) this.step()
    this.alpha = 0
  }

  private visibleNode(n: N): boolean {
    return !n.hidden
  }

  setFilter(kinds: Set<BrainKind> | null): void {
    this.filter = kinds
    for (const n of this.nodes) n.hidden = !!kinds && n.kind !== 'core' && n.kind !== 'provider' && !kinds.has(n.kind)
    this.alpha = Math.max(this.alpha, 0.5)
  }

  setVisible(v: boolean): void {
    this.visible = v
  }

  /** Make a node "fire": a flash on it and pulses down every synapse. Used when an agent is working. */
  fire(id: string, color?: string): void {
    const n = this.byId.get(id)
    if (!n) return
    n.flash = 1
    for (const l of this.links) if ((l.a === n || l.b === n) && !l.a.hidden && !l.b.hidden) this.spawn(l, l.a === n ? 1 : -1, color)
  }

  private spawn(l: L, dir: 1 | -1, color?: string): void {
    if (this.pulses.length > 90) return
    this.pulses.push({ l, t: 0, dir, speed: 0.5 + Math.random() * 0.6, color: color ?? l.a.color })
  }

  focus(id: string): void {
    const n = this.byId.get(id)
    if (n) this.selected = n
  }

  private world(px: number, py: number): { x: number; y: number } {
    return { x: (px - this.w / 2 - this.cam.x) / this.cam.k, y: (py - this.h / 2 - this.cam.y) / this.cam.k }
  }

  private hit(px: number, py: number): N | null {
    const { x, y } = this.world(px, py)
    let best: N | null = null
    let bd = Infinity
    for (const n of this.nodes) {
      if (n.hidden) continue
      const d = Math.hypot(n.x - x, n.y - y)
      if (d < n.r + 6 / this.cam.k && d < bd) {
        best = n
        bd = d
      }
    }
    return best
  }

  private bind(): void {
    const c = this.canvas
    const pos = (e: PointerEvent | WheelEvent) => {
      const r = c.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const down = (e: PointerEvent) => {
      const p = pos(e)
      const n = this.hit(p.x, p.y)
      this.drag = { node: n ?? undefined, px: p.x, py: p.y, moved: false }
      if (n) n.pinned = true
      c.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      const p = pos(e)
      if (this.drag) {
        const dx = p.x - this.drag.px
        const dy = p.y - this.drag.py
        if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true
        if (this.drag.node) {
          const w = this.world(p.x, p.y)
          this.drag.node.x = w.x
          this.drag.node.y = w.y
          this.alpha = Math.max(this.alpha, 0.25)
        } else {
          this.cam.x += dx
          this.cam.y += dy
        }
        this.drag.px = p.x
        this.drag.py = p.y
        return
      }
      const n = this.hit(p.x, p.y)
      if (n !== this.hover) {
        this.hover = n
        c.style.cursor = n ? 'pointer' : 'grab'
        this.handlers.onHover?.(n)
        if (n) this.fire(n.id)
      }
    }
    const up = () => {
      const d = this.drag
      this.drag = null
      if (!d) return
      if (d.node) d.node.pinned = false
      if (!d.moved) {
        this.selected = d.node ?? null
        this.handlers.onSelect?.(d.node ?? null)
        if (d.node) this.fire(d.node.id)
      }
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = pos(e)
      const k = Math.min(3, Math.max(0.35, this.cam.k * Math.exp(-e.deltaY * 0.0012)))
      const wx = (p.x - this.w / 2 - this.cam.x) / this.cam.k
      const wy = (p.y - this.h / 2 - this.cam.y) / this.cam.k
      this.cam.k = k
      this.cam.x = p.x - this.w / 2 - wx * k
      this.cam.y = p.y - this.h / 2 - wy * k
    }
    c.addEventListener('pointerdown', down)
    c.addEventListener('pointermove', move)
    c.addEventListener('pointerup', up)
    c.addEventListener('wheel', wheel, { passive: false })
    c.style.cursor = 'grab'
    this.cleanup.push(() => {
      c.removeEventListener('pointerdown', down)
      c.removeEventListener('pointermove', move)
      c.removeEventListener('pointerup', up)
      c.removeEventListener('wheel', wheel)
    })
  }

  private loop(t: number): void {
    this.raf = requestAnimationFrame(this.loop)
    if (!this.visible || document.hidden) return
    const idle = this.alpha < 0.02 && this.pulses.length === 0 && !this.drag
    // Idle frames drop to ~20 fps; the sim sleeps completely once settled.
    if (idle && t - this.last < 48) return
    const dt = Math.min(0.05, (t - this.last) / 1000 || 0.016)
    this.last = t
    if (this.alpha > 0.004) this.step()
    if (this.animate) {
      if (t - this.lastFire > 380 && this.links.length) {
        this.lastFire = t
        const l = this.links[(Math.random() * this.links.length) | 0]
        if (!l.a.hidden && !l.b.hidden) this.spawn(l, Math.random() < 0.5 ? 1 : -1)
      }
      if (this.hover && t % 7 < 1) this.fire(this.hover.id)
    }
    for (const p of this.pulses) p.t += dt * p.speed
    this.pulses = this.pulses.filter((p) => {
      if (p.t >= 1) {
        const target = p.dir === 1 ? p.l.b : p.l.a
        target.flash = Math.max(target.flash, 0.7)
        return false
      }
      return true
    })
    for (const n of this.nodes) n.flash = Math.max(0, n.flash - dt * 1.6)
    this.draw(t)
  }

  private curve(l: L): { cx: number; cy: number } {
    const mx = (l.a.x + l.b.x) / 2
    const my = (l.a.y + l.b.y) / 2
    return { cx: mx - (l.b.y - l.a.y) * l.bend, cy: my + (l.b.x - l.a.x) * l.bend }
  }

  private draw(t: number): void {
    const g = this.ctx
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    g.clearRect(0, 0, this.w, this.h)
    g.translate(this.w / 2 + this.cam.x, this.h / 2 + this.cam.y)
    g.scale(this.cam.k, this.cam.k)
    const focusN = this.hover ?? this.selected
    const near = new Set<N>()
    if (focusN) {
      near.add(focusN)
      for (const l of this.links) {
        if (l.a === focusN) near.add(l.b)
        if (l.b === focusN) near.add(l.a)
      }
    }
    g.lineCap = 'round'
    for (const l of this.links) {
      if (l.a.hidden || l.b.hidden) continue
      const { cx, cy } = this.curve(l)
      const hot = focusN && (l.a === focusN || l.b === focusN)
      g.beginPath()
      g.moveTo(l.a.x, l.a.y)
      g.quadraticCurveTo(cx, cy, l.b.x, l.b.y)
      g.strokeStyle = hot ? l.a.color : 'rgba(150,150,190,0.5)'
      g.globalAlpha = hot ? 0.75 : focusN ? 0.07 : 0.16 + Math.min(0.2, l.w * 0.03)
      g.lineWidth = (hot ? 1.8 : 0.7 + Math.min(1.4, l.w * 0.18)) / Math.sqrt(this.cam.k)
      g.stroke()
    }
    g.globalAlpha = 1
    g.globalCompositeOperation = 'lighter'
    for (const p of this.pulses) {
      const { cx, cy } = this.curve(p.l)
      const u = p.dir === 1 ? p.t : 1 - p.t
      const x = (1 - u) * (1 - u) * p.l.a.x + 2 * (1 - u) * u * cx + u * u * p.l.b.x
      const y = (1 - u) * (1 - u) * p.l.a.y + 2 * (1 - u) * u * cy + u * u * p.l.b.y
      const rg = g.createRadialGradient(x, y, 0, x, y, 9)
      rg.addColorStop(0, p.color)
      rg.addColorStop(1, 'transparent')
      g.fillStyle = rg
      g.globalAlpha = Math.sin(p.t * Math.PI)
      g.beginPath()
      g.arc(x, y, 9, 0, 6.2832)
      g.fill()
    }
    g.globalAlpha = 1
    for (const n of this.nodes) {
      if (n.hidden) continue
      const dim = focusN && !near.has(n)
      const breathe = this.animate ? 1 + Math.sin(t / 900 + n.x * 0.01) * 0.05 : 1
      const r = n.r * breathe * (1 + n.flash * 0.35)
      const glow = r * (2 + n.flash * 1.6)
      const rg = g.createRadialGradient(n.x, n.y, r * 0.2, n.x, n.y, glow)
      rg.addColorStop(0, n.color)
      rg.addColorStop(1, 'transparent')
      g.globalAlpha = dim ? 0.06 : 0.16 + n.flash * 0.4
      g.fillStyle = rg
      g.beginPath()
      g.arc(n.x, n.y, glow, 0, 6.2832)
      g.fill()
      g.globalAlpha = dim ? 0.25 : 1
      const body = g.createRadialGradient(n.x - r * 0.3, n.y - r * 0.3, 0, n.x, n.y, r)
      body.addColorStop(0, '#ffffff')
      body.addColorStop(0.35, n.color)
      body.addColorStop(1, n.color)
      g.fillStyle = body
      g.beginPath()
      g.arc(n.x, n.y, r, 0, 6.2832)
      g.fill()
    }
    g.globalCompositeOperation = 'source-over'
    g.globalAlpha = 1
    g.font = `${11 / Math.sqrt(this.cam.k)}px Geist Variable, system-ui, sans-serif`
    g.textAlign = 'center'
    for (const n of this.nodes) {
      if (n.hidden) continue
      const show = n === focusN || n.kind === 'core' || n.kind === 'provider' || (this.cam.k > 1.15 && n.r > 6) || (focusN && near.has(n) && this.cam.k > 0.6)
      if (!show) continue
      g.fillStyle = getComputedStyle(this.canvas).color
      g.globalAlpha = n === focusN ? 1 : 0.75
      g.fillText(n.label.length > 26 ? n.label.slice(0, 25) + '…' : n.label, n.x, n.y + n.r + 14 / Math.sqrt(this.cam.k))
    }
    g.globalAlpha = 1
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.cleanup.forEach((f) => f())
  }
}
