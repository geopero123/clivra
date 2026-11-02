import { describe, it, expect } from 'vitest'
import { applyEvent, blocksToText, type Block, type NormalizedEvent } from '../src/shared/events'
import { mergeSettings, Store } from '../src/main/services/db'
import { DEFAULT_SETTINGS } from '../src/shared/types'
import { buildTranscript, titleFrom } from '../src/main/services/runs'
import { claudeEditDiff } from '../src/main/providers/diffs'
import { compareVersions, parseVersion, LineSplitter, findExecutable } from '../src/main/services/proc'
import { splitMarkdown } from '../src/renderer/src/lib/format'
import { parseUnifiedDiff } from '../src/renderer/src/lib/diff'
import { codexSandbox } from '../src/main/providers/codex'
import { tmpDir } from './helpers'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'

const run = (evs: NormalizedEvent[]) => evs.reduce<Block[]>((b, e) => applyEvent(b, e), [])

describe('normalized event reducer', () => {
  it('accumulates streaming text by block id', () => {
    const b = run([{ type: 'text.delta', blockId: 'a', text: 'Hel' }, { type: 'text.delta', blockId: 'a', text: 'lo' }, { type: 'text.delta', blockId: 'b', text: '!' }])
    expect(b).toHaveLength(2)
    expect(blocksToText(b)).toBe('Hello\n\n!')
  })
  it('tracks tool lifecycle and attaches diffs', () => {
    const b = run([
      { type: 'tool.start', toolId: 't', name: 'Edit', kind: 'edit', title: 'a.ts' },
      { type: 'file.change', toolId: 't', diff: { path: 'a.ts', kind: 'update', diff: '@@ -1 +1 @@\n-a\n+b' } },
      { type: 'tool.end', toolId: 't', status: 'done' }
    ])
    const t = b[0]
    expect(t.kind === 'tool' && t.status).toBe('done')
    expect(t.kind === 'tool' && t.diffs).toHaveLength(1)
  })
  it('permission request → resolved', () => {
    const opts = [{ id: 'a', label: 'Allow', kind: 'allow_once' as const }, { id: 'd', label: 'Deny', kind: 'deny' as const }]
    const b = run([{ type: 'permission.request', requestId: 'r', title: 'x', kind: 'bash', options: opts }, { type: 'permission.resolved', requestId: 'r', optionId: 'd' }])
    expect(b[0]).toMatchObject({ kind: 'permission', status: 'denied' })
  })
  it('run end resolves dangling tools/permissions and is not duplicated', () => {
    const b = run([{ type: 'tool.start', toolId: 't', name: 'Bash', kind: 'bash', title: 'sleep' }, { type: 'run.completed', reason: 'cancelled' }])
    expect(b[0]).toMatchObject({ kind: 'tool', status: 'error' })
  })
  it('duplicate tool.start / permission ids do not duplicate blocks', () => {
    const b = run([{ type: 'tool.start', toolId: 't', name: 'x', kind: 'other', title: 'x' }, { type: 'tool.start', toolId: 't', name: 'x', kind: 'other', title: 'x' }])
    expect(b).toHaveLength(1)
  })
})

describe('settings + store', () => {
  it('deep-merges settings without dropping siblings', () => {
    const m = mergeSettings(DEFAULT_SETTINGS, { appearance: { theme: 'dark' }, defaults: { model: { claude: 'haiku' } } })
    expect(m.appearance.theme).toBe('dark')
    expect(m.appearance.accent).toBe(DEFAULT_SETTINGS.appearance.accent)
    expect(m.defaults.model.claude).toBe('haiku')
  })
  it('persists conversations/messages, full-text search, and recovers interrupted runs', () => {
    const path = join(tmpDir(), 't.db')
    let s = new Store(path)
    const c = s.createConversation({ title: 'Refactor parser', projectId: null, cwd: '/x', provider: 'claude', model: null, effort: null, permissionMode: 'ask' })
    s.addMessage({ conversationId: c.id, role: 'user', blocks: [{ kind: 'text', id: 'u', text: 'please refactor the tokenizer module' }] })
    const a = s.addMessage({ conversationId: c.id, role: 'assistant', blocks: [], provider: 'claude', status: 'streaming' })
    expect(s.search('tokeniz')[0]?.conversationId).toBe(c.id)
    expect(s.search('refactor').length).toBe(1) // de-duplicated per conversation
    s.updateConversation(c.id, { pinned: true, title: 'Renamed' })
    s.close()
    s = new Store(path) // simulate restart while a run was streaming
    expect(s.getConversation(c.id)?.pinned).toBe(true)
    expect(s.listMessages(c.id).find((m) => m.id === a.id)?.status).toBe('interrupted')
    expect(s.search('Renamed')[0]?.conversationId).toBe(c.id)
    s.deleteConversation(c.id)
    expect(s.search('tokenizer')).toHaveLength(0)
    s.close()
  })
})

