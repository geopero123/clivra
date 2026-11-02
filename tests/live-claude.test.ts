import { describe, it, expect } from 'vitest'
import { claudeAdapter } from '../src/main/providers/claude'
import { findExecutable } from '../src/main/services/proc'
import { applyEvent, type Block } from '../src/shared/events'
import { runAdapter, tmpDir } from './helpers'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const exe = await findExecutable('claude')
const d = exe ? describe : describe.skip

d('claude adapter (live, real CLI)', () => {
  it('detects version and auth', async () => {
    const s = await claudeAdapter.detect(exe)
    expect(s.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(['ready', 'unauthenticated', 'update-recommended']).toContain(s.state)
  })

  it('lists real models with effort levels from the CLI', async () => {
    const models = await claudeAdapter.listModels(exe!, tmpDir())
    expect(models.length).toBeGreaterThan(1)
    expect(models.some((m) => m.efforts.length > 0)).toBe(true)
  })

  it('streams text, and routes a Write permission request to the host (deny → file not created)', async () => {
    const cwd = tmpDir()
    const events = await runAdapter(claudeAdapter, { executable: exe!, cwd, model: 'haiku', prompt: 'Use the Write tool to create denied.txt with content "x". Do nothing else.' }, (e, h) => {
      if (e.type === 'permission.request') h.respondPermission(e.requestId, 'deny')
    })
    const types = events.map((e) => e.type)
    expect(types).toContain('session')
    expect(types).toContain('permission.request')
    expect(types).toContain('permission.resolved')
    expect(types.at(-1)).toBe('run.completed')
    expect(existsSync(join(cwd, 'denied.txt'))).toBe(false)
    const blocks = events.reduce<Block[]>((b, e) => applyEvent(b, e), [])
    const perm = blocks.find((b) => b.kind === 'permission')
    expect(perm && perm.kind === 'permission' && perm.status).toBe('denied')
  }, 120_000)

  it('allow → file written, diff + tool lifecycle emitted', async () => {
    const cwd = tmpDir()
    const events = await runAdapter(claudeAdapter, { executable: exe!, cwd, model: 'haiku', prompt: 'Use the Write tool to create hello.txt containing "hi". Then reply "ok".' }, (e, h) => {
      if (e.type === 'permission.request') h.respondPermission(e.requestId, 'allow')
    })
    expect(existsSync(join(cwd, 'hello.txt'))).toBe(true)
    expect(events.some((e) => e.type === 'file.change' && e.diff.kind === 'add')).toBe(true)
    expect(events.some((e) => e.type === 'tool.end' && e.status === 'done')).toBe(true)
    expect(events.some((e) => e.type === 'text.delta')).toBe(true)
    expect(events.at(-1)).toMatchObject({ type: 'run.completed', reason: 'complete' })
  }, 120_000)

  it('cancel terminates the process and reports cancelled', async () => {
    const cwd = tmpDir()
    let cancelled = false
    const events = await runAdapter(claudeAdapter, { executable: exe!, cwd, model: 'haiku', permissionMode: 'full', prompt: 'Run `sleep 60` in bash, then say done.' }, (e, h) => {
      if (e.type === 'tool.start' && !cancelled) {
        cancelled = true
        setTimeout(() => void h.cancel(), 500)
      }
    })
    expect(events.at(-1)).toMatchObject({ type: 'run.completed', reason: 'cancelled' })
  }, 120_000)
})
