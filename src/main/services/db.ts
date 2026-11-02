import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import type {
  ActivityEntry, Attachment, MemoryItem, ConversationMeta, PermissionMode, Project, ProviderId, SearchHit, Settings, StoredMessage, UsageInfo
} from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { Block } from '@shared/events'
import { blocksToText } from '@shared/events'

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  cwd TEXT NOT NULL, provider TEXT NOT NULL, model TEXT, effort TEXT, permission_mode TEXT NOT NULL DEFAULT 'ask',
  pinned INTEGER NOT NULL DEFAULT 0, sessions TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL, role TEXT NOT NULL, blocks TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
  attachments TEXT, provider TEXT, model TEXT, status TEXT NOT NULL DEFAULT 'complete', usage TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, seq);
CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(message_id UNINDEXED, conversation_id UNINDEXED, text, tokenize='unicode61');
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL, ts INTEGER NOT NULL,
  kind TEXT NOT NULL, summary TEXT NOT NULL, status TEXT NOT NULL, provider TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  conversation_id TEXT, provider TEXT, updated_at INTEGER NOT NULL, UNIQUE(category, key)
);
CREATE INDEX IF NOT EXISTS idx_activity_conv ON activity(conversation_id, ts);
`

type Row = Record<string, any>

export class Store {
  private db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec(SCHEMA)
    // Runs that were live when the app last exited can never resume: mark them clearly.
    this.db.prepare(`UPDATE messages SET status='interrupted' WHERE status='streaming'`).run()
  }

  close(): void {
    try {
      this.db.close()
    } catch {
      /* already closed */
    }
  }

  // ---- settings -------------------------------------------------------
  getSettings(): Settings {
    const row = this.db.prepare(`SELECT value FROM kv WHERE key='settings'`).get() as Row | undefined
    let saved: Partial<Settings> = {}
    try {
      saved = row ? JSON.parse(row.value) : {}
    } catch {
      /* corrupted → defaults */
    }
    return mergeSettings(DEFAULT_SETTINGS, saved)
  }

  setSettings(patch: Partial<Settings>): Settings {
    const next = mergeSettings(this.getSettings(), patch)
    this.db.prepare(`INSERT INTO kv(key,value) VALUES('settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(JSON.stringify(next))
    return next
  }

  // ---- projects -------------------------------------------------------
  listProjects(): Project[] {
    return (this.db.prepare(`SELECT * FROM projects ORDER BY created_at DESC`).all() as Row[]).map(toProject)
  }

  addProject(path: string, name: string): Project {
    const existing = this.db.prepare(`SELECT * FROM projects WHERE path=?`).get(path) as Row | undefined
    if (existing) return toProject(existing)
    const p: Project = { id: randomUUID(), name, path, createdAt: Date.now() }
    this.db.prepare(`INSERT INTO projects(id,name,path,created_at) VALUES(?,?,?,?)`).run(p.id, p.name, p.path, p.createdAt)
    return p
  }

  removeProject(id: string): void {
    this.db.prepare(`DELETE FROM projects WHERE id=?`).run(id)
  }

  getProject(id: string): Project | null {
    const r = this.db.prepare(`SELECT * FROM projects WHERE id=?`).get(id) as Row | undefined
    return r ? toProject(r) : null
  }

  // ---- conversations --------------------------------------------------
  listConversations(runningIds: Set<string>): ConversationMeta[] {
    const rows = this.db
      .prepare(
        `SELECT c.*, (SELECT text FROM messages m WHERE m.conversation_id=c.id AND m.role='assistant' ORDER BY seq DESC LIMIT 1) AS preview
         FROM conversations c ORDER BY c.updated_at DESC`
      )
      .all() as Row[]
    return rows.map((r) => toConversation(r, runningIds.has(r.id)))
  }

  getConversation(id: string, running = false): ConversationMeta | null {
    const r = this.db.prepare(`SELECT * FROM conversations WHERE id=?`).get(id) as Row | undefined
    return r ? toConversation(r, running) : null
  }

  createConversation(c: Omit<ConversationMeta, 'id' | 'createdAt' | 'updatedAt' | 'sessions' | 'running' | 'pinned'>): ConversationMeta {
    const id = randomUUID()
    const now = Date.now()
    this.db
      .prepare(`INSERT INTO conversations(id,title,project_id,cwd,provider,model,effort,permission_mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(id, c.title, c.projectId, c.cwd, c.provider, c.model, c.effort, c.permissionMode, now, now)
    return this.getConversation(id)!
  }

  updateConversation(id: string, patch: Partial<ConversationMeta>, touch = true): void {
    const cols: Record<string, unknown> = {
      title: patch.title, project_id: patch.projectId, cwd: patch.cwd, provider: patch.provider, model: patch.model,
      effort: patch.effort, permission_mode: patch.permissionMode,
      pinned: patch.pinned === undefined ? undefined : patch.pinned ? 1 : 0,
      sessions: patch.sessions === undefined ? undefined : JSON.stringify(patch.sessions)
    }
    const keys = Object.keys(cols).filter((k) => cols[k] !== undefined)
    if (touch) keys.push('updated_at')
    if (!keys.length) return
    const vals = keys.map((k) => (k === 'updated_at' ? Date.now() : cols[k]))
    this.db.prepare(`UPDATE conversations SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`).run(...(vals as any[]), id)
    if (patch.title !== undefined) this.indexTitle(id, patch.title)
  }

  deleteConversation(id: string): void {
    this.db.prepare(`DELETE FROM message_fts WHERE conversation_id=?`).run(id)
    this.db.prepare(`DELETE FROM activity WHERE conversation_id=?`).run(id)
    this.db.prepare(`DELETE FROM conversations WHERE id=?`).run(id)
  }

  private indexTitle(id: string, title: string): void {
    this.db.prepare(`DELETE FROM message_fts WHERE conversation_id=? AND message_id=''`).run(id)
    this.db.prepare(`INSERT INTO message_fts(message_id,conversation_id,text) VALUES('',?,?)`).run(id, title)
  }

  // ---- messages -------------------------------------------------------
  listMessages(conversationId: string): StoredMessage[] {
    return (this.db.prepare(`SELECT * FROM messages WHERE conversation_id=? ORDER BY seq`).all(conversationId) as Row[]).map(toMessage)
  }

  addMessage(m: {
    conversationId: string; role: 'user' | 'assistant'; blocks: Block[]; attachments?: Attachment[]
    provider?: ProviderId; model?: string; status?: StoredMessage['status']
  }): StoredMessage {
    const id = randomUUID()
    const seq = ((this.db.prepare(`SELECT MAX(seq) AS s FROM messages WHERE conversation_id=?`).get(m.conversationId) as Row).s ?? 0) + 1
    const now = Date.now()
    const text = blocksToText(m.blocks)
    this.db
      .prepare(`INSERT INTO messages(id,conversation_id,seq,role,blocks,text,attachments,provider,model,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, m.conversationId, seq, m.role, JSON.stringify(m.blocks), text, m.attachments ? JSON.stringify(m.attachments) : null, m.provider ?? null, m.model ?? null, m.status ?? 'complete', now)
    this.reindex(id, m.conversationId, text)
    return { id, conversationId: m.conversationId, role: m.role, blocks: m.blocks, attachments: m.attachments, provider: m.provider, model: m.model, status: m.status ?? 'complete', createdAt: now }
  }

  saveMessage(id: string, conversationId: string, blocks: Block[], status: StoredMessage['status'], usage?: UsageInfo): void {
    const text = blocksToText(blocks)
    this.db.prepare(`UPDATE messages SET blocks=?, text=?, status=?, usage=COALESCE(?, usage) WHERE id=?`).run(JSON.stringify(blocks), text, status, usage ? JSON.stringify(usage) : null, id)
    this.reindex(id, conversationId, text)
  }

  private reindex(id: string, conversationId: string, text: string): void {
    this.db.prepare(`DELETE FROM message_fts WHERE message_id=?`).run(id)
    if (text.trim()) this.db.prepare(`INSERT INTO message_fts(message_id,conversation_id,text) VALUES(?,?,?)`).run(id, conversationId, text)
  }

  search(q: string, limit = 40): SearchHit[] {
    const tokens = q.match(/[\p{L}\p{N}_]+/gu) ?? []
    if (!tokens.length) return []
    const match = tokens.map((t) => `"${t}"*`).join(' ')
    const rows = this.db
      .prepare(
        `SELECT f.message_id AS mid, f.conversation_id AS cid, c.title AS title, c.updated_at AS updated,
                snippet(message_fts, 2, char(1), char(2), '…', 14) AS snip
         FROM message_fts f JOIN conversations c ON c.id=f.conversation_id
         WHERE message_fts MATCH ? ORDER BY rank LIMIT ?`
      )
      .all(match, limit) as Row[]
    const seen = new Set<string>()
    const hits: SearchHit[] = []
    for (const r of rows) {
      if (seen.has(r.cid)) continue // one result per conversation: the best-ranked match
      seen.add(r.cid)
      hits.push({ conversationId: r.cid, messageId: r.mid, title: r.title, snippet: r.snip, updatedAt: r.updated })
    }
    return hits
  }

  // ---- memory ---------------------------------------------------------
  listMemories(): MemoryItem[] {
    return (this.db.prepare(`SELECT * FROM memories ORDER BY category, updated_at DESC`).all() as Row[]).map((r) => ({
      id: r.id, category: r.category, key: r.key, value: r.value, conversationId: r.conversation_id, provider: r.provider, updatedAt: r.updated_at
    }))
  }

  upsertMemory(m: { category: string; key: string; value: string; conversationId: string | null; provider: ProviderId | null }): void {
    this.db
      .prepare(`INSERT INTO memories(category,key,value,conversation_id,provider,updated_at) VALUES(?,?,?,?,?,?)
                ON CONFLICT(category,key) DO UPDATE SET value=excluded.value, conversation_id=excluded.conversation_id, provider=excluded.provider, updated_at=excluded.updated_at`)
      .run(m.category, m.key, m.value, m.conversationId, m.provider, Date.now())
    // Hard cap so the table can never grow without bound.
    this.db.prepare(`DELETE FROM memories WHERE id IN (SELECT id FROM memories ORDER BY updated_at DESC LIMIT -1 OFFSET 200)`).run()
  }

  deleteMemory(id: number): void {
    this.db.prepare(`DELETE FROM memories WHERE id=?`).run(id)
  }

  clearMemories(): void {
    this.db.prepare(`DELETE FROM memories`).run()
  }

  // ---- activity -------------------------------------------------------
  addActivity(a: Omit<ActivityEntry, 'id'>): void {
    this.db.prepare(`INSERT INTO activity(conversation_id,ts,kind,summary,status,provider) VALUES(?,?,?,?,?,?)`).run(a.conversationId, a.ts, a.kind, a.summary.slice(0, 2000), a.status, a.provider)
  }

  listActivity(conversationId: string | undefined, limit: number): ActivityEntry[] {
    const rows = (conversationId
      ? this.db.prepare(`SELECT * FROM activity WHERE conversation_id=? ORDER BY id DESC LIMIT ?`).all(conversationId, limit)
      : this.db.prepare(`SELECT * FROM activity ORDER BY id DESC LIMIT ?`).all(limit)) as Row[]
    return rows.map((r) => ({ id: r.id, conversationId: r.conversation_id, ts: r.ts, kind: r.kind, summary: r.summary, status: r.status, provider: r.provider }))
  }
}

