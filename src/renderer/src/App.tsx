import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { useApp } from '@/lib/store'
import { Spinner, Toasts } from '@/ui'
import { Sidebar } from '@/features/Sidebar'
import { ChatView } from '@/features/ChatView'
const ProvidersView = lazy(() => import('@/features/ProvidersView').then((m) => ({ default: m.ProvidersView })))
const SkillsView = lazy(() => import('@/features/SkillsView').then((m) => ({ default: m.SkillsView })))
const SettingsView = lazy(() => import('@/features/SettingsView').then((m) => ({ default: m.SettingsView })))
import { ActivityPanel } from '@/features/ActivityPanel'
const AnalyticsView = lazy(() => import('@/features/AnalyticsView'))
const BrainView = lazy(() => import('@/features/BrainView'))
const TerminalPanel = lazy(() => import('@/features/TerminalPanel').then((m) => ({ default: m.TerminalPanel })))
import { CommandPalette } from '@/features/CommandPalette'
import { PanelLeft } from 'lucide-react'
import { IconButton } from '@/ui'
import { base } from '@/lib/motion'

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return 0
  const n = parseInt(m[1], 16)
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

function useAppearance() {
  const a = useApp((s) => s.settings.appearance)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = a.theme === 'dark' || (a.theme === 'system' && mq.matches)
      const root = document.documentElement
      root.dataset.theme = dark ? 'dark' : 'light'
      root.dataset.motion = a.motion
      root.style.setProperty('--accent', a.accent)
      root.style.setProperty('--accent-fg', luminance(a.accent) > 0.45 ? '#16141a' : '#ffffff')
      root.style.setProperty('--font-scale', String(a.fontScale * (a.density === 'compact' ? 0.94 : 1)))
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [a])
}

function useShortcuts(toggleSidebar: () => void) {
  const newChat = useApp((s) => s.newChat)
  const setView = useApp((s) => s.setView)
  const togglePanel = useApp((s) => s.togglePanel)
  const setPalette = useApp((s) => s.setPalette)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const k = e.key.toLowerCase()
      const run = (fn: () => void) => { e.preventDefault(); fn() }
      if (k === 'n' && !e.shiftKey) run(() => newChat())
      else if (k === 'k') run(() => setPalette(!useApp.getState().palette))
      else if (k === 'b') run(toggleSidebar)
      else if (k === '`') run(() => togglePanel('terminal'))
      else if (k === '\\') run(() => togglePanel('activity'))
      else if (k === ',') run(() => setView('settings'))
      else if (k === 'l') run(() => { setView('chat'); setTimeout(() => window.dispatchEvent(new Event('clivra:focus-composer')), 50) })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newChat, setView, togglePanel, setPalette, toggleSidebar])
}

/** Sets the ripple origin from the pointer and replays the wave on any .ripple element. */
function useRipple() {
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('.ripple') as HTMLElement | null
      if (!el || document.documentElement.dataset.motion !== 'full') return
      const r = el.getBoundingClientRect()
      el.style.setProperty('--rx', `${e.clientX - r.left}px`)
      el.style.setProperty('--ry', `${e.clientY - r.top}px`)
      el.classList.remove('rippling')
      void el.offsetWidth
      el.classList.add('rippling')
      el.addEventListener('animationend', () => el.classList.remove('rippling'), { once: true })
    }
    window.addEventListener('pointerdown', down, true)
    return () => window.removeEventListener('pointerdown', down, true)
  }, [])
}

export default function App() {
  const ready = useApp((s) => s.ready)
  const view = useApp((s) => s.view)
  const motionLevel = useApp((s) => s.settings.appearance.motion)
  const sidebarOpen = useApp((s) => !s.settings.sidebar.collapsed)
  const setSettings = useApp((s) => s.setSettings)
  const platform = useApp((s) => s.info.platform)
  const toggleSidebar = () => void setSettings({ sidebar: { collapsed: sidebarOpen } } as never)
  useAppearance()
  useRipple()
  useShortcuts(toggleSidebar)
  const [booted, setBooted] = useState(false)
  const termOpen = useApp((s) => s.panels.terminal)
  const [termMounted, setTermMounted] = useState(false)
  const pendingCmd = useRef<string | null>(null)
  // The terminal (xterm + node-pty) only loads the first time it is opened.
  useEffect(() => { if (termOpen) setTermMounted(true) }, [termOpen])
  useEffect(() => {
    const h = (e: Event) => {
      if (termMounted) return
      pendingCmd.current = (e as CustomEvent<string>).detail
      useApp.setState((s) => ({ panels: { ...s.panels, terminal: true } }))
      setTermMounted(true)
      setTimeout(() => { if (pendingCmd.current) window.dispatchEvent(new CustomEvent('clivra:terminal-type', { detail: pendingCmd.current })); pendingCmd.current = null }, 900)
    }
    window.addEventListener('clivra:terminal-type', h)
    return () => window.removeEventListener('clivra:terminal-type', h)
  }, [termMounted])
  useEffect(() => {
    const t0 = (window as unknown as { __t0?: number }).__t0 ?? performance.now()
    void useApp.getState().boot().then(async () => {
      // Let the logo animation play at least once so the open never feels like a flash.
      const wait = Math.max(0, 1500 - (performance.now() - t0))
      ;(window as unknown as { __splash?: { set(p: number, m: string): void } }).__splash?.set(100, 'Ready')
      await new Promise((r) => setTimeout(r, wait))
      setBooted(true)
      requestAnimationFrame(() => requestAnimationFrame(() => (window as unknown as { __splash?: { done(): void } }).__splash?.done()))
    })
  }, [])
  if (!ready || !booted) return null
  return (
    <MotionConfig reducedMotion={motionLevel === 'full' ? 'user' : 'always'}>
      <div className="flex h-full overflow-hidden">
        <Sidebar open={sidebarOpen} />
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <div className="relative min-w-0 flex-1">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div key={view} className="absolute inset-0 flex flex-col" initial={{ opacity: 0, y: 8, scale: 0.995 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }} transition={base}>
                  {view === 'chat' ? (
                    <ChatView onToggleSidebar={toggleSidebar} sidebarOpen={sidebarOpen} />
                  ) : (
                    <>
                      <div className={`drag flex h-11 shrink-0 items-center px-3 ${!sidebarOpen && platform === 'darwin' ? 'pl-[84px]' : ''}`}>
                        {!sidebarOpen && <IconButton label="Show sidebar" onClick={toggleSidebar}><PanelLeft size={17} /></IconButton>}
                      </div>
                      <div className="min-h-0 flex-1"><Suspense fallback={<div className="grid h-full place-items-center"><Spinner size={20} /></div>}>{view === 'providers' ? <ProvidersView /> : view === 'skills' ? <SkillsView /> : view === 'analytics' ? <AnalyticsView /> : view === 'brain' ? <BrainView /> : <SettingsView />}</Suspense></div>
                    </>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
            <ActivityPanel />
          </div>
          {termMounted && <Suspense fallback={null}><TerminalPanel /></Suspense>}
        </main>
      </div>
      <CommandPalette />
      <Toasts />
    </MotionConfig>
  )
}
