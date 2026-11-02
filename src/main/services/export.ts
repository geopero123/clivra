import type { ConversationMeta, StoredMessage } from '@shared/types'

export function toMarkdown(c: ConversationMeta, msgs: StoredMessage[]): string {
  const out: string[] = [`# ${c.title}`, '', `*${c.provider}${c.model ? ` · ${c.model}` : ''} · ${new Date(c.createdAt).toLocaleString()} · ${c.cwd}*`, '']
  for (const m of msgs) {
    out.push(m.role === 'user' ? '## You' : `## ${m.provider ?? 'Assistant'}${m.model ? ` (${m.model})` : ''}`, '')
    for (const a of m.attachments ?? []) out.push(`> 📎 ${a.name}`)
    for (const b of m.blocks) {
      if (b.kind === 'text') out.push(b.text, '')
      else if (b.kind === 'thinking') out.push('<details><summary>Reasoning</summary>', '', b.text, '', '</details>', '')
      else if (b.kind === 'tool') {
        out.push(`**Tool · ${b.name}** — \`${b.title.replace(/`/g, "'")}\` (${b.status})`, '')
        for (const d of b.diffs) out.push('```diff', d.diff.trimEnd(), '```', '')
      } else if (b.kind === 'notice') out.push(`> ${b.level}: ${b.message}`, '')
      else if (b.kind === 'permission') out.push(`> Permission: ${b.title} → ${b.status}`, '')
    }
  }
  return out.join('\n')
}
