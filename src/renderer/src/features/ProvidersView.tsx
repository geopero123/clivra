import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ExternalLink, KeyRound, RefreshCw, SquareTerminal, TriangleAlert, X } from 'lucide-react'
import type { ProviderStatus } from '@shared/types'
import { cn } from '@/lib/cn'
import { base, fadeUp } from '@/lib/motion'
import { useApp } from '@/lib/store'
import { Button, PROVIDER_COLOR, ProviderMark, StateBadge, Spinner } from '@/ui'
import { CopyButton } from './Markdown'

const CAPS: [keyof ProviderStatus['capabilities'], string][] = [
  ['models', 'Model list'], ['effort', 'Reasoning effort'], ['resume', 'Session resume'], ['skills', 'Skills'], ['skillToggle', 'Skill toggles'], ['permissions', 'Approvals'], ['planMode', 'Native plan mode'], ['attachments', 'Attachments']
]

function Card({ p, index }: { p: ProviderStatus; index: number }) {
  const recheck = useApp((s) => s.recheck)
  const [setup, setSetup] = useState(false)
  const needsSetup = p.state === 'missing' || p.state === 'unauthenticated' || p.state === 'error' || p.state === 'update-recommended'
  const color = PROVIDER_COLOR[p.id]
  const typeIn = (cmd: string) => window.dispatchEvent(new CustomEvent('clivra:terminal-type', { detail: cmd }))
  return (
    <motion.article variants={fadeUp} initial="hidden" animate="show" transition={{ delay: index * 0.06 }} layout className="relative overflow-hidden rounded-3xl border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
      <span className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full opacity-[.12] blur-3xl" style={{ background: color }} />
      <div className="relative flex items-start gap-4">
        <ProviderMark id={p.id} size={26} className="!rounded-2xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-[17px] font-semibold tracking-tight">{p.name}</h2>
            <StateBadge state={p.state} />
          </div>
          <p className="selectable mt-1 text-[13px] text-muted">{p.message}</p>
          {p.detail && <pre className="selectable mt-2 max-h-24 overflow-auto whitespace-pre-wrap rounded-lg bg-sunken p-2 font-mono text-[11.5px] text-muted">{p.detail}</pre>}
        </div>
        <Button size="sm" onClick={() => void recheck(p.id)} disabled={p.state === 'checking'} aria-label={`Recheck ${p.name}`}>
          {p.state === 'checking' ? <Spinner size={12} /> : <RefreshCw size={13} />} Recheck
        </Button>
      </div>

      <dl className="relative mt-4 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-[12.5px]">
        <dt className="text-faint">Version</dt><dd className="selectable font-mono">{p.version ? `v${p.version}` : '—'}{p.minVersion && p.version ? <span className="ml-2 text-faint">(recommended ≥ {p.minVersion})</span> : null}</dd>
        <dt className="text-faint">Executable</dt><dd className="selectable truncate font-mono" title={p.executable ?? ''}>{p.executable ?? 'not found'}</dd>
        <dt className="text-faint">Account</dt><dd className="selectable truncate">{p.account ?? '—'}</dd>
      </dl>

      <div className="relative mt-4 flex flex-wrap gap-1.5">
        {CAPS.map(([k, label]) => {
          const on = p.capabilities[k] === true
          return (
            <span key={k} className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px]', on ? 'border-line text-muted' : 'border-line text-faint line-through decoration-faint/50')}>
              {on ? <Check size={11} className="text-ok" /> : <X size={11} className="text-faint" />} {label}
            </span>
          )
        })}
      </div>
      {p.capabilities.limitations.length > 0 && (
        <ul className="relative mt-3 space-y-1">
          {p.capabilities.limitations.map((l) => <li key={l} className="flex gap-2 text-[12px] text-muted"><TriangleAlert size={13} className="mt-0.5 shrink-0 text-warn" />{l}</li>)}
        </ul>
      )}

      <div className="relative mt-5 flex flex-wrap items-center gap-2">
        {needsSetup && <Button variant="primary" size="sm" onClick={() => setSetup((s) => !s)}><KeyRound size={13} /> {p.state === 'missing' ? 'Install guide' : p.state === 'unauthenticated' ? 'Sign in' : 'Fix this'}</Button>}
        <Button size="sm" variant="ghost" onClick={() => void window.clivra.app.openExternal(p.setup.docsUrl)} disabled={!p.setup.docsUrl}><ExternalLink size={13} /> Docs</Button>
        {p.state === 'ready' && <Button size="sm" variant="ghost" onClick={() => typeIn(p.id === 'claude' ? 'claude' : p.id)}><SquareTerminal size={13} /> Open in terminal</Button>}
      </div>

      <AnimatePresence initial={false}>
        {setup && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={base} className="relative overflow-hidden">
            <div className="mt-4 space-y-3 rounded-2xl border border-line bg-sunken p-4">
              {(p.state === 'missing' || p.state === 'update-recommended') && (
                <Step n={1} title={p.state === 'missing' ? 'Install' : 'Update'} cmd={p.setup.installCommand} onType={() => typeIn(p.setup.installCommand.split('   #')[0])} />
              )}
              {(p.state === 'missing' || p.state === 'unauthenticated') && <Step n={2} title="Sign in" cmd={p.setup.loginCommand} onType={() => typeIn(p.setup.loginCommand)} />}
              <p className="text-[12px] text-faint">“Type in terminal” opens the built-in terminal and types the command without running it — press Enter to confirm. Then use Recheck.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  )
}

function Step({ n, title, cmd, onType }: { n: number; title: string; cmd: string; onType: () => void }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 text-[12.5px] font-medium"><span className="grid size-5 place-items-center rounded-full bg-accent-soft text-[11px] text-accent">{n}</span>{title}</div>
      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
        <code className="selectable min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12px]">{cmd}</code>
        <CopyButton text={cmd.split('   #')[0]} label="Copy command" />
        <Button size="sm" variant="ghost" onClick={onType}><SquareTerminal size={12} /> Type in terminal</Button>
      </div>
    </div>
  )
}

export function ProvidersView() {
  const providers = useApp((s) => s.providers)
  const recheck = useApp((s) => s.recheck)
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[980px] px-8 pb-16 pt-6">
        <div className="mb-7 flex items-end justify-between">
          <div>
            <h1 className="font-display text-[38px] leading-none tracking-tight">Providers</h1>
            <p className="mt-2 max-w-[560px] text-[13.5px] text-muted">Clivra drives the agents already installed on this computer through their official machine-readable interfaces. Nothing is simulated — what you see here is what each CLI reports.</p>
          </div>
          <Button onClick={() => void recheck()}><RefreshCw size={14} /> Recheck all</Button>
        </div>
        <div className="grid gap-4 lg:grid-cols-1">
          {providers.map((p, i) => <Card key={p.id} p={p} index={i} />)}
        </div>
      </div>
    </div>
  )
}
