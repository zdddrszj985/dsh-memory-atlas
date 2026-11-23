import { open, readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

/** zstd 帧魔数。一个会话文件是许多帧首尾相接，整份解只会得到第一帧。 */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

export const dshHome = () => path.join(homedir(), '.dsh')
export const sessionsRoot = () => path.join(dshHome(), 'sessions')
export const projCacheRoot = () => path.join(dshHome(), 'storages', 'session_projcache', 'sessions')
export const workspaceFile = () => path.join(dshHome(), 'storages', 'workspace.json')

/** 按魔数切出所有 zstd 帧（压缩数据里偶发同字节的概率很低）。 */
export function splitZstdFrames(buf) {
  const starts = []
  let i = 0
  while (i < buf.length) {
    const at = buf.indexOf(ZSTD_MAGIC, i)
    if (at < 0) break
    starts.push(at)
    i = at + 4
  }
  const frames = []
  for (let k = 0; k < starts.length; k += 1) {
    const end = k + 1 < starts.length ? starts[k + 1] : buf.length
    if (end - starts[k] >= 4) frames.push(buf.subarray(starts[k], end))
  }
  return frames
}

/** 解一整份多帧文件；末尾被截断的帧忽略，中间的坏帧跳过。 */
export function decompressZstd(buf) {
  const frames = splitZstdFrames(buf)
  const out = []
  for (const frame of frames) {
    try { out.push(zlib.zstdDecompressSync(frame)) } catch { /* 截断/坏帧 */ }
  }
  return Buffer.concat(out)
}

/** 只读文件头部若干字节，拿到第一行（会话元信息），避免把百 MB 日志读进内存。 */
export async function readSessionHead(file, maxBytes = 262144) {
  const fh = await open(file, 'r')
  try {
    const buf = Buffer.alloc(maxBytes)
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0)
    if (!bytesRead) return null
    const frames = splitZstdFrames(buf.subarray(0, bytesRead))
    let text = ''
    for (const frame of frames) {
      try { text += zlib.zstdDecompressSync(frame).toString('utf8') } catch { break }
      if (text.includes('\n')) break
    }
    const line = text.split('\n').find((x) => x.trim())
    return line ? JSON.parse(line) : null
  } finally {
    await fh.close()
  }
}

/** 解出全部事件。逐帧解析，避免压缩内容和解压文本同时常驻。 */
export async function readSessionEvents(file) {
  const buf = await readFile(file)
  const frames = splitZstdFrames(buf)
  const events = []
  for (const frame of frames) {
    let text
    try { text = zlib.zstdDecompressSync(frame).toString('utf8') } catch { continue }
    for (const line of text.split('\n')) {
      const s = line.trim()
      if (!s) continue
      try {
        const ev = JSON.parse(s)
        if (ev && typeof ev === 'object' && ev.type) events.push(ev)
      } catch { /* 半行 */ }
    }
  }
  return events
}

const pad2 = (n) => String(n).padStart(2, '0')

/** 本地日期键 YYYY-MM-DD。 */
export function dayKey(ms) {
  const d = new Date(Number(ms) || Date.now())
  if (Number.isNaN(d.getTime())) return '1970-01-01'
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

export function clockKey(ms) {
  const d = new Date(Number(ms) || 0)
  if (Number.isNaN(d.getTime())) return ''
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

/** content 可能是字符串、{type,text}、或内容块数组。只取可读文本。 */
export function blocksToText(content) {
  if (typeof content === 'string') return content
  if (!content) return ''
  if (!Array.isArray(content)) {
    if (typeof content.text === 'string') return content.text
    return ''
  }
  const out = []
  for (const block of content) {
    if (!block) continue
    if (typeof block === 'string') { out.push(block); continue }
    if (block.type === 'text' && typeof block.text === 'string') out.push(block.text)
  }
  return out.join('\n').trim()
}

/** 一天里只留「真人说的话」和「助手说的正文」；工具、推理、注入上下文全部丢掉。 */
export function collectVoice(events) {
  const messages = []
  for (const ev of events) {
    if (!ev || !ev.type) continue
    if (ev.type === 'user/message') {
      if (ev.data?.source?.kind !== 'user') continue
      const text = blocksToText(ev.data?.content)
      if (!text.trim()) continue
      messages.push({ role: 'user', text, time: Number(ev.time) || 0 })
    } else if (ev.type === 'assistant/message') {
      const text = blocksToText(ev.data?.message?.content)
      if (!text.trim()) continue
      messages.push({ role: 'assistant', text, time: Number(ev.time) || 0 })
    }
  }
  messages.sort((a, b) => a.time - b.time)
  return messages
}

/** 按本地日分组，返回 [{date, messages, chars}]，日期升序。 */
export function groupByDay(messages) {
  const map = new Map()
  for (const m of messages || []) {
    if (!m || !m.text) continue
    const date = dayKey(m.time)
    if (!map.has(date)) map.set(date, [])
    map.get(date).push(m)
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, list]) => ({
      date,
      messages: list,
      chars: list.reduce((n, m) => n + m.text.length, 0),
    }))
}

