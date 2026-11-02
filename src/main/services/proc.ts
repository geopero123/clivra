import { spawn, execFile, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { homedir } from 'node:os'

const isWin = process.platform === 'win32'

/** Every child we spawn is tracked so nothing outlives the app. */
const live = new Set<ChildProcess>()

export function spawnTracked(cmd: string, args: string[], opts: SpawnOptions = {}): ChildProcess {
  // Never use a shell: arguments are passed as an argv array, so model-provided text can not be re-parsed.
  const child = spawn(cmd, args, { ...opts, shell: false, detached: !isWin, windowsHide: true })
  live.add(child)
  child.once('exit', () => live.delete(child))
  child.once('error', () => live.delete(child))
  return child
}

export function killTree(child: ChildProcess | undefined, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (!child || child.pid === undefined || child.exitCode !== null) return
  try {
    if (isWin) {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => undefined)
    } else {
      process.kill(-child.pid, signal) // whole process group
    }
  } catch {
    try {
      child.kill(signal)
    } catch {
      /* already gone */
    }
  }
}

export function killAllTracked(): void {
  for (const c of live) killTree(c, 'SIGKILL')
  live.clear()
}

export function trackedCount(): number {
  return live.size
}

export interface ExecResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  error?: string
}

/** Run a short command and capture output. Always bounded by a timeout. */
export function exec(cmd: string, args: string[], opts: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv; input?: string } = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawnTracked(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const cap = 2_000_000
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child, 'SIGKILL')
    }, opts.timeout ?? 15_000)
    child.stdout?.on('data', (d) => {
      if (stdout.length < cap) stdout += d
    })
    child.stderr?.on('data', (d) => {
      if (stderr.length < cap) stderr += d
    })
    child.once('error', (e) => {
      clearTimeout(timer)
      resolve({ code: null, stdout, stderr, timedOut, error: e.message })
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
    if (opts.input) child.stdin?.end(opts.input)
    else child.stdin?.end()
  })
}

export function candidateDirs(): string[] {
  const home = homedir()
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  const extra = [
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    join(home, '.opencode', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.cargo', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin'
  ]
  if (isWin) {
    const appData = process.env.APPDATA
    if (appData) extra.push(join(appData, 'npm'))
  }
  return [...new Set([...dirs, ...extra])]
}

async function isExecutable(p: string): Promise<boolean> {
  try {
    await access(p, isWin ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Locate an executable on PATH and well-known install dirs, or honour an explicit user override. */
export async function findExecutable(name: string, override?: string): Promise<string | null> {
  if (override) return (await isExecutable(override)) ? override : null
  const exts = isWin ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').concat(['']) : ['']
  for (const dir of candidateDirs()) {
    for (const ext of exts) {
      const p = join(dir, name + ext.toLowerCase())
      if (await isExecutable(p)) return p
    }
  }
  return null
}

export function parseVersion(text: string): string | null {
  return text.match(/(\d+)\.(\d+)\.(\d+)/)?.[0] ?? null
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\u001b\][^\u0007]*\u0007/g, '')
}

/** Incremental newline splitter that tolerates chunk boundaries inside a line. */
export class LineSplitter {
  private buf = ''
  push(chunk: string | Buffer, onLine: (line: string) => void): void {
    this.buf += chunk.toString()
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '')
      this.buf = this.buf.slice(i + 1)
      if (line.trim()) onLine(line)
    }
  }
  flush(onLine: (line: string) => void): void {
    if (this.buf.trim()) onLine(this.buf.trim())
    this.buf = ''
  }
}
