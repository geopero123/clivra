import { describe, it, expect, afterAll } from 'vitest'
import { MemoryService } from '../src/main/services/memory'
import { ProviderRegistry } from '../src/main/services/registry'
import { Store } from '../src/main/services/db'
import { opencodeAdapter } from '../src/main/providers/opencode'
import { findExecutable } from '../src/main/services/proc'
import { tmpDir } from './helpers'
import { join } from 'node:path'

const exe = await findExecutable('opencode')
afterAll(async () => { await opencodeAdapter.shutdown?.() })

;(exe ? describe : describe.skip)('memory summarizer (live OpenCode)', () => {
  it('runs end to end: reports success with facts, or a clear error (e.g. provider rate limit) — never hangs or throws', async () => {
    const store = new Store(join(tmpDir(), 'l.db'))
    store.setSettings({ memory: { enabled: true, model: 'auto', inject: false } } as never)
    const c = store.createConversation({ title: 't', projectId: null, cwd: tmpDir(), provider: 'claude', model: null, effort: null, permissionMode: 'ask' })
    store.addMessage({ conversationId: c.id, role: 'user', blocks: [{ kind: 'text', id: 'u', text: 'I am Giorgi, I live in Tbilisi, Georgia and prefer TypeScript.' }] })
    store.addMessage({ conversationId: c.id, role: 'assistant', provider: 'claude', blocks: [{ kind: 'tool', id: 't', name: 'Bash', toolKind: 'bash', title: 'lscpu', status: 'done', output: 'Model name: AMD Ryzen 7 5800X', diffs: [], startedAt: 0 }, { kind: 'text', id: 'a', text: 'Noted.' }] })
    const svc = new MemoryService(store, new ProviderRegistry(store), () => undefined)
    const s = await svc.summarize(c.id)
    console.log('STATUS', JSON.stringify(s), JSON.stringify(store.listMemories().map((m) => `${m.category}/${m.key}=${m.value}`)))
    expect(s.running).toBe(false)
    expect(s.lastError !== undefined || s.lastAdded !== undefined).toBe(true)
  }, 220_000)
})
