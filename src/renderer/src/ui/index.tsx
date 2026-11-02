import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronRight, X } from 'lucide-react'
import {
  forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState,
  type ButtonHTMLAttributes, type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import type { ProviderId, ProviderState } from '@shared/types'
import { cn } from '@/lib/cn'
import { fast, pop, spring, springLiquid } from '@/lib/motion'
import { useApp } from '@/lib/store'

/* ---------- Buttons ---------- */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
  size?: 'sm' | 'md' | 'lg'
}
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'secondary', size = 'md', className, ...p }, ref) {
  return (
    <button
      ref={ref}
      {...p}
      className={cn(
        'ripple no-drag inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-[10px] font-medium transition-[background,box-shadow,transform,opacity,color] duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45',
        size === 'sm' && 'h-7 px-2.5 text-[12.5px]',
        size === 'md' && 'h-8 px-3 text-[13px]',
        size === 'lg' && 'h-10 px-4 text-sm',
        variant === 'primary' && 'grad-accent on-accent text-accent-fg shadow-[0_1px_0_rgba(255,255,255,.22)_inset,0_6px_18px_-6px_color-mix(in_oklab,var(--accent)_75%,transparent)] hover:brightness-110',
        variant === 'secondary' && 'border border-line bg-raised text-fg shadow-[var(--shadow-card)] hover:border-line-strong hover:bg-[color-mix(in_oklab,var(--raised)_92%,var(--fg))]',
        variant === 'outline' && 'border border-line-strong text-fg hover:bg-sunken',
        variant === 'ghost' && 'text-muted hover:bg-sunken hover:text-fg',
        variant === 'danger' && 'bg-danger text-white hover:brightness-110',
        className
      )}
    />
  )
})

export const IconButton = forwardRef<HTMLButtonElement, BtnProps & { label: string; active?: boolean }>(function IconButton({ label, active, className, children, ...p }, ref) {
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      {...p}
      className={cn(
        'ripple no-drag inline-grid size-8 shrink-0 place-items-center rounded-[10px] text-muted transition-[background,color,transform] duration-150 hover:bg-sunken hover:text-fg active:scale-90 disabled:opacity-40',
        active && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent',
        className
      )}
    >
      {children}
    </button>
  )
})

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-line bg-sunken px-1.5 py-px font-mono text-[10.5px] text-muted">{children}</kbd>
}

/* ---------- Switch / Segmented ---------- */
export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('no-drag relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40', checked ? 'bg-accent' : 'bg-line-strong')}
    >
      <motion.span layout whileTap={{ width: 22 }} transition={springLiquid} className="absolute top-[3px] h-4 w-4 rounded-full bg-white shadow" style={checked ? { right: 3 } : { left: 3 }} />
    </button>
  )
}

export function Segmented<T extends string>({ value, options, onChange, className }: { value: T; options: { value: T; label: ReactNode; title?: string; disabled?: boolean }[]; onChange: (v: T) => void; className?: string }) {
  const id = useRef(`seg_${Math.random().toString(36).slice(2, 7)}`).current
  return (
    <div className={cn('no-drag inline-flex rounded-[11px] border border-line bg-sunken p-0.5', className)} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cn('relative rounded-[9px] px-2.5 py-1 text-[12.5px] font-medium transition-colors disabled:opacity-40', value === o.value ? 'text-fg' : 'text-muted hover:text-fg')}
        >
          {value === o.value && <motion.span layoutId={id} transition={springLiquid} className="absolute inset-0 rounded-[9px] border border-line bg-raised shadow-[var(--shadow-card)]" />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

/* ---------- Popover (portal, flip-aware) ---------- */
type Side = 'top' | 'bottom'
export function Popover({
  trigger, children, open, onOpenChange, side = 'bottom', align = 'start', className, offset = 8
}: {
  trigger: ReactNode
  children: ReactNode
  open: boolean
  onOpenChange: (o: boolean) => void
  side?: Side
  align?: 'start' | 'end'
  className?: string
  offset?: number
}) {
  const anchor = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left?: number; right?: number; origin: string; maxH: number } | null>(null)

  const place = useCallback(() => {
    const a = anchor.current?.getBoundingClientRect()
    if (!a) return
    const vh = window.innerHeight
    const spaceBelow = vh - a.bottom - offset - 12
    const spaceAbove = a.top - offset - 12
    const useTop = side === 'top' ? spaceAbove > 180 || spaceAbove > spaceBelow : spaceBelow < 180 && spaceAbove > spaceBelow
    const next: NonNullable<typeof pos> = { origin: `${useTop ? 'bottom' : 'top'} ${align === 'start' ? 'left' : 'right'}`, maxH: Math.max(160, useTop ? spaceAbove : spaceBelow) }
    if (useTop) next.bottom = vh - a.top + offset
    else next.top = a.bottom + offset
    if (align === 'start') next.left = Math.max(8, Math.min(a.left, window.innerWidth - 340))
    else next.right = Math.max(8, window.innerWidth - a.right)
    setPos(next)
  }, [align, offset, side])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return
      onOpenChange(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), onOpenChange(false))
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('resize', place)
    }
  }, [open, onOpenChange, place])

  return (
    <>
      <span ref={anchor} className="inline-flex" onClick={() => onOpenChange(!open)}>
        {trigger}
      </span>
      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              ref={panel}
              variants={pop}
              initial="hidden"
              animate="show"
              exit="exit"
              style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, right: pos.right, transformOrigin: pos.origin, maxHeight: pos.maxH, zIndex: 60 }}
              className={cn('no-drag flex min-w-[220px] flex-col overflow-hidden rounded-2xl border border-line-strong bg-[var(--glass)] shadow-[var(--shadow-pop)] backdrop-blur-xl', className)}
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}

