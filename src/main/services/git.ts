import type { GitInfo } from '@shared/types'
import { exec } from './proc'

const git = (cwd: string, args: string[], timeout = 8000) => exec('git', ['-C', cwd, ...args], { timeout })

export async function gitInfo(cwd: string): Promise<GitInfo> {
  const inside = await git(cwd, ['rev-parse', '--show-toplevel'])
  if (inside.code !== 0) return { isRepo: false }
  const [branch, status, counts] = await Promise.all([
    git(cwd, ['branch', '--show-current']),
    git(cwd, ['status', '--porcelain']),
    git(cwd, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'])
  ])
  const [behind, ahead] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [undefined, undefined]
  return {
    isRepo: true,
    root: inside.stdout.trim(),
    branch: branch.stdout.trim() || '(detached)',
    dirty: status.stdout.split('\n').filter(Boolean).length,
    ahead,
    behind
  }
}

export async function gitDiff(cwd: string): Promise<string> {
  const r = await git(cwd, ['diff', '--no-color', 'HEAD'], 15000)
  const out = r.code === 0 ? r.stdout : (await git(cwd, ['diff', '--no-color'], 15000)).stdout
  return out.length > 600_000 ? out.slice(0, 600_000) + '\n… diff truncated …' : out
}
