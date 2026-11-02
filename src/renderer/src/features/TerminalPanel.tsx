import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Plus, X } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { cn } from '@/lib/cn'
import { spring } from '@/lib/motion'
import { useApp, useChatConfig } from '@/lib/store'

interface Tab { id: string; title: string; term: Terminal; fit: FitAddon; el: HTMLDivElement; exited?: boolean }

function themeColors() {
  const cs = getComputedStyle(document.documentElement)
  const v = (n: string) => cs.getPropertyValue(n).trim()
  const dark = document.documentElement.dataset.theme === 'dark'
  return {
    background: 'rgba(0,0,0,0)', foreground: v('--fg'), cursor: v('--accent'), cursorAccent: v('--bg'), selectionBackground: 'rgba(124,108,240,.35)',
    black: dark ? '#3b3a44' : '#1c1a22', red: '#e5484d', green: '#3fb67a', yellow: '#e0a030', blue: '#5a8ff0', magenta: '#b072e8', cyan: '#36b5c8', white: dark ? '#d8d5e0' : '#6b6775',
    brightBlack: '#77737f', brightRed: '#ff6369', brightGreen: '#5fd39a', brightYellow: '#f5bb4d', brightBlue: '#7aa8ff', brightMagenta: '#c995f5', brightCyan: '#5ccfe0', brightWhite: dark ? '#fff' : '#1c1a22'
  }
}

