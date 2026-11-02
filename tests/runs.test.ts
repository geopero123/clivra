import { describe, it, expect } from 'vitest'
import { RunManager } from '../src/main/services/runs'
import { Store } from '../src/main/services/db'
import type { ProviderAdapter, RunContext } from '../src/main/providers/types'
import type { NormalizedEvent, RunEnvelope } from '../src/shared/events'
import { applyEvent, type Block } from '../src/shared/events'
import { tmpDir } from './helpers'
import { join } from 'node:path'

/** Test doubles for the registry/adapters: exercises RunManager's own logic (not provider behaviour). */
function fakeAdapter(id: 'claude' | 'codex', script: (ctx: RunContext, finish: () => void) => void): ProviderAdapter {
  return {
    id,
    detect: async () => { throw new Error('unused') },
    listModels: async () => [],
    listSkills: async () => [],
    start(ctx) {
      let end!: () => void
      const done = new Promise<void>((r) => (end = r))
      setTimeout(() => script(ctx, end), 5)
      return { done, respondPermission() {}, cancel: async () => { ctx.emit({ type: 'run.completed', reason: 'cancelled' }); end() } }
    }
  }
}

function setup(adapters: Partial<Record<'claude' | 'codex', ProviderAdapter>>) {
  const store = new Store(join(tmpDir(), 'r.db'))
  const envs: RunEnvelope[] = []
  const registry: any = { adapters, executable: async () => '/bin/true' }
  const mgr = new RunManager(store, registry, { events: (e) => envs.push(e), conversationChanged: () => undefined, runFinished: () => undefined })
  const conv = store.createConversation({ title: 'New chat', projectId: null, cwd: tmpDir(), provider: 'claude', model: null, effort: null, permissionMode: 'ask' })
  return { store, mgr, envs, conv }
}
const req = (id: string, cwd: string, provider: 'claude' | 'codex', prompt: string) => ({ conversationId: id, prompt, attachments: [], provider, model: null, effort: null, permissionMode: 'ask' as const, cwd })

describe('RunManager', () => {
  it('persists the streamed assistant message, titles the chat and batches events', async () => {
    const { store, mgr, envs, conv } = setup({
      claude: fakeAdapter('claude', (ctx, end) => {
        ctx.emit({ type: 'session', providerSessionId: 'S1' })
        for (const t of ['a', 'b', 'c']) ctx.emit({ type: 'text.delta', blockId: 'x', text: t })
        ctx.emit({ type: 'run.completed', reason: 'complete' })
        end()
      })
    })
    await mgr.send(req(conv.id, conv.cwd, 'claude', 'Explain the build'))
    await new Promise((r) => setTimeout(r, 120))
    const msgs = store.listMessages(conv.id)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(msgs[1].status).toBe('complete')
    expect(msgs[1].blocks[0]).toMatchObject({ kind: 'text', text: 'abc' })
    expect(store.getConversation(conv.id)).toMatchObject({ title: 'Explain the build', sessions: { claude: 'S1' } })
    const all = envs.flatMap((e) => e.events)
    expect(all.filter((e) => e.type === 'text.delta').length).toBeLessThan(3) // coalesced
    expect(mgr.isRunning(conv.id)).toBe(false)
  })

  it('rejects a second concurrent send on the same conversation (no duplicate runs)', async () => {
    const { mgr, conv } = setup({ claude: fakeAdapter('claude', () => undefined) })
    await mgr.send(req(conv.id, conv.cwd, 'claude', 'one'))
    await expect(mgr.send(req(conv.id, conv.cwd, 'claude', 'two'))).rejects.toThrow(/already running/)
    await mgr.cancel(conv.id)
    expect(mgr.isRunning(conv.id)).toBe(false)
  })

  it('switching provider starts a fresh session with a transcript handoff — sessions are not shared', async () => {
    let seen: RunContext | undefined
    const { store, mgr, conv, envs } = setup({
      claude: fakeAdapter('claude', (ctx, end) => {
        ctx.emit({ type: 'session', providerSessionId: 'CLAUDE_S' })
        ctx.emit({ type: 'text.delta', blockId: 'x', text: 'The answer is 42.' })
        ctx.emit({ type: 'run.completed', reason: 'complete' })
        end()
      }),
      codex: fakeAdapter('codex', (ctx, end) => {
        seen = ctx
        ctx.emit({ type: 'session', providerSessionId: 'CODEX_S' })
        ctx.emit({ type: 'run.completed', reason: 'complete' })
        end()
      })
    })
    await mgr.send(req(conv.id, conv.cwd, 'claude', 'What is the answer?'))
    await new Promise((r) => setTimeout(r, 100))
    await mgr.send(req(conv.id, conv.cwd, 'codex', 'Repeat it'))
    await new Promise((r) => setTimeout(r, 100))
    expect(seen?.providerSessionId).toBeUndefined()
    expect(seen?.instructions).toContain('The answer is 42.')
    expect(seen?.instructions).toContain('<transcript>')
    expect(store.getConversation(conv.id)?.sessions).toEqual({ claude: 'CLAUDE_S', codex: 'CODEX_S' })
    const blocks = envs.flatMap((e) => e.events).reduce<Block[]>((b, e: NormalizedEvent) => applyEvent(b, e), [])
    expect(blocks.some((b) => b.kind === 'notice' && /new codex session/i.test(b.message))).toBe(true)
    // …and going back resumes the original native session
    let resumed: string | undefined
    ;(mgr as any).registry.adapters.claude = fakeAdapter('claude', (ctx, end) => { resumed = ctx.providerSessionId; ctx.emit({ type: 'run.completed', reason: 'complete' }); end() })
    await mgr.send(req(conv.id, conv.cwd, 'claude', 'back'))
    await new Promise((r) => setTimeout(r, 100))
    expect(resumed).toBe('CLAUDE_S')
  })

  it('an adapter that ends without a terminal event still finalises exactly once with an error', async () => {
    const { store, mgr, conv } = setup({ claude: fakeAdapter('claude', (_c, end) => end()) })
    await mgr.send(req(conv.id, conv.cwd, 'claude', 'x'))
    await new Promise((r) => setTimeout(r, 100))
    const a = store.listMessages(conv.id)[1]
    expect(a.status).toBe('error')
    expect(a.blocks.filter((b) => b.kind === 'notice')).toHaveLength(1)
  })
})
