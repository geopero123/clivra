import { memo, useEffect, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/cn'
import { highlight } from '@/lib/highlight'
import { splitMarkdown } from '@/lib/format'

export function CopyButton({ text, className, label = 'Copy' }: { text: string; className?: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1400)
        })
      }}
      className={cn('no-drag inline-grid size-6 place-items-center rounded-md text-faint transition hover:bg-sunken hover:text-fg active:scale-90', className)}
    >
      {done ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
    </button>
  )
}

export const CodeBlock = memo(function CodeBlock({ code, lang, plain }: { code: string; lang: string; plain?: boolean }) {
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    if (plain || !lang) return
    let live = true
    void highlight(code, lang).then((h) => live && setHtml(h))
    return () => {
      live = false
    }
  }, [code, lang, plain])
  return (
    <div className="group/code my-3 overflow-hidden rounded-xl border border-line bg-sunken">
      <div className="flex h-8 items-center justify-between border-b border-line px-3">
        <span className="font-mono text-[11px] text-faint">{lang || 'text'}</span>
        <CopyButton text={code} className="opacity-0 transition-opacity group-hover/code:opacity-100 focus-visible:opacity-100" label="Copy code" />
      </div>
      {html ? (
        <div className="selectable overflow-x-auto p-3.5 font-mono text-[12.5px] leading-[1.65] [&_pre]:m-0 [&_pre]:bg-transparent" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="selectable m-0 overflow-x-auto p-3.5 font-mono text-[12.5px] leading-[1.65]">
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
})

const components = (open: boolean) => ({
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        if (href && /^https?:\/\//i.test(href)) void window.clivra.app.openExternal(href)
      }}
    >
      {children}
    </a>
  ),
  img: ({ alt }: { alt?: string }) => <span className="text-muted">[{alt || 'image'}]</span>,
  pre: ({ children }: { children?: ReactNode }) => <>{children}</>,
  code: ({ className, children }: { className?: string; children?: ReactNode }) => {
    const m = /language-(\S+)/.exec(className ?? '')
    const text = String(children ?? '')
    if (!m && !text.includes('\n')) return <code>{children}</code>
    return <CodeBlock code={text.replace(/\n$/, '')} lang={m?.[1] ?? ''} plain={open} />
  }
})

const Chunk = memo(function Chunk({ text, open }: { text: string; open: boolean }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components(open)}>
      {open && /^\s*(`{3,}|~{3,})/.test(text) && !/\n\s*(`{3,}|~{3,})\s*$/.test(text) ? text + '\n```' : text}
    </ReactMarkdown>
  )
})

/**
 * Streaming-friendly markdown: the text is split at blank lines (outside code fences) so finished
 * chunks are memoised and only the tail re-parses on each frame.
 */
export const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const chunks = splitMarkdown(text)
  return (
    <div className="md selectable text-[14.5px]">
      {chunks.map((c, i) => (
        <Chunk key={i} text={c.text} open={!!streaming && c.open && i === chunks.length - 1} />
      ))}
    </div>
  )
})