function toProject(r: Row): Project {
  return { id: r.id, name: r.name, path: r.path, createdAt: r.created_at }
}

function toConversation(r: Row, running: boolean): ConversationMeta {
  let sessions = {}
  try {
    sessions = JSON.parse(r.sessions || '{}')
  } catch {
    /* ignore */
  }
  return {
    id: r.id, title: r.title, projectId: r.project_id, cwd: r.cwd, provider: r.provider, model: r.model, effort: r.effort,
    permissionMode: r.permission_mode as PermissionMode, pinned: !!r.pinned, createdAt: r.created_at, updatedAt: r.updated_at,
    sessions, running, preview: r.preview ? String(r.preview).slice(0, 140) : undefined
  }
}

function toMessage(r: Row): StoredMessage {
  const parse = <T>(s: string | null, d: T): T => {
    try {
      return s ? JSON.parse(s) : d
    } catch {
      return d
    }
  }
  return {
    id: r.id, conversationId: r.conversation_id, role: r.role, blocks: parse(r.blocks, []), attachments: parse(r.attachments, undefined as any),
    provider: r.provider ?? undefined, model: r.model ?? undefined, status: r.status, usage: parse(r.usage, undefined as any), createdAt: r.created_at
  }
}

function isObj(v: unknown): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function mergeSettings<T>(base: T, patch: any): T {
  if (!isObj(base) || !isObj(patch)) return (patch === undefined ? base : patch) as T
  const out: Record<string, any> = { ...base }
  for (const k of Object.keys(patch)) out[k] = isObj(base[k]) && isObj(patch[k]) ? mergeSettings(base[k], patch[k]) : patch[k]
  return out as T
}
