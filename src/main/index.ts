import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, shell, session, type IpcMainInvokeEvent } from 'electron'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import type { Attachment, ConversationMeta, ProviderId, SendRequest, Settings, SkillInfo } from '@shared/types'
import { PROVIDER_IDS } from '@shared/types'
import type { ConversationPatch } from '@shared/ipc'
import { Store } from './services/db'
import { ProviderRegistry } from './services/registry'
import { RunManager } from './services/runs'
import { TerminalService } from './services/terminal'
import { gitDiff, gitInfo } from './services/git'
import { killAllTracked } from './services/proc'
import { toMarkdown } from './services/export'
import { MemoryService } from './services/memory'
import { StatsService } from './services/stats'
import { buildBrain } from './services/brain'

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL
let win: BrowserWindow | null = null
let store: Store
let registry: ProviderRegistry
let runs: RunManager
let terminals: TerminalService
let memory: MemoryService
let stats: StatsService
let quitting = false

const send = (channel: string, ...args: unknown[]) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

function assertProvider(id: unknown): ProviderId {
  if (!PROVIDER_IDS.includes(id as ProviderId)) throw new Error('Unknown provider')
  return id as ProviderId
}

function assertDir(p: unknown): string {
  if (typeof p !== 'string' || !p) throw new Error('Invalid directory')
  if (!statSync(p, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`Directory does not exist: ${p}`)
  return p
}

/** Only the app's own window may call privileged handlers. */
function handle<T extends unknown[], R>(channel: string, fn: (e: IpcMainInvokeEvent, ...args: T) => R | Promise<R>) {
  ipcMain.handle(channel, (e, ...args) => {
    const url = e.senderFrame?.url ?? ''
    const ok = isDev ? url.startsWith(process.env.ELECTRON_RENDERER_URL!) : url.startsWith('file://')
    if (!ok) throw new Error('Blocked IPC from untrusted origin')
    return fn(e, ...(args as T))
  })
}

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  win = new BrowserWindow({
    width: 1280, height: 840, minWidth: 880, minHeight: 560, show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16151a' : '#faf9f7',
    title: 'Clivra',
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 18, y: 18 } } : { titleBarOverlay: { color: '#00000000', symbolColor: '#8d8a95', height: 44 } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => (win = null))
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!(isDev && url.startsWith(process.env.ELECTRON_RENDERER_URL!))) e.preventDefault()
  })
  if (isDev) void win.loadURL(process.env.ELECTRON_RENDERER_URL!)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function setupSecurity(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    const csp = isDev
      ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: ws://localhost:* http://localhost:*"
      : "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'"
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } })
  })
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
}

function setupMenu(): void {
  const isMac = process.platform === 'darwin'
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: 'appMenu' as const }] : []),
      { role: 'editMenu' as const },
      { label: 'View', submenu: [{ role: 'reload' as const }, { role: 'toggleDevTools' as const }, { type: 'separator' as const }, { role: 'resetZoom' as const }, { role: 'zoomIn' as const }, { role: 'zoomOut' as const }, { role: 'togglefullscreen' as const }] },
      { role: 'windowMenu' as const }
    ])
  )
}

function notify(title: string, body: string, key: keyof Settings['notifications']): void {
  if (!store.getSettings().notifications[key] || !Notification.isSupported()) return
  if (win?.isFocused()) return
  const n = new Notification({ title, body })
  n.on('click', () => (win?.show(), win?.focus()))
  n.show()
}

