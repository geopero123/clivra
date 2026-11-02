import { memo } from 'react'
import { motion } from 'motion/react'
import { AlertCircle, FileText, OctagonX, ZapOff } from 'lucide-react'
import type { Block } from '@shared/events'
import type { StoredMessage } from '@shared/types'
import { base } from '@/lib/motion'
import { duration } from '@/lib/format'
import { PROVIDER_NAME, ProviderMark } from '@/ui'
import { CopyButton, Markdown } from './Markdown'
import { NoticeBlock, PermissionCard, ThinkingBlock, ToolCard } from './Blocks'
import { AttachmentThumb } from './Attachments'

export function BlocksView({ blocks, streaming }: { blocks: Block[]; streaming: boolean }) {
  const lastIdx = blocks.length - 1
  return (
    <div className="space-y-2.5">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'text':
            return (
              <motion.div key={b.id} initial={streaming ? { opacity: 0, y: 4 } : false} animate={{ opacity: 1, y: 0 }} transition={base}>
                <Markdown text={b.text} streaming={streaming && i === lastIdx} />
              </motion.div>
            )
          case 'thinking':
            return <ThinkingBlock key={b.id} block={b} streaming={streaming && i === lastIdx} />
          case 'tool':
            return (
              <motion.div key={b.id} initial={streaming ? { opacity: 0, y: 6 } : false} animate={{ opacity: 1, y: 0 }} transition={base}>
                <ToolCard block={b} />
              </motion.div>
            )
          case 'permission':
            return <PermissionCard key={b.id} block={b} />
          case 'notice':
            return <NoticeBlock key={b.id} block={b} />
        }
      })}
    </div>
  )
}

export const MessageView = memo(function MessageView({ msg, animate }: { msg: StoredMessage; animate: boolean }) {
  if (msg.role === 'user') {
    const text = msg.blocks.map((b) => (b.kind === 'text' ? b.text : '')).join('')
    return (
      <motion.div initial={animate ? { opacity: 0, y: 10 } : false} animate={{ opacity: 1, y: 0 }} transition={base} className="flex flex-col items-end gap-2 py-3">
        {!!msg.attachments?.length && (
          <div className="flex max-w-[80%] flex-wrap justify-end gap-2">
            {msg.attachments.map((a) => (
              <AttachmentThumb key={a.path} a={a} />
            ))}
          </div>
        )}
        {text && (
          <div className="selectable max-w-[82%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-line bg-raised px-4 py-2.5 text-[14.5px] leading-relaxed shadow-[var(--shadow-card)]">{text}</div>
        )}
      </motion.div>
    )
  }
  const text = msg.blocks.filter((b) => b.kind === 'text').map((b) => (b.kind === 'text' ? b.text : '')).join('\n\n')
  return (
    <motion.div initial={animate ? { opacity: 0, y: 10 } : false} animate={{ opacity: 1, y: 0 }} transition={base} className="group/msg py-3">
      <div className="mb-2 flex items-center gap-2">
        {msg.provider && <ProviderMark id={msg.provider} size={13} />}
        <span className="text-[12.5px] font-medium text-muted">{msg.provider ? PROVIDER_NAME[msg.provider] : 'Assistant'}</span>
        {msg.model && <span className="truncate font-mono text-[11px] text-faint">{msg.model}</span>}
      </div>
      <BlocksView blocks={msg.blocks} streaming={false} />
      {msg.blocks.length === 0 && <div className="text-[13px] text-faint">No output.</div>}
      {msg.status === 'cancelled' && (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-sunken px-2.5 py-1 text-[12px] text-muted">
          <OctagonX size={13} /> Stopped
        </div>
      )}
      {msg.status === 'interrupted' && (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[color-mix(in_oklab,var(--warn)_12%,transparent)] px-2.5 py-1 text-[12px] text-warn">
          <ZapOff size={13} /> Interrupted — the app closed while this was running
        </div>
      )}
      {msg.status === 'error' && (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] px-2.5 py-1 text-[12px] text-danger">
          <AlertCircle size={13} /> Ended with an error
        </div>
      )}
      <div className="mt-1.5 flex h-6 items-center gap-1 opacity-0 transition-opacity group-hover/msg:opacity-100">
        {text && <CopyButton text={text} label="Copy response" />}
        {msg.usage && (
          <span className="ml-1 flex items-center gap-2 font-mono text-[11px] text-faint">
            {msg.usage.durationMs ? <span>{duration(msg.usage.durationMs)}</span> : null}
            {msg.usage.inputTokens ? <span>{msg.usage.inputTokens.toLocaleString()} in</span> : null}
            {msg.usage.outputTokens ? <span>{msg.usage.outputTokens.toLocaleString()} out</span> : null}
            {msg.usage.costUsd ? <span>${msg.usage.costUsd.toFixed(4)}</span> : null}
          </span>
        )}
      </div>
    </motion.div>
  )
})

export { FileText }
