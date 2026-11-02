import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronRight, FilePlus2, FileMinus2, FilePen } from 'lucide-react'
import type { FileDiff } from '@shared/events'
import { cn } from '@/lib/cn'
import { base } from '@/lib/motion'
import { CopyButton } from './Markdown'
import { parseUnifiedDiff } from '@/lib/diff'

const ICON = { add: FilePlus2, delete: FileMinus2, update: FilePen }

export function DiffView({ diff, defaultOpen = true, compact }: { diff: FileDiff; defaultOpen?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const [all, setAll] = useState(false)
  const parsed = useMemo(() => parseUnifiedDiff(diff.diff), [diff.diff])
  const Icon = ICON[diff.kind]
  const LIMIT = 220
  const shown = all ? parsed.lines : parsed.lines.slice(0, LIMIT)
  return (
    <div className={cn('overflow-hidden rounded-xl border border-line bg-surface', compact && 'rounded-lg')}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-sunken">
        <ChevronRight size={14} className={cn('shrink-0 text-faint transition-transform duration-200', open && 'rotate-90')} />
        <Icon size={14} className={cn('shrink-0', diff.kind === 'add' ? 'text-ok' : diff.kind === 'delete' ? 'text-danger' : 'text-accent')} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{diff.path}</span>
        <span className="font-mono text-[11.5px] text-ok">+{parsed.add}</span>
        <span className="font-mono text-[11.5px] text-danger">−{parsed.del}</span>
        <CopyButton text={diff.diff} label="Copy diff" />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={base} className="overflow-hidden">
            <div className="selectable max-h-[420px] overflow-auto border-t border-line bg-sunken font-mono text-[12px] leading-[1.6]">
              <div className="min-w-max">
                {shown.map((l, i) => (
                  <div
                    key={i}
                    className={cn(
                      'grid grid-cols-[3.2rem_3.2rem_1.2rem_1fr] px-0',
                      l.t === 'add' && 'bg-[color-mix(in_oklab,var(--ok)_14%,transparent)]',
                      l.t === 'del' && 'bg-[color-mix(in_oklab,var(--danger)_13%,transparent)]',
                      l.t === 'hunk' && 'bg-accent-soft text-accent'
                    )}
                  >
                    {l.t === 'hunk' ? (
                      <span className="col-span-4 px-3 py-0.5 text-[11.5px]">{l.text}</span>
                    ) : (
                      <>
                        <span className="select-none pr-2 text-right text-faint">{l.o ?? ''}</span>
                        <span className="select-none pr-2 text-right text-faint">{l.n ?? ''}</span>
                        <span className={cn('select-none text-center', l.t === 'add' ? 'text-ok' : l.t === 'del' ? 'text-danger' : 'text-faint')}>{l.t === 'add' ? '+' : l.t === 'del' ? '−' : ''}</span>
                        <span className="whitespace-pre pr-4">{l.text || ' '}</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
              {!all && parsed.lines.length > LIMIT && (
                <button onClick={() => setAll(true)} className="w-full border-t border-line py-1.5 text-center text-[12px] text-muted hover:text-fg">
                  Show {parsed.lines.length - LIMIT} more lines
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

