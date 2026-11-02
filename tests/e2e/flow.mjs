import { launch, newUserData } from './lib.mjs'
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const shots = process.env.SHOT_DIR
const ud = newUserData()
const proj = mkdtempSync(join(tmpdir(), 'clivra-proj-'))
writeFileSync(join(proj, 'README.md'), '# Demo\n')
const results = []
const ok = (name) => { results.push(name); console.log('✓', name) }

let { app, page, errors } = await launch(ud)
await page.waitForTimeout(1500)

// settings: dark theme, haiku default, project
await page.evaluate(async (proj) => {
  await window.clivra.settings.set({ appearance: { theme: 'dark' }, defaults: { model: { claude: 'haiku' } } })
  await window.clivra.projects.add(proj)
}, proj)
await page.reload()
await page.waitForSelector('text=New chat')
assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark'); ok('theme persisted + applied (dark)')

// choose the project folder in the composer
await page.getByTitle(/^\/root|^\/home|^\/tmp|.*/).first().waitFor().catch(() => {})
await page.locator('button[title="/root"], button:has(svg.lucide-folder-open)').first().click()
await page.locator('div.backdrop-blur-xl button', { hasText: proj.split('/').pop() }).first().click()
await page.waitForTimeout(400)

// wait for model list to come from the real CLI
await page.waitForFunction(() => /Haiku|Default|Sonnet/.test(document.body.innerText), null, { timeout: 30000 })
await page.getByRole('button', { name: /Haiku 5.5|Default/ }).first().click().catch(() => {})
await page.screenshot({ path: shots + '/02-model-menu.png' })
await page.keyboard.press('Escape')

const box = page.getByLabel('Message')
await box.click()
await box.fill('Use the Write tool to create a file named hello.txt containing exactly: hi there. After it is written, reply with the single word done.')
await page.screenshot({ path: shots + '/03-typed.png' })
await page.keyboard.press('Enter')

await page.waitForSelector('text=Approval needed', { timeout: 90000 })
await page.waitForTimeout(500)
await page.screenshot({ path: shots + '/04-permission.png' })
ok('permission card rendered from real Claude Code request')
assert.equal(existsSync(join(proj, 'hello.txt')), false); ok('file NOT written before approval')

await page.getByRole('button', { name: 'Allow once' }).click()
await page.waitForSelector('[aria-label="Send"]', { timeout: 90000 })
await page.waitForTimeout(600)
assert.equal(readFileSync(join(proj, 'hello.txt'), 'utf8').trim(), 'hi there'); ok('file written after approval')
assert.ok(await page.locator('text=hello.txt').first().isVisible()); ok('tool card + diff visible')
await page.screenshot({ path: shots + '/05-done.png' })

const convs = await page.evaluate(() => window.clivra.conversations.list())
assert.equal(convs.length, 1); assert.equal(convs[0].provider, 'claude'); assert.ok(convs[0].sessions.claude); ok('conversation persisted with provider session id')

// activity
await page.evaluate(() => {})
const act = await page.evaluate((id) => window.clivra.conversations.activity(id), convs[0].id)
assert.ok(act.some((a) => a.kind === 'edit') && act.some((a) => a.kind === 'permission')); ok('activity history recorded (edit + permission)')

// terminal
await page.getByLabel('Terminal (Ctrl+`)').click()
await page.waitForSelector('.xterm-screen', { timeout: 20000 })
await page.waitForTimeout(1200)
await page.locator('.xterm').first().click()
await page.keyboard.type('echo clivra-term-ok')
await page.keyboard.press('Enter')
await page.waitForFunction(() => (document.querySelector('.xterm-rows')?.textContent ?? '').includes('clivra-term-ok'), null, { timeout: 15000 })
ok('integrated terminal runs a command (node-pty + xterm)')
await page.screenshot({ path: shots + '/06-terminal.png' })

// Providers + settings screens
await page.getByLabel('Terminal (Ctrl+`)').click()
await page.getByRole('button', { name: 'Providers', exact: true }).click()
await page.waitForSelector('text=Recheck all')
await page.waitForTimeout(800)
await page.screenshot({ path: shots + '/07-providers.png' })
await page.getByRole('button', { name: 'Skills', exact: true }).first().click()
await page.waitForTimeout(3500)
await page.screenshot({ path: shots + '/08-skills.png' })
await page.getByRole('button', { name: 'Settings', exact: true }).click()
await page.waitForTimeout(500)
await page.screenshot({ path: shots + '/09-settings.png' })

console.log('ERRORS', JSON.stringify(errors))
await app.close()

// ---- restart: persistence ----
;({ app, page, errors } = await launch(ud))
await page.waitForTimeout(1500)
const after = await page.evaluate(async () => ({ c: await window.clivra.conversations.list(), s: await window.clivra.settings.get(), hits: await window.clivra.conversations.search('hello') }))
assert.equal(after.c.length, 1); assert.equal(after.s.appearance.theme, 'dark'); assert.ok(after.hits.length > 0); ok('conversation, settings and FTS search survive a restart')
await page.getByText(after.c[0].title).first().click()
await page.waitForSelector('text=hello.txt', { timeout: 10000 })
await page.keyboard.press('Control+k')
await page.getByPlaceholder(/Search conversations/).fill('hello')
await page.waitForTimeout(500)
await page.screenshot({ path: shots + '/10-search.png' })
ok('history reopens, command palette search works')

// follow-up resumes the same native session
const before = after.c[0].sessions.claude
await page.keyboard.press('Escape')
const box2 = page.getByLabel('Message')
await box2.click()
await box2.fill('Without using any tools, what was the exact content of the file I asked you to create? Answer in 4 words max.')
await page.keyboard.press('Enter')
await page.waitForSelector('[aria-label="Stop"]', { timeout: 20000 })
await page.waitForSelector('[aria-label="Send"]', { timeout: 90000 })
const text = await page.evaluate(() => document.body.innerText)
assert.match(text, /hi there/i); ok('follow-up resumes the provider session (remembers earlier turn)')
const c2 = await page.evaluate(() => window.clivra.conversations.list())
assert.equal(c2[0].sessions.claude, before); ok('same native session id reused')
await page.screenshot({ path: shots + '/11-followup.png' })
console.log('ERRORS', JSON.stringify(errors))
await app.close()
console.log(`\n${results.length} checks passed`)