function registerIpc(): void {
  // providers
  handle('providers:list', () => registry.all())
  handle('providers:recheck', (_e, id?: ProviderId) => registry.detectAll(id ? assertProvider(id) : undefined))
  handle('providers:models', (_e, id: ProviderId, cwd?: string) => registry.models(assertProvider(id), cwd && statSync(cwd, { throwIfNoEntry: false }) ? cwd : homedir()))
  handle('providers:skills', (_e, id: ProviderId, cwd?: string) => registry.skills(assertProvider(id), cwd && statSync(cwd, { throwIfNoEntry: false }) ? cwd : homedir()))
  handle('providers:toggleSkill', (_e, skill: SkillInfo, enabled: boolean, cwd?: string) => registry.toggleSkill({ ...skill, provider: assertProvider(skill.provider) }, !!enabled, cwd ?? homedir()))

  // chat
  handle('chat:send', async (_e, req: SendRequest) => {
    assertProvider(req.provider)
    assertDir(req.cwd)
    if (typeof req.prompt !== 'string' || (!req.prompt.trim() && !req.attachments?.length)) throw new Error('Empty message')
    return runs.send({ ...req, attachments: (req.attachments ?? []).slice(0, 12) })
  })
  handle('chat:cancel', (_e, id: string) => runs.cancel(id))
  handle('chat:permission', (_e, cid: string, rid: string, oid: string) => runs.respondPermission(cid, rid, oid))

  // conversations
  handle('conv:list', () => store.listConversations(runs.runningIds()))
  handle('conv:create', (_e, init: Partial<ConversationPatch> & { cwd?: string }) => {
    const s = store.getSettings()
    const provider = init.provider ?? s.defaults.provider
    const project = init.projectId ? store.getProject(init.projectId) : null
    const cwd = init.cwd ?? project?.path ?? homedir()
    const c = store.createConversation({
      title: init.title ?? 'New chat', projectId: init.projectId ?? null, cwd, provider,
      model: init.model ?? s.defaults.model[provider] ?? null, effort: init.effort ?? s.defaults.effort[provider] ?? null,
      permissionMode: init.permissionMode ?? s.defaults.permissionMode
    })
    return c
  })
  handle('conv:update', (_e, id: string, patch: ConversationPatch) => {
    if (patch.cwd) assertDir(patch.cwd)
    // Provider sessions are tied to the directory they started in; a new directory means a fresh session.
    const before = store.getConversation(id)
    const extra: Partial<ConversationMeta> = patch.cwd && before && patch.cwd !== before.cwd ? { sessions: {} } : {}
    store.updateConversation(id, { ...(patch as Partial<ConversationMeta>), ...extra }, patch.title !== undefined)
    const c = store.getConversation(id, runs.isRunning(id))!
    send('conv:changed', c)
    return c
  })
  handle('conv:remove', async (_e, id: string) => {
    await runs.cancel(id)
    store.deleteConversation(id)
    send('conv:removed', id)
  })
  handle('conv:messages', (_e, id: string) => store.listMessages(id))
  handle('conv:search', (_e, q: string) => store.search(String(q ?? '')))
  handle('conv:activity', (_e, id?: string, limit = 200) => store.listActivity(id, Math.min(Number(limit) || 200, 1000)))
  handle('conv:export', async (_e, id: string, format: 'markdown' | 'json') => {
    const c = store.getConversation(id)
    if (!c) return null
    const msgs = store.listMessages(id)
    const ext = format === 'json' ? 'json' : 'md'
    const res = await dialog.showSaveDialog(win!, { defaultPath: `${c.title.replace(/[^\w.-]+/g, '_')}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] })
    if (res.canceled || !res.filePath) return null
    writeFileSync(res.filePath, format === 'json' ? JSON.stringify({ conversation: c, messages: msgs }, null, 2) : toMarkdown(c, msgs))
    return res.filePath
  })

  // projects
  handle('proj:list', () => store.listProjects())
  handle('proj:add', async (_e, path?: string) => {
    let dir = path
    if (!dir) {
      const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'], title: 'Choose a project folder' })
      if (r.canceled || !r.filePaths[0]) return null
      dir = r.filePaths[0]
    }
    assertDir(dir)
    return store.addProject(dir, basename(dir))
  })
  handle('proj:remove', (_e, id: string) => store.removeProject(id))
  handle('proj:git', (_e, p: string) => gitInfo(assertDir(p)))
  handle('proj:gitDiff', (_e, p: string) => gitDiff(assertDir(p)))

  // analytics + brain
  handle('stats:get', () => stats.snapshot())
  handle('stats:refresh', async () => (await stats.scan(), stats.snapshot()))
  handle('brain:get', async () => {
    await stats.scan()
    return buildBrain(stats.snapshot(), store.listMemories(), store.listConversations(runs.runningIds()), store.listProjects())
  })

  // memory
  handle('mem:list', () => store.listMemories())
  handle('mem:remove', (_e, id: number) => (store.deleteMemory(Number(id)), send('mem:changed', store.listMemories(), memory.getStatus())))
  handle('mem:clear', () => (store.clearMemories(), send('mem:changed', store.listMemories(), memory.getStatus())))
  handle('mem:summarize', (_e, id: string) => memory.summarize(id))
  handle('mem:status', () => memory.getStatus())

  // settings
  handle('settings:get', () => store.getSettings())
  handle('settings:set', (_e, patch: Partial<Settings>) => {
    const next = store.setSettings(patch)
    if (patch.appearance?.theme) nativeTheme.themeSource = next.appearance.theme
    if (patch.providers) void registry.detectAll()
    return next
  })

  // terminal
  handle('term:create', (_e, cwd?: string) => terminals.create(cwd, store.getSettings().terminal.shell))
  ipcMain.on('term:write', (_e, id: string, data: string) => typeof data === 'string' && terminals.write(id, data))
  ipcMain.on('term:resize', (_e, id: string, c: number, r: number) => terminals.resize(id, c, r))
  handle('term:kill', (_e, id: string) => terminals.kill(id))

  // app
  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, home: homedir(), electron: process.versions.electron }))
  handle('app:pickDirectory', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  handle('app:pickFiles', async (): Promise<Attachment[]> => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile', 'multiSelections'] })
    if (r.canceled) return []
    return r.filePaths.map((p) => {
      const s = statSync(p)
      return { path: p, name: basename(p), size: s.size, kind: /\.(png|jpe?g|gif|webp)$/i.test(p) ? 'image' : 'file' }
    })
  })
  handle('app:openExternal', (_e, url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) links can be opened')
    return shell.openExternal(url)
  })
  handle('app:reveal', (_e, p: string) => shell.showItemInFolder(p))
  handle('app:readFilePreview', async (_e, p: string) => {
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }[extname(p).toLowerCase()]
    if (!mime || (await stat(p)).size > 4_000_000) return null
    return `data:${mime};base64,${(await readFile(p)).toString('base64')}`
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    store = new Store(join(dir, 'clivra.db'))
    nativeTheme.themeSource = store.getSettings().appearance.theme
    registry = new ProviderRegistry(store)
    registry.listeners.add((s) => send('providers:status', s))
    terminals = new TerminalService(() => (win && !win.isDestroyed() ? win.webContents : null))
    stats = new StatsService({ get: (p) => store.getNative(p), set: (p, s, m, sum) => store.setNative(p, s, m, sum), prune: (k) => store.pruneNative(k) }, () => store.clivraStats())
    stats.listeners.add((a) => send('stats:update', a))
    memory = new MemoryService(store, registry, (items, s) => send('mem:changed', items, s))
    runs = new RunManager(store, registry, {
      events: (env) => send('chat:events', env),
      conversationChanged: (c) => send('conv:changed', c),
      permissionRequested: (c, title) => notify(c.title, `Approval needed: ${title}`, 'onPermission'),
      runFinished: (c, outcome, attention) => {
        if (outcome === 'complete') memory.enqueue(c.id)
        if (outcome === 'complete' && attention) notify(c.title, 'Finished', 'onComplete')
        if (outcome === 'error') notify(c.title, 'The run ended with an error', 'onComplete')
      }
    })
    setupSecurity()
    setupMenu()
    registerIpc()
    createWindow()
    // Keep the first paint light: agent detection and the history scan start after the window is up.
    win?.webContents.once('did-finish-load', () => {
      setTimeout(() => void registry.detectAll(), 700)
      setTimeout(() => void stats.scan(), 6000)
    })
    app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
  })

  app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())

  // Never leave agents or terminals running after the app closes.
  app.on('before-quit', (e) => {
    if (quitting) return
    quitting = true
    e.preventDefault()
    terminals?.killAll()
    const hard = setTimeout(() => finish(), 6000)
    const finish = () => {
      clearTimeout(hard)
      killAllTracked()
      store?.close()
      app.exit(0)
    }
    Promise.resolve(runs?.cancelAll())
      .then(() => registry?.shutdown())
      .catch(() => undefined)
      .finally(finish)
  })
}
