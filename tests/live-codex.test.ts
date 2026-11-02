import { describe, it, expect } from 'vitest'
import { codexAdapter } from '../src/main/providers/codex'
import { findExecutable } from '../src/main/services/proc'
import { runAdapter, tmpDir } from './helpers'

const exe = await findExecutable('codex')
const d = exe ? describe : describe.skip

d('codex adapter (live, real CLI)', () => {
  it('detects version and reports auth state truthfully', async () => {
    const s = await codexAdapter.detect(exe)
    expect(s.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(['ready', 'unauthenticated']).toContain(s.state)
    if (s.state === 'unauthenticated') expect(s.setup.loginCommand).toBe('codex login')
  })

  it('lists real models + reasoning efforts from app-server', async () => {
    const models = await codexAdapter.listModels(exe!, tmpDir())
    expect(models.length).toBeGreaterThan(0)
    expect(models[0].efforts.length).toBeGreaterThan(0)
  })

  it('lists skills from app-server', async () => {
    const skills = await codexAdapter.listSkills(exe!, tmpDir(), [])
    expect(Array.isArray(skills)).toBe(true)
    expect(skills.every((s) => s.toggleable)).toBe(true)
  })

  it('when signed out, a run fails fast with an actionable auth error (no hang)', async () => {
    const s = await codexAdapter.detect(exe)
    if (s.state === 'ready') return
    const events = await runAdapter(codexAdapter, { executable: exe!, cwd: tmpDir(), prompt: 'hi' })
    const last = events.at(-1)
    expect(last).toMatchObject({ type: 'run.error', code: 'auth' })
  }, 60_000)
})
