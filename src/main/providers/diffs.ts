import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve, relative } from 'node:path'
import { createTwoFilesPatch } from 'diff'
import type { FileDiff } from '@shared/events'

export function makePatch(path: string, before: string, after: string, kind: FileDiff['kind'] = 'update'): FileDiff {
  const diff = createTwoFilesPatch(
    kind === 'add' ? '/dev/null' : `a/${path}`,
    kind === 'delete' ? '/dev/null' : `b/${path}`,
    before,
    after,
    undefined,
    undefined,
    { context: 3 }
  )
  return { path, kind, diff }
}

async function readOrNull(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, 'utf8')
  } catch {
    return null
  }
}

export function displayPath(p: string, cwd: string): string {
  if (!isAbsolute(p)) return p
  const rel = relative(cwd, p)
  return rel && !rel.startsWith('..') ? rel : p
}

/** Build a diff for a Claude Code Edit / Write / MultiEdit call before the tool runs. */
export async function claudeEditDiff(name: string, input: any, cwd: string): Promise<FileDiff | null> {
  const file: string | undefined = input?.file_path ?? input?.notebook_path
  if (!file) return null
  const abs = isAbsolute(file) ? file : resolve(cwd, file)
  const shown = displayPath(abs, cwd)
  const current = await readOrNull(abs)
  if (name === 'Write') {
    const next = String(input.content ?? '')
    return makePatch(shown, current ?? '', next, current === null ? 'add' : 'update')
  }
  const edits: { old_string: string; new_string: string; replace_all?: boolean }[] =
    name === 'MultiEdit' ? (input.edits ?? []) : [{ old_string: input.old_string, new_string: input.new_string, replace_all: input.replace_all }]
  if (!edits.length || typeof edits[0]?.old_string !== 'string') return null
  if (current === null) {
    return makePatch(shown, edits.map((e) => e.old_string).join('\n'), edits.map((e) => e.new_string).join('\n'))
  }
  let next = current
  for (const e of edits) {
    if (!next.includes(e.old_string)) return makePatch(shown, e.old_string, e.new_string)
    next = e.replace_all ? next.split(e.old_string).join(e.new_string) : next.replace(e.old_string, () => e.new_string)
  }
  return makePatch(shown, current, next)
}