export function TerminalPanel() {
  const open = useApp((s) => s.panels.terminal)
  const toggle = useApp((s) => s.togglePanel)
  const fontSize = useApp((s) => s.settings.terminal.fontSize)
  const theme = useApp((s) => s.settings.appearance.theme)
  const cfg = useChatConfig()
  const host = useRef<HTMLDivElement>(null)
  const tabs = useRef(new Map<string, Tab>())
  const [list, setList] = useState<{ id: string; title: string; exited?: boolean }[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [height, setHeight] = useState(300)
  const creating = useRef(false)
  const cwdRef = useRef(cfg.cwd)
  cwdRef.current = cfg.cwd

  const sync = () => setList([...tabs.current.values()].map((t) => ({ id: t.id, title: t.title, exited: t.exited })))

  const create = useCallback(async () => {
    if (creating.current) return
    creating.current = true
    try {
      const { id, shell } = await window.clivra.terminal.create(cwdRef.current)
      const term = new Terminal({ fontFamily: '"JetBrains Mono Variable", ui-monospace, monospace', fontSize, cursorBlink: true, allowTransparency: true, scrollback: 8000, theme: themeColors(), allowProposedApi: true })
      const fit = new FitAddon()
      term.loadAddon(fit)
      const el = document.createElement('div')
      el.className = 'absolute inset-0 hidden'
      host.current?.appendChild(el)
      term.open(el)
      term.onData((d) => window.clivra.terminal.write(id, d))
      term.onResize(({ cols, rows }) => window.clivra.terminal.resize(id, cols, rows))
      // Ctrl+Shift+C / V copy & paste
      term.attachCustomKeyEventHandler((e) => {
        if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.code === 'KeyC') { void navigator.clipboard.writeText(term.getSelection()); return false }
        if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.code === 'KeyV') { void navigator.clipboard.readText().then((t) => term.paste(t)); return false }
        return true
      })
      tabs.current.set(id, { id, title: `${shell.split(/[\\/]/).pop()} ${tabs.current.size + 1}`, term, fit, el })
      sync()
      setActive(id)
    } finally {
      creating.current = false
    }
  }, [fontSize])

  const close = useCallback(async (id: string) => {
    const t = tabs.current.get(id)
    if (!t) return
    await window.clivra.terminal.kill(id)
    t.term.dispose()
    t.el.remove()
    tabs.current.delete(id)
    sync()
    setActive((a) => (a === id ? ([...tabs.current.keys()].pop() ?? null) : a))
  }, [])

  useEffect(() => {
    const offData = window.clivra.terminal.onData((id, data) => tabs.current.get(id)?.term.write(data))
    const offExit = window.clivra.terminal.onExit((id, code) => {
      const t = tabs.current.get(id)
      if (!t) return
      t.exited = true
      t.term.write(`\r\n\x1b[2m[process exited with code ${code}]\x1b[0m\r\n`)
      sync()
    })
    return () => { offData(); offExit() }
  }, [])

  useEffect(() => { if (open && tabs.current.size === 0) void create() }, [open, create])

  // Show the active tab, fit it, and keep it fitted as the panel resizes.
  useEffect(() => {
    for (const t of tabs.current.values()) t.el.classList.toggle('hidden', t.id !== active)
    const t = active ? tabs.current.get(active) : null
    if (!t || !open) return
    const doFit = () => { try { t.fit.fit() } catch { /* not laid out yet */ } }
    const raf = requestAnimationFrame(() => { doFit(); t.term.focus() })
    const ro = new ResizeObserver(doFit)
    if (host.current) ro.observe(host.current)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [active, open, list.length, height])

  useEffect(() => {
    for (const t of tabs.current.values()) {
      t.term.options.fontSize = fontSize
      t.term.options.theme = themeColors()
    }
    const id = setTimeout(() => { for (const t of tabs.current.values()) t.term.options.theme = themeColors() }, 60)
    return () => clearTimeout(id)
  }, [fontSize, theme])

  useEffect(() => {
    const h = (e: Event) => {
      const cmd = (e as CustomEvent<string>).detail
      const go = () => { const id = active ?? [...tabs.current.keys()][0]; if (id) window.clivra.terminal.write(id, cmd) }
      if (!useApp.getState().panels.terminal) toggle('terminal')
      setTimeout(go, tabs.current.size ? 50 : 700)
    }
    window.addEventListener('clivra:terminal-type', h)
    return () => window.removeEventListener('clivra:terminal-type', h)
  }, [active, toggle])

  useEffect(() => () => { for (const t of tabs.current.values()) { void window.clivra.terminal.kill(t.id); t.term.dispose() } }, [])

  return (
    <motion.section initial={false} animate={{ height: open ? height : 0, opacity: open ? 1 : 0 }} transition={spring} className="relative shrink-0 overflow-hidden border-t border-line bg-sunken" aria-hidden={!open}>
      <div
        className="no-drag absolute inset-x-0 top-0 z-10 h-1.5 cursor-row-resize hover:bg-accent/30"
        onPointerDown={(e) => {
          const sy = e.clientY, sh = height
          const move = (ev: PointerEvent) => setHeight(Math.min(window.innerHeight - 160, Math.max(140, sh - (ev.clientY - sy))))
          const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
          window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
        }}
        role="separator" aria-label="Resize terminal"
      />
      <div className="flex h-9 items-center gap-1 border-b border-line px-2">
        <AnimatePresence initial={false}>
          {list.map((t) => (
            <motion.div key={t.id} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className={cn('no-drag group flex h-7 items-center gap-1.5 rounded-lg pl-2.5 pr-1 text-[12px] transition-colors', active === t.id ? 'bg-raised text-fg shadow-[var(--shadow-card)]' : 'text-muted hover:bg-raised/60')}>
              <button onClick={() => setActive(t.id)} className={cn(t.exited && 'line-through opacity-60')}>{t.title}</button>
              <button aria-label={`Close ${t.title}`} onClick={() => void close(t.id)} className="grid size-5 place-items-center rounded text-faint hover:bg-sunken hover:text-fg"><X size={11} /></button>
            </motion.div>
          ))}
        </AnimatePresence>
        <button aria-label="New terminal" onClick={() => void create()} className="no-drag grid size-7 place-items-center rounded-lg text-muted hover:bg-raised hover:text-fg"><Plus size={14} /></button>
        <div className="flex-1" />
        <span className="hidden font-mono text-[11px] text-faint sm:block">{cfg.cwd}</span>
        <button aria-label="Close terminal panel" onClick={() => toggle('terminal')} className="no-drag grid size-7 place-items-center rounded-lg text-muted hover:bg-raised hover:text-fg"><X size={14} /></button>
      </div>
      <div ref={host} className="absolute inset-x-0 bottom-0 top-9" />
    </motion.section>
  )
}
