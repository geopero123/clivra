import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { FileText, X } from 'lucide-react'
import type { Attachment } from '@shared/types'
import { bytes } from '@/lib/format'
import { spring } from '@/lib/motion'

export function useImagePreview(a: Attachment): string | null {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    if (a.kind === 'image') void window.clivra.app.readFilePreview(a.path).then((s) => live && setSrc(s))
    return () => {
      live = false
    }
  }, [a.path, a.kind])
  return src
}

export function AttachmentThumb({ a, onRemove }: { a: Attachment; onRemove?: () => void }) {
  const src = useImagePreview(a)
  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={spring} className="group/att relative flex h-12 max-w-[220px] items-center gap-2 overflow-hidden rounded-xl border border-line bg-sunken pr-3">
      {src ? (
        <img src={src} alt={a.name} className="size-12 object-cover" />
      ) : (
        <span className="grid size-12 shrink-0 place-items-center bg-raised text-muted">
          <FileText size={17} />
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-[12px] font-medium">{a.name}</span>
        <span className="block text-[11px] text-faint">{bytes(a.size)}</span>
      </span>
      {onRemove && (
        <button onClick={onRemove} aria-label={`Remove ${a.name}`} className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/55 text-white opacity-0 transition group-hover/att:opacity-100">
          <X size={11} />
        </button>
      )}
    </motion.div>
  )
}
