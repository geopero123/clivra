import { describe, it, expect } from 'vitest'
import { codexAdapter } from '../src/main/providers/codex'
import { applyEvent, type Block } from '../src/shared/events'
import { runAdapter, tmpDir } from './helpers'
import { chmodSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'

// The adapter spawns `<exe> app-server`; wrap the fixture so it ignores that argument.
function wrapper(mode: string): string {
  const dir = tmpDir()
  const p = join(dir, 'codex-fake')
  writeFileSync(p, `#!/bin/sh\nFAKE_MODE=${mode} exec node ${join(import.meta.dirname, 'fixtures/fake-codex.mjs')}\n`)
  chmodSync(p, 0o755)
  return p
}

describe('codex adapter protocol handling (stand-in app-server)', () => {
  it('maps items/deltas/approvals to normalized events and honours an allow decision', async () => {
    const events = await runAdapter(codexAdapter, { executable: wrapper('approve'), cwd: tmpDir(), prompt: 'go' }, (e, h) => {
      if (e.type === 'permission.request') h.respondPermission(e.requestId, 'accept')
    })
    const blocks = events.reduce<Block[]>((b, e) => applyEvent(b, e), [])
    const tool = blocks.find((b) => b.kind === 'tool' && b.id === 'c1')
    expect(tool && tool.kind === 'tool' && tool.status).toBe('done')
    expect(tool && tool.kind === 'tool' && tool.output).toContain('hi')
    const edit = blocks.find((b) => b.kind === 'tool' && b.id === 'f1')
    expect(edit && edit.kind === 'tool' && edit.diffs[0].kind).toBe('add')
    expect(blocks.find((b) => b.kind === 'text')).toMatchObject({ text: 'Done.' })
    expect(blocks.find((b) => b.kind === 'thinking')).toBeTruthy()
    expect(events.filter((e) => e.type === 'permission.request')).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({ type: 'run.completed', reason: 'complete' })
  })

  it('a deny decision marks the command as failed/declined', async () => {
    const events = await runAdapter(codexAdapter, { executable: wrapper('approve'), cwd: tmpDir(), prompt: 'go' }, (e, h) => {
      if (e.type === 'permission.request') h.respondPermission(e.requestId, 'decline')
    })
    const blocks = events.reduce<Block[]>((b, e) => applyEvent(b, e), [])
    const tool = blocks.find((b) => b.kind === 'tool' && b.id === 'c1')
    expect(tool && tool.kind === 'tool' && tool.status).toBe('error')
    expect(blocks.find((b) => b.kind === 'permission')).toMatchObject({ status: 'denied' })
  })

  it('cancel while waiting for approval interrupts the turn', async () => {
    const events = await runAdapter(codexAdapter, { executable: wrapper('approve'), cwd: tmpDir(), prompt: 'go' }, (e, h) => {
      if (e.type === 'permission.request') void h.cancel()
    })
    expect(events.at(-1)).toMatchObject({ type: 'run.completed', reason: 'cancelled' })
  })

  it('a crash mid-run yields a single recoverable error, not a hang', async () => {
    const events = await runAdapter(codexAdapter, { executable: wrapper('crash'), cwd: tmpDir(), prompt: 'go' }, (e, h) => {
      if (e.type === 'permission.request') h.respondPermission(e.requestId, 'accept')
    })
    const terminals = events.filter((e) => e.type === 'run.error' || e.type === 'run.completed')
    expect(terminals).toHaveLength(1)
    expect(terminals[0]).toMatchObject({ type: 'run.error', recoverable: true })
  })
})
