import { launch, newUserData } from './lib.mjs'
const shots = process.env.SHOT_DIR
const { app, page, errors } = await launch(newUserData())
await page.evaluate(() => window.clivra.settings.set({ appearance: { theme: 'dark' }, defaults: { model: { claude: 'haiku' }, permissionMode: 'full' } }))
await page.reload(); await page.waitForSelector('text=New chat'); await page.waitForTimeout(2500)
await page.screenshot({ path: shots + '/12-liquid-empty.png' })
const box = page.getByLabel('Message'); await box.click()
await box.fill('Run `sleep 8` in bash, then reply done.')
await page.screenshot({ path: shots + '/13-liquid-typed.png' })
await page.keyboard.press('Enter')
await page.waitForSelector('.liquid-ring', { timeout: 30000 })
await page.waitForTimeout(3500)
await page.screenshot({ path: shots + '/14-liquid-running.png' })
// frame cost while the loops run: sample rAF delta for 2s
const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / 2) }; requestAnimationFrame(f) }))
console.log('FPS_WHILE_RUNNING', fps.toFixed(1), 'ERRORS', JSON.stringify(errors))
await page.getByLabel('Stop').click().catch(() => {})
await app.close()
