import type { ChildProcess } from 'node:child_process'
import { LineSplitter } from './proc'

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; method: string }

/**
 * Minimal JSONL request/response client for `codex app-server` (JSON-RPC 2.0 "lite":
 * the wire format omits the `jsonrpc` field). Handles server→client requests too.
 */
export class JsonRpcStdio {
  private nextId = 1
  private pending = new Map<number | string, Pending>()
  private split = new LineSplitter()
  closed = false

  constructor(
    private child: ChildProcess,
    private handlers: {
      onNotification: (method: string, params: any) => void
      onRequest: (id: number | string, method: string, params: any) => void
      onParseError?: (line: string) => void
    }
  ) {
    child.stdout?.on('data', (d) =>
      this.split.push(d, (line) => {
        let msg: any
        try {
          msg = JSON.parse(line)
        } catch {
          this.handlers.onParseError?.(line)
          return
        }
        this.dispatch(msg)
      })
    )
    child.once('close', () => this.close(new Error('Process closed')))
    child.once('error', (e) => this.close(e))
  }

  private dispatch(msg: any): void {
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined) && !msg.method) {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message ?? JSON.stringify(msg.error)}`))
      else p.resolve(msg.result)
    } else if (msg.id !== undefined && msg.method) {
      this.handlers.onRequest(msg.id, msg.method, msg.params)
    } else if (msg.method) {
      this.handlers.onNotification(msg.method, msg.params)
    }
  }

  private write(o: unknown): void {
    if (this.closed || !this.child.stdin?.writable) return
    this.child.stdin.write(JSON.stringify(o) + '\n')
  }

  request<T = any>(method: string, params?: unknown, timeoutMs = 60_000): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Connection closed'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method}: timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, {
        method,
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e))
      })
      this.write({ id, method, params })
    })
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params })
  }

  respond(id: number | string, result: unknown): void {
    this.write({ id, result })
  }

  respondError(id: number | string, message: string, code = -32601): void {
    this.write({ id, error: { code, message } })
  }

  close(err: Error): void {
    if (this.closed) return
    this.closed = true
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
  }
}
