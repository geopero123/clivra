import type { HighlighterGeneric } from 'shiki'

type H = HighlighterGeneric<any, any>
let hl: Promise<H> | null = null
const loaded = new Set<string>()
const cache = new Map<string, string>()

async function get(): Promise<H> {
  hl ??= import('shiki').then((m) => m.createHighlighter({ themes: ['vitesse-light', 'vitesse-dark'], langs: [] }))
  return hl
}

const ALIAS: Record<string, string> = { sh: 'bash', shell: 'bash', zsh: 'bash', js: 'javascript', ts: 'typescript', py: 'python', yml: 'yaml', md: 'markdown', rs: 'rust', 'c++': 'cpp', cs: 'csharp', patch: 'diff' }

/** Highlight code to HTML (both themes via CSS variables). Falls back to null when the language is unknown. */
export async function highlight(code: string, lang: string): Promise<string | null> {
  const l = ALIAS[lang?.toLowerCase()] ?? lang?.toLowerCase()
  if (!l) return null
  const key = `${l}\u0000${code}`
  const hit = cache.get(key)
  if (hit) return hit
  try {
    const h = await get()
    if (!loaded.has(l)) {
      await h.loadLanguage(l as any)
      loaded.add(l)
    }
    const html = h.codeToHtml(code, { lang: l, themes: { light: 'vitesse-light', dark: 'vitesse-dark' }, defaultColor: 'light' })
    if (cache.size > 300) cache.delete(cache.keys().next().value!)
    cache.set(key, html)
    return html
  } catch {
    return null
  }
}
