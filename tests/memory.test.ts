import { describe, it, expect } from 'vitest'
import { buildExcerpt, parseFacts, pickBestModel, redact, MemoryService } from '../src/main/services/memory'
import { Store } from '../src/main/services/db'
import { tmpDir } from './helpers'
import { join } from 'node:path'
import type { ModelInfo } from '../src/shared/types'

const model = (id: string, rank?: number, isDefault = false): ModelInfo => ({ id, name: id, provider: 'opencode', efforts: [], rank, isDefault })

describe('memory', () => {
  it('redacts credentials before text leaves the machine', () => {
    const t = redact('key sk-abcdefghijklmnopqrstuvwx and token=abc123456789 and ghp_abcdefghijklmnopqrstuvwxyz1234 ok')
    expect(t).not.toMatch(/sk-abcdef|abc123456789|ghp_abc/)
    expect(t).toContain('ok')
    expect(redact('-----BEGIN RSA PRIVATE KEY-----\nxx\n-----END RSA PRIVATE KEY-----')).toBe('[redacted-private-key]')
  })
  it('picks the highest-ranked model for auto, honours an explicit choice, falls back to default', () => {
    const ms = [model('a/small', 5), model('b/big', 30), model('c/none', undefined, true)]
    expect(pickBestModel(ms, 'auto')?.id).toBe('b/big')
    expect(pickBestModel(ms, 'a/small')?.id).toBe('a/small')
    expect(pickBestModel(ms, 'gone')).toBeNull()
    expect(pickBestModel([model('c/none', undefined, true)], 'auto')?.id).toBe('c/none')
  })
  it('parses and validates model output, dropping junk and secrets', () => {
    const f = parseFacts('Sure!\n[{"category":"hardware","key":"CPU","value":"Ryzen 7"},{"category":"bogus","key":"x","value":"y"},{"category":"profile","key":"pw","value":"password=hunter2hunter2"},{"nope":1}]')
    expect(f).toEqual([{ category: 'hardware', key: 'cpu', value: 'Ryzen 7' }])
    expect(parseFacts('no json here')).toEqual([])
  })
  it('builds a redacted excerpt including tool output (e.g. hardware probes)', () => {
    const x = buildExcerpt([
      { id: '1', conversationId: 'c', role: 'user', blocks: [{ kind: 'text', id: 'u', text: 'what cpu? my key is sk-abcdefghijklmnopqrstuvwx' }], status: 'complete', createdAt: 1 },
      { id: '2', conversationId: 'c', role: 'assistant', provider: 'claude', status: 'complete', createdAt: 2, blocks: [{ kind: 'tool', id: 't', name: 'Bash', toolKind: 'bash', title: 'lscpu', status: 'done', output: 'Model name: AMD Ryzen 7', diffs: [], startedAt: 0 }] }
    ])
    expect(x).toContain('AMD Ryzen 7')
    expect(x).not.toContain('sk-abcdef')
  })
  it('does nothing unless the user opted in', async () => {
    const store = new Store(join(tmpDir(), 'm.db'))
    const svc = new MemoryService(store, {} as never, () => undefined)
    svc.enqueue('whatever')
    await new Promise((r) => setTimeout(r, 30))
    expect(svc.getStatus().lastRun).toBeUndefined()
  })
  it('upserts by category+key (no duplicates) and can forget', () => {
    const store = new Store(join(tmpDir(), 'm.db'))
    store.upsertMemory({ category: 'hardware', key: 'ram', value: '16 GB', conversationId: null, provider: 'claude' })
    store.upsertMemory({ category: 'hardware', key: 'ram', value: '32 GB', conversationId: null, provider: 'codex' })
    expect(store.listMemories()).toHaveLength(1)
    expect(store.listMemories()[0].value).toBe('32 GB')
    store.deleteMemory(store.listMemories()[0].id)
    expect(store.listMemories()).toHaveLength(0)
  })
})