describe('provider switching handoff', () => {
  it('builds a bounded transcript and labels the source provider', () => {
    const t = buildTranscript([
      { id: '1', conversationId: 'c', role: 'user', blocks: [{ kind: 'text', id: 'u', text: 'hello' }], status: 'complete', createdAt: 1 },
      { id: '2', conversationId: 'c', role: 'assistant', provider: 'codex', blocks: [{ kind: 'text', id: 'a', text: 'hi there' }], status: 'complete', createdAt: 2 }
    ])
    expect(t).toContain('User: hello')
    expect(t).toContain('Assistant (codex): hi there')
    const huge = buildTranscript([{ id: '1', conversationId: 'c', role: 'user', blocks: [{ kind: 'text', id: 'u', text: 'x'.repeat(100_000) }], status: 'complete', createdAt: 1 }])
    expect(huge.length).toBeLessThan(26_000)
  })
  it('titles are trimmed', () => {
    expect(titleFrom('  a\n\n b ')).toBe('a b')
    expect(titleFrom('y'.repeat(200)).length).toBeLessThanOrEqual(56)
  })
})

describe('helpers', () => {
  it('compares versions', () => {
    expect(parseVersion('codex-cli 0.166.0')).toBe('0.166.0')
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0)
  })
  it('splits lines across chunk boundaries', () => {
    const out: string[] = []
    const s = new LineSplitter()
    s.push('{"a":', (l) => out.push(l))
    s.push('1}\n{"b":2}\n{"c"', (l) => out.push(l))
    s.push(':3}\n', (l) => out.push(l))
    expect(out).toEqual(['{"a":1}', '{"b":2}', '{"c":3}'])
  })
  it('does not find missing executables', async () => {
    expect(await findExecutable('definitely-not-a-real-binary-xyz')).toBeNull()
    expect(await findExecutable('x', '/nonexistent/override')).toBeNull()
  })
  it('splits markdown at blank lines but never inside code fences', () => {
    const parts = splitMarkdown('para one\n\n```js\nconst a = 1\n\nconst b = 2\n```\n\npara two')
    expect(parts.map((p) => p.text.split('\n')[0])).toEqual(['para one', '```js', 'para two'])
    expect(splitMarkdown('x\n\n```py\nopen').at(-1)?.open).toBe(true)
  })
  it('parses unified diffs with line numbers', () => {
    const d = parseUnifiedDiff('--- a/f\n+++ b/f\n@@ -3,2 +3,2 @@\n ctx\n-old\n+new\n')
    expect(d.add).toBe(1)
    expect(d.del).toBe(1)
    expect(d.lines.find((l) => l.t === 'add')?.n).toBe(4)
  })
  it('maps permission modes to the Codex sandbox + approval policy', () => {
    expect(codexSandbox('full', '/x')).toMatchObject({ approval: 'never', sandboxMode: 'danger-full-access' })
    expect(codexSandbox('plan', '/x')).toMatchObject({ sandboxMode: 'read-only' })
    expect(codexSandbox('ask', '/x')).toMatchObject({ approval: 'untrusted', sandboxMode: 'workspace-write' })
  })
  it('builds edit diffs from the real file before the tool runs', async () => {
    const dir = tmpDir()
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree\n')
    const d = await claudeEditDiff('Edit', { file_path: join(dir, 'a.txt'), old_string: 'two', new_string: '2' }, dir)
    expect(d?.path).toBe('a.txt')
    expect(d?.diff).toContain('-two')
    expect(d?.diff).toContain('+2')
    const w = await claudeEditDiff('Write', { file_path: join(dir, 'new.txt'), content: 'x' }, dir)
    expect(w?.kind).toBe('add')
  })
})
