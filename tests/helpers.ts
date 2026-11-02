import type { NormalizedEvent } from '@shared/events'
import type { ProviderAdapter, RunContext } from '../src/main/providers/types'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'clivra-'))
}

export async function runAdapter(adapter: ProviderAdapter, ctx: Partial<RunContext> & { executable: string; prompt: string; cwd: string }, onEvent?: (e: NormalizedEvent, h: ReturnType<ProviderAdapter['start']>) => void) {
  const events: NormalizedEvent[] = []
  const ref: { h?: ReturnType<ProviderAdapter['start']> } = {}
  const handle = adapter.start({
    runId: 'r', conversationId: 'c', attachments: [], model: null, effort: null, permissionMode: 'ask', instructions: '', disabledSkills: [],
    emit: (e) => {
      events.push(e)
      if (ref.h) onEvent?.(e, ref.h)
    },
    ...ctx
  })
  ref.h = handle
  await handle.done
  return events
}
