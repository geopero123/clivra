import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { FolderOpen, Info, Search, X, Bot, Terminal as Term, Sparkles } from 'lucide-react'
import type { ProviderId, SkillInfo } from '@shared/types'
import { PROVIDER_IDS } from '@shared/types'
import { cn } from '@/lib/cn'
import { base, fadeUp, spring } from '@/lib/motion'
import { useApp, useChatConfig } from '@/lib/store'
import { Button, PROVIDER_NAME, ProviderMark, Segmented, Spinner, Switch } from '@/ui'

const KIND_ICON = { skill: Sparkles, command: Term, agent: Bot }

export function SkillsView() {
  const cfg = useChatConfig()
  const [provider, setProvider] = useState<ProviderId>(cfg.provider)
  const providers = useApp((s) => s.providers)
  const skills = useApp((s) => s.skills[provider])
  const st = useApp((s) => s.skillState[provider])
  const load = useApp((s) => s.loadSkills)
  const toggle = useApp((s) => s.toggleSkill)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<SkillInfo | null>(null)
  const [kind, setKind] = useState<'all' | 'skill' | 'command' | 'agent'>('all')
  const p = providers.find((x) => x.id === provider)
  useEffect(() => { void load(provider); setSel(null) }, [provider, load, cfg.cwd])
  const list = (skills ?? []).filter((s) => (kind === 'all' || s.kind === kind) && (s.name + s.description).toLowerCase().includes(q.toLowerCase()))
  const counts = { skill: 0, command: 0, agent: 0 }
  for (const s of skills ?? []) counts[s.kind]++
  return (
    <div className="flex h-full min-w-0">
      <div className="h-full min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[820px] px-8 pb-16 pt-6">
          <h1 className="font-display text-[38px] leading-none tracking-tight">Skills</h1>
          <p className="mt-2 text-[13.5px] text-muted">Skills, commands and agents each provider has configured for <span className="font-mono text-fg">{cfg.cwd}</span>.</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Segmented value={provider} onChange={setProvider} options={PROVIDER_IDS.map((id) => ({ value: id, label: <span className="flex items-center gap-1.5"><ProviderMark id={id} size={11} className="!size-4 !rounded-[5px]" />{PROVIDER_NAME[id]}</span> }))} />
            <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-[260px]">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" aria-label="Filter skills" className="h-8 w-full rounded-[10px] border border-line bg-surface pl-8 pr-3 text-[13px] outline-none transition focus:border-accent" />
            </div>
          </div>
          <div className="mt-3"><Segmented value={kind} onChange={setKind} options={[{ value: 'all', label: `All ${skills?.length ?? 0}` }, { value: 'skill', label: `Skills ${counts.skill}` }, { value: 'command', label: `Commands ${counts.command}` }, { value: 'agent', label: `Agents ${counts.agent}` }]} /></div>

          {p && !p.capabilities.skillToggle && (
            <div className="mt-4 flex gap-2.5 rounded-2xl border border-line bg-sunken px-4 py-3 text-[12.5px] text-muted"><Info size={15} className="mt-0.5 shrink-0" />{p.capabilities.limitations.find((l) => /skill/i.test(l)) ?? 'This provider does not let apps switch skills on or off.'}</div>
          )}
          {p && (p.state === 'missing') && <div className="mt-6 rounded-2xl border border-dashed border-line-strong p-10 text-center text-[13px] text-muted">{p.name} isn’t installed, so there are no skills to show.</div>}

          <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-card)]">
            {st?.loading && !skills && <div className="flex items-center gap-2 p-6 text-[13px] text-muted"><Spinner /> Asking {PROVIDER_NAME[provider]} for its skills…</div>}
            {st?.error && <div className="p-5 text-[13px] text-danger">{st.error}</div>}
            {skills && list.length === 0 && <div className="p-10 text-center text-[13px] text-muted">{skills.length ? 'Nothing matches your filter.' : 'No skills are configured for this provider here.'}</div>}
            <AnimatePresence initial={false}>
              {list.map((s, i) => {
                const Icon = KIND_ICON[s.kind]
                return (
                  <motion.div key={s.id} variants={fadeUp} initial="hidden" animate="show" transition={{ delay: Math.min(i, 12) * 0.015 }} layout="position" className={cn('flex items-center gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-sunken/60', sel?.id === s.id && 'bg-accent-soft')}>
                    <button onClick={() => setSel(s)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-sunken text-muted"><Icon size={15} /></span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-medium">{s.name}</span>
                        <span className="line-clamp-1 block text-[12.5px] text-muted">{s.description || 'No description'}</span>
                      </span>
                    </button>
                    {s.toggleable ? <Switch checked={s.enabled} onChange={(v) => void toggle(s, v)} label={`Enable ${s.name}`} /> : <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] text-faint">always on</span>}
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        </div>
      </div>
      <AnimatePresence>
        {sel && (
          <motion.aside initial={{ width: 0, opacity: 0 }} animate={{ width: 340, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={spring} className="shrink-0 overflow-hidden border-l border-line bg-surface/60">
            <div className="h-full w-[340px] overflow-y-auto p-5">
              <div className="mb-4 flex items-start justify-between gap-2">
                <div><div className="text-[11px] font-medium uppercase tracking-wider text-faint">{sel.kind}</div><h2 className="selectable mt-1 break-all text-[17px] font-semibold tracking-tight">{sel.name}</h2></div>
                <button onClick={() => setSel(null)} aria-label="Close details" className="grid size-7 place-items-center rounded-lg text-muted hover:bg-sunken"><X size={15} /></button>
              </div>
              <p className="selectable whitespace-pre-wrap text-[13px] leading-relaxed text-muted">{sel.description || 'No description provided.'}</p>
              <dl className="mt-5 space-y-3 text-[12.5px]">
                <div><dt className="text-faint">Provider</dt><dd>{PROVIDER_NAME[sel.provider]}</dd></div>
                <div><dt className="text-faint">Source</dt><dd className="selectable break-all font-mono text-[12px]">{sel.source}</dd></div>
                <div><dt className="text-faint">Status</dt><dd>{sel.enabled ? 'Enabled' : 'Disabled'}{!sel.toggleable && ' (managed by the provider)'}</dd></div>
              </dl>
              {sel.path && <Button className="mt-5" size="sm" onClick={() => void window.clivra.app.reveal(sel.path!)}><FolderOpen size={13} /> Reveal in folder</Button>}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  )
}

export { base }
