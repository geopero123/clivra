import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import type { WebContents } from 'electron'
import type { IPty } from 'node-pty'

let ptyMod: typeof import('node-pty') | null = null
async function loadPty() {
  ptyMod ??= await import('node-pty')
  return ptyMod
}

interface Session {
  pty: IPty
  buf: string
  timer?: NodeJS.Timeout
}

export class TerminalService {
  private sessions = new Map<string, Session>()
  private seq = 0

  constructor(private target: () => WebContents | null) {}

  defaultShell(pref: string): string {
    if (pref && existsSync(pref)) return pref
    if (process.platform === 'win32') return process.env.COMSPEC ?? 'powershell.exe'
    return process.env.SHELL && existsSync(process.env.SHELL) ? process.env.SHELL : '/bin/bash'
  }

  async create(cwd: string | undefined, shellPref: string): Promise<{ id: string; shell: string }> {
    const pty = await loadPty()
    const shell = this.defaultShell(shellPref)
    const id = `term_${++this.seq}`
    const dir = cwd && existsSync(cwd) ? cwd : homedir()
    const p = pty.spawn(shell, process.platform === 'win32' ? [] : ['-l'], {
      name: 'xterm-256color', cols: 100, rows: 28, cwd: dir,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'clivra' } as Record<string, string>
    })
    const s: Session = { pty: p, buf: '' }
    this.sessions.set(id, s)
    // Coalesce output into ~one IPC message per frame so heavy output cannot flood the renderer.
    p.onData((d) => {
      s.buf += d
      if (!s.timer) {
        s.timer = setTimeout(() => {
          s.timer = undefined
          const data = s.buf
          s.buf = ''
          this.target()?.send('terminal:data', id, data)
        }, 8)
      }
    })
    p.onExit(({ exitCode }) => {
      if (s.timer) clearTimeout(s.timer)
      if (s.buf) this.target()?.send('terminal:data', id, s.buf)
      this.sessions.delete(id)
      this.target()?.send('terminal:exit', id, exitCode)
    })
    return { id, shell }
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id)
    if (!s || !Number.isFinite(cols) || !Number.isFinite(rows)) return
    try {
      s.pty.resize(Math.max(2, Math.floor(cols)), Math.max(1, Math.floor(rows)))
    } catch {
      /* pty already exited */
    }
  }

  kill(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    try {
      s.pty.kill()
    } catch {
      /* gone */
    }
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }
}
