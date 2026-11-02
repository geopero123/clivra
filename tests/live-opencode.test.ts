import { describe, it, expect, afterAll } from 'vitest'
import { opencodeAdapter, opencodeRules } from '../src/main/providers/opencode'
import { findExecutable } from '../src/main/services/proc'
import { runAdapter, tmpDir } from './helpers'

const exe = await findExecutable('opencode')
const d = exe ? describe : describe.skip

afterAll(async () => {
  await opencodeAdapter.shutdown?.()
})

d('opencode adapter (live, real CLI + server)', () => {
  it('detects version and connected providers', async () => {
    const s = await opencodeAdapter.detect(exe)
    expect(s.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(['ready', 'unauthenticated']).toContain(s.state)
  }, 90_000)

  it('lists real connected models and skills from the server', async () => {
    const dir = tmpDir()
    const models = await opencodeAdapter.listModels(exe!, dir)
    expect(models.length).toBeGreaterThan(0)
    expect(models.every((m) => m.id.includes('/'))).toBe(true)
    const skills = await opencodeAdapter.listSkills(exe!, dir, [])
    expect(Array.isArray(skills)).toBe(true)
  }, 90_000)

  it('a run reaches the model layer; provider limits surface as a notice and cancel ends cleanly', async () => {
    const models = await opencodeAdapter.listModels(exe!, tmpDir())
    const free = models.find((m) => m.id.startsWith('opencode/')) ?? models[0]
    let cancelled = false
    const events = await runAdapter(opencodeAdapter, { executable: exe!, cwd: tmpDir(), model: free.id, prompt: 'Say hello in 3 words.' }, (e, h) => {
      if (cancelled) return
      if (e.type === 'notice' || e.type === 'text.delta') {
        cancelled = true
        setTimeout(() => void h.cancel(), 300)
      }
    })
    expect(events.some((e) => e.type === 'session')).toBe(true)
    expect(['run.completed', 'run.error']).toContain(events.at(-1)!.type)
  }, 120_000)

  it('maps permission modes to opencode rules', () => {
    expect(opencodeRules('full', [])).toEqual([{ permission: '*', pattern: '*', action: 'allow' }])
    expect(opencodeRules('ask', ['x'])).toContainEqual({ permission: 'skill', pattern: 'x', action: 'deny' })
    expect(opencodeRules('auto-edit', []).find((r) => r.permission === 'edit')?.action).toBe('allow')
  })
})
