import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ClivraAPI } from '@shared/ipc'

const inv = (ch: string, ...a: unknown[]) => ipcRenderer.invoke(ch, ...a)
const on = <T extends unknown[]>(ch: string, cb: (...a: T) => void) => {
  const l = (_e: unknown, ...a: unknown[]) => cb(...(a as T))
  ipcRenderer.on(ch, l)
  return () => ipcRenderer.removeListener(ch, l)
}

const api: ClivraAPI = {
  providers: {
    list: () => inv('providers:list'),
    recheck: (id) => inv('providers:recheck', id),
    models: (id, cwd) => inv('providers:models', id, cwd),
    skills: (id, cwd) => inv('providers:skills', id, cwd),
    toggleSkill: (s, enabled, cwd) => inv('providers:toggleSkill', s, enabled, cwd),
    onStatus: (cb) => on('providers:status', cb)
  },
  chat: {
    send: (req) => inv('chat:send', req),
    cancel: (id) => inv('chat:cancel', id),
    respondPermission: (c, r, o) => inv('chat:permission', c, r, o),
    onEvents: (cb) => on('chat:events', cb)
  },
  conversations: {
    list: () => inv('conv:list'),
    create: (init) => inv('conv:create', init),
    update: (id, patch) => inv('conv:update', id, patch),
    remove: (id) => inv('conv:remove', id),
    messages: (id) => inv('conv:messages', id),
    search: (q) => inv('conv:search', q),
    exportTo: (id, f) => inv('conv:export', id, f),
    activity: (id, limit) => inv('conv:activity', id, limit),
    onChanged: (cb) => on('conv:changed', cb),
    onRemoved: (cb) => on('conv:removed', cb)
  },
  projects: {
    list: () => inv('proj:list'),
    add: (p) => inv('proj:add', p),
    remove: (id) => inv('proj:remove', id),
    git: (p) => inv('proj:git', p),
    gitDiff: (p) => inv('proj:gitDiff', p)
  },
  settings: { get: () => inv('settings:get'), set: (p) => inv('settings:set', p) },
  terminal: {
    create: (cwd) => inv('term:create', cwd),
    write: (id, d) => ipcRenderer.send('term:write', id, d),
    resize: (id, c, r) => ipcRenderer.send('term:resize', id, c, r),
    kill: (id) => inv('term:kill', id),
    onData: (cb) => on('terminal:data', cb),
    onExit: (cb) => on('terminal:exit', cb)
  },
  app: {
    info: () => inv('app:info'),
    pickDirectory: () => inv('app:pickDirectory'),
    pickFiles: () => inv('app:pickFiles'),
    pathForFile: (f) => webUtils.getPathForFile(f),
    openExternal: (u) => inv('app:openExternal', u),
    reveal: (p) => inv('app:reveal', p),
    readFilePreview: (p) => inv('app:readFilePreview', p),
    onShortcut: (cb) => on('app:shortcut', cb)
  }
}

contextBridge.exposeInMainWorld('clivra', api)
