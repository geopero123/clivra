import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const require = createRequire(import.meta.url)
const { _electron: electron } = require('playwright')

export const root = resolve(import.meta.dirname, '../..')
export function newUserData() { return mkdtempSync(join(tmpdir(), 'clivra-ud-')) }

export async function launch(userData) {
  const app = await electron.launch({
    executablePath: join(root, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', `--user-data-dir=${userData}`, join(root, 'out/main/index.js')],
    env: { ...process.env, NODE_ENV: 'production' },
    cwd: root
  })
  const page = await app.firstWindow()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  await page.waitForSelector('text=New chat', { timeout: 30000 })
  return { app, page, errors }
}
