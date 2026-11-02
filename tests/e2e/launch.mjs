import { newUserData } from './lib.mjs'
import { join } from 'node:path'
const shots = process.env.SHOT_DIR
const ud = newUserData()
const { createRequire } = await import('node:module')
const { _electron: electron } = createRequire(import.meta.url)('playwright')
const { root } = await import('./lib.mjs')
const app = await electron.launch({ executablePath: join(root, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', `--user-data-dir=${ud}`, join(root, 'out/main/index.js')], cwd: root })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const t0 = Date.now()
const frames = [300, 900, 1500, 2100]
for (const f of frames) { await page.waitForTimeout(Math.max(0, f - (Date.now() - t0))); await page.screenshot({ path: `${shots}/s-launch-${f}.png` }).catch(() => {}) }
await page.waitForSelector('text=What shall we build?', { timeout: 20000 })
const ready = Date.now() - t0
await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 5000 })
console.log('APP_INTERACTIVE_MS', ready, 'SPLASH_GONE_MS', Date.now() - t0)
// seed test memories (clearly synthetic) so the brain shows the memory cluster
await app.evaluate(async ({ app: a }) => {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite'); const db = new DatabaseSync(a.getPath('userData') + '/clivra.db')
  const rows = [['hardware','cpu','AMD Ryzen 7 5800X'],['hardware','ram','32 GB'],['hardware','gpu','RTX 3070'],['preferences','language','TypeScript'],['preferences','editor','Neovim'],['profile','name','Giorgi'],['location','city','Tbilisi, Georgia'],['projects','clivra','Electron desktop client']]
  for (const [c,k,v] of rows) db.prepare('INSERT OR IGNORE INTO memories(category,key,value,conversation_id,provider,updated_at) VALUES(?,?,?,?,?,?)').run(c,k,v,null,'claude',Date.now())
  db.close()
})
await page.getByRole('button', { name: 'Analytics', exact: true }).click()
await page.waitForSelector('text=day streak', { timeout: 20000 }); await page.waitForTimeout(2600)
await page.screenshot({ path: shots + '/s-analytics-top.png' })
await page.locator('main .overflow-y-auto').first().evaluate((el) => (el.scrollTop = 700)); await page.waitForTimeout(1800)
await page.screenshot({ path: shots + '/s-analytics-mid.png' })
await page.locator('main .overflow-y-auto').first().evaluate((el) => (el.scrollTop = 1500)); await page.waitForTimeout(1800)
await page.screenshot({ path: shots + '/s-analytics-low.png' })
await page.getByRole('button', { name: 'Brain', exact: true }).click()
await page.waitForSelector('text=neurons', { timeout: 20000 }); await page.waitForTimeout(3500)
await page.screenshot({ path: shots + '/s-brain.png' })
const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / 2) }; requestAnimationFrame(f) }))
const box = await page.locator('canvas').boundingBox(); await page.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2 + 3); await page.waitForTimeout(900)
await page.screenshot({ path: shots + '/s-brain-hover.png' })
console.log('BRAIN_FPS', fps.toFixed(1), 'ERRORS', JSON.stringify(errors))
await app.close()
