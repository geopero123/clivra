#!/usr/bin/env node
// Protocol stand-in for `codex app-server` used ONLY by tests to exercise the adapter's
// approval / streaming / interrupt handling deterministically. It speaks the real wire format.
import readline from 'node:readline'
const rl = readline.createInterface({ input: process.stdin })
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
let nextReq = 100
let turnPending = null
const mode = process.env.FAKE_MODE || 'approve'
rl.on('line', (line) => {
  const m = JSON.parse(line)
  if (m.method === 'initialize') return out({ id: m.id, result: { userAgent: 'fake', codexHome: '/tmp', platformFamily: 'unix', platformOs: 'linux' } })
  if (m.method === 'account/read') return out({ id: m.id, result: { account: { type: 'chatgpt' }, requiresOpenaiAuth: true } })
  if (m.method === 'thread/start' || m.method === 'thread/resume') return out({ id: m.id, result: { thread: { id: 'thr_1' }, model: 'fake-model' } })
  if (m.method === 'turn/start') {
    out({ id: m.id, result: { turn: { id: 'turn_1', items: [], status: 'inProgress' } } })
    out({ method: 'turn/started', params: { threadId: 'thr_1', turn: { id: 'turn_1' } } })
    out({ method: 'item/started', params: { threadId: 'thr_1', turnId: 'turn_1', item: { type: 'reasoning', id: 'r1', summary: [], content: [] } } })
    out({ method: 'item/reasoning/summaryTextDelta', params: { threadId: 'thr_1', turnId: 'turn_1', itemId: 'r1', delta: 'Thinking…', summaryIndex: 0 } })
    out({ method: 'item/started', params: { threadId: 'thr_1', turnId: 'turn_1', item: { type: 'commandExecution', id: 'c1', command: 'echo hi', cwd: '/tmp', status: 'inProgress' } } })
    turnPending = nextReq++
    out({ id: turnPending, method: 'item/commandExecution/requestApproval', params: { threadId: 'thr_1', turnId: 'turn_1', itemId: 'c1', command: 'echo hi', cwd: '/tmp', reason: 'needs approval' } })
    return
  }
  if (m.method === 'turn/interrupt') {
    out({ id: m.id, result: {} })
    return out({ method: 'turn/completed', params: { threadId: 'thr_1', turn: { id: 'turn_1', status: 'interrupted', items: [] } } })
  }
  if (m.id === turnPending && m.result) {
    const accepted = String(m.result.decision).startsWith('accept')
    out({ method: 'item/commandExecution/outputDelta', params: { threadId: 'thr_1', turnId: 'turn_1', itemId: 'c1', delta: accepted ? 'hi\n' : '' } })
    out({ method: 'item/completed', params: { threadId: 'thr_1', turnId: 'turn_1', item: { type: 'commandExecution', id: 'c1', command: 'echo hi', status: accepted ? 'completed' : 'declined', aggregatedOutput: accepted ? 'hi\n' : null, exitCode: accepted ? 0 : null } } })
    out({ method: 'item/started', params: { threadId: 'thr_1', turnId: 'turn_1', item: { type: 'fileChange', id: 'f1', status: 'inProgress', changes: [{ path: '/tmp/a.txt', kind: { type: 'add' }, diff: 'hello\n' }] } } })
    out({ method: 'item/completed', params: { threadId: 'thr_1', turnId: 'turn_1', item: { type: 'fileChange', id: 'f1', status: 'completed', changes: [{ path: '/tmp/a.txt', kind: { type: 'add' }, diff: 'hello\n' }] } } })
    out({ method: 'item/agentMessage/delta', params: { threadId: 'thr_1', turnId: 'turn_1', itemId: 'a1', delta: 'Done' } })
    out({ method: 'item/agentMessage/delta', params: { threadId: 'thr_1', turnId: 'turn_1', itemId: 'a1', delta: '.' } })
    if (mode === 'crash') process.exit(3)
    out({ method: 'turn/completed', params: { threadId: 'thr_1', turn: { id: 'turn_1', status: 'completed', items: [] } } })
  }
})