export function MenuItem({ icon, children, onClick, danger, selected, hint, disabled, trailing }: { icon?: ReactNode; children: ReactNode; onClick?: () => void; danger?: boolean; selected?: boolean; hint?: string; disabled?: boolean; trailing?: ReactNode }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-1.5 text-left text-[13px] transition-colors disabled:opacity-40',
        danger ? 'text-danger hover:bg-[color-mix(in_oklab,var(--danger)_12%,transparent)]' : 'text-fg hover:bg-sunken',
        selected && 'bg-accent-soft'
      )}
    >
      {icon && <span className="grid size-4 place-items-center text-muted group-hover:text-fg">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
      {trailing}
      {selected && <Check size={14} className="text-accent" />}
    </button>
  )
}

export const MenuLabel = ({ children }: { children: ReactNode }) => <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-faint">{children}</div>
export const MenuSep = () => <div className="my-1 h-px bg-line" />

/* ---------- Modal ---------- */
export function Modal({ open, onClose, children, className, label }: { open: boolean; onClose: () => void; children: ReactNode; className?: string; label: string }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="no-drag fixed inset-0 z-[70] grid place-items-start justify-items-center bg-black/40 px-4 pt-[14vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fast} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div role="dialog" aria-modal aria-label={label} initial={{ opacity: 0, scale: 0.95, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 6, transition: { duration: 0.12 } }} transition={spring} className={cn('w-full max-w-lg overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-[var(--shadow-pop)]', className)}>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

/* ---------- Toasts ---------- */
export function Toasts() {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[340px] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, x: 40, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.96, transition: { duration: 0.16 } }}
            transition={spring}
            className="pointer-events-auto flex gap-3 rounded-2xl border border-line-strong bg-[var(--glass)] p-3.5 shadow-[var(--shadow-pop)] backdrop-blur-xl"
          >
            <span className={cn('mt-1 size-2 shrink-0 rounded-full', t.kind === 'error' ? 'bg-danger' : t.kind === 'success' ? 'bg-ok' : t.kind === 'warning' ? 'bg-warn' : 'bg-accent')} />
            <div className="selectable min-w-0 flex-1">
              <div className="text-[13px] font-medium">{t.title}</div>
              {t.body && <div className="mt-0.5 line-clamp-4 whitespace-pre-wrap text-[12.5px] text-muted">{t.body}</div>}
            </div>
            <button onClick={() => dismiss(t.id)} className="grid size-6 place-items-center rounded-md text-faint hover:bg-sunken hover:text-fg" aria-label="Dismiss">
              <X size={13} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

/* ---------- Provider identity ---------- */
export const PROVIDER_COLOR: Record<ProviderId, string> = { claude: '#e08a5b', codex: '#3fb68b', opencode: '#5aa0ee' }
export const PROVIDER_NAME: Record<ProviderId, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' }

export function ProviderMark({ id, size = 18, className }: { id: ProviderId; size?: number; className?: string }) {
  const c = PROVIDER_COLOR[id]
  return (
    <span className={cn('inline-grid shrink-0 place-items-center rounded-[7px]', className)} style={{ width: size + 8, height: size + 8, background: `color-mix(in oklab, ${c} 16%, transparent)`, color: c }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {id === 'claude' && <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />}
        {id === 'codex' && <path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9L12 3zM12 12l7.8-4.5M12 12v9M12 12L4.2 7.5" />}
        {id === 'opencode' && <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14" />}
      </svg>
    </span>
  )
}

const STATE_META: Record<ProviderState, { label: string; color: string }> = {
  ready: { label: 'Ready', color: 'var(--ok)' },
  unauthenticated: { label: 'Sign-in needed', color: 'var(--warn)' },
  'update-recommended': { label: 'Update recommended', color: 'var(--warn)' },
  missing: { label: 'Not installed', color: 'var(--fg-faint)' },
  error: { label: 'Error', color: 'var(--danger)' },
  checking: { label: 'Checking…', color: 'var(--accent)' }
}
export function StateBadge({ state }: { state: ProviderState }) {
  const m = STATE_META[state]
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-sunken px-2 py-0.5 text-[11.5px] font-medium" style={{ color: m.color }}>
      <span className={cn('size-1.5 rounded-full', state === 'checking' && 'animate-pulse')} style={{ background: m.color }} />
      {m.label}
    </span>
  )
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="inline-block animate-spin rounded-full border-2 border-line-strong border-t-accent" style={{ width: size, height: size }} />
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-end justify-between">
        <h3 className="text-[13px] font-semibold tracking-tight">{title}</h3>
        {aside}
      </div>
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-card)]">{children}</div>
    </section>
  )
}

export function Row({ title, desc, children }: { title: string; desc?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line px-4 py-3.5 last:border-0">
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium">{title}</div>
        {desc && <div className="mt-0.5 text-[12.5px] leading-snug text-muted">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export { ChevronRight }