/** 把一天的消息渲染成给模型看的逐轮记录。 */
export function renderMessages(messages) {
  const out = []
  for (const m of messages || []) {
    const who = m.role === 'user' ? '用户' : '助手'
    out.push('【' + clockKey(m.time) + '】' + who + '：' + String(m.text || '').trim())
  }
  return out.join('\n\n')
}

const textOf = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' && typeof v.text === 'string' ? v.text : '')

function readProjRecord(json) {
  const rec = json?.record ?? json ?? {}
  const rows = rec.rows ?? {}
  return {
    title: textOf(rows.title?.val ?? rec.title),
    blank: Boolean(rows.sessionListMetadata?.val?.blank),
    lastPromptAt: rows.sessionListMetadata?.val?.lastPromptAt ?? null,
    subagent: rows.subagent?.val?.identity ?? null,
  }
}

async function readProj(sessionId) {
  const dir = projCacheRoot()
  const short = sessionId.replace(/^session-/, '')
  for (const name of [sessionId + '.json', short + '.json']) {
    try {
      return readProjRecord(JSON.parse(await readFile(path.join(dir, name), 'utf8')))
    } catch { /* 换下一个名字 */ }
  }
  return null
}

async function readWorkspaceIndex() {
  const map = new Map()
  const archived = new Set()
  try {
    const json = JSON.parse(await readFile(workspaceFile(), 'utf8'))
    const ids = json?.global?.archivedSessionIds
    if (Array.isArray(ids)) for (const id of ids) archived.add(String(id))
    const tables = json?.tables?.workspaces
    const list = Array.isArray(tables) ? tables : tables && typeof tables === 'object' ? Object.values(tables) : []
    for (const ws of list) {
      if (!ws || typeof ws !== 'object') continue
      const title = textOf(ws.title) || textOf(ws.name) || ''
      const cwd = textOf(ws.path) || textOf(ws.cwd) || ''
      for (const id of Array.isArray(ws.sessionIds) ? ws.sessionIds : []) {
        map.set(String(id), { workspace: title, cwd })
      }
    }
  } catch { /* 没有工作区索引也能用 */ }
  return { map, archived }
}

function findSessionDirs(root, entries) {
  const out = []
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const p = path.join(root, ent.name)
    if (ent.name.startsWith('session-')) out.push(p)
  }
  return out
}

/**
 * 扫描磁盘上的会话。
 * @returns {Promise<Array<{id,title,cwd,workspace,createdAt,lastActive,file}>>}
 */
export async function scanSessions({ archivedIds = new Set(), limit = 200 } = {}) {
  const root = sessionsRoot()
  let top = []
  try { top = await readdir(root, { withFileTypes: true }) } catch { return [] }

  const dirs = []
  for (const ent of top) {
    if (!ent.isDirectory()) continue
    const p = path.join(root, ent.name)
    if (ent.name.startsWith('session-')) { dirs.push(p); continue }
    try {
      const kids = await readdir(p, { withFileTypes: true })
      dirs.push(...findSessionDirs(p, kids))
    } catch { /* 跳过 */ }
  }

  const { map: wsMap, archived } = await readWorkspaceIndex()
  const allArchived = new Set([...archivedIds].map(String))
  for (const id of archived) allArchived.add(String(id))

  const rows = []
  for (const dir of dirs) {
    const id = path.basename(dir)
    if (allArchived.has(id)) continue
    const file = path.join(dir, 'session.v4.jsonl.zstd')
    let head = null
    try { head = await readSessionHead(file, 65536) } catch { continue }
    if (!head || head.type !== 'session') continue
    if (Number(head.delegationDepth) > 0) continue
    const proj = await readProj(id)
    if (proj?.blank) continue
    if (proj?.subagent) continue
    const ws = wsMap.get(id) || {}
    const stamp = typeof proj?.lastPromptAt === 'number' ? proj.lastPromptAt : Date.parse(proj?.lastPromptAt || '') || Number(head.createdAt) || 0
    rows.push({
      id,
      title: (proj?.title || '').trim() || ('未命名会话 ' + id.slice(-6)),
      cwd: String(head.cwd || ws.cwd || ''),
      workspace: ws.workspace || '',
      createdAt: Number(head.createdAt) || 0,
      lastActive: Number(stamp) || Number(head.createdAt) || 0,
      file,
    })
  }
  rows.sort((a, b) => b.lastActive - a.lastActive)
  return rows.slice(0, limit)
}

/** 单会话定位（走缓存列表）。 */
export async function findSession(sessionId, opts = {}) {
  const id = String(sessionId || '')
  if (!id) return null
  if (opts.sessions) return opts.sessions.find((s) => s.id === id) || null
  const rows = await scanSessions({ archivedIds: opts.archivedIds || new Set() })
  return rows.find((s) => s.id === id) || null
}
