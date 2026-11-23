import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

import {
  collectVoice,
  findSession,
  groupByDay,
  readSessionEvents,
  scanSessions,
} from './lib/transcript.mjs'
import {
  CARD_FILE,
  CHAPTERS,
  DIARY_DIR,
  ensureVault,
  listDiaries,
  normalizeChapter,
  readCard,
  readDiary,
  readLedger,
  readRaw,
  searchArchive,
  stamp,
  vaultStats,
  writeCard,
} from './lib/vault.mjs'
import { createRunner } from './lib/jobs.mjs'

export const name = 'memory-atlas'
export const inject = ['webServer', 'tools']

const VERSION = '0.1.1'
const ROUTE = '/api/memory-atlas'
const STORE = () => path.join(homedir(), '.dsh', 'memory-atlas')
const CONFIG_FILE = () => path.join(STORE(), 'config.json')

const DEFAULTS = () => ({
  version: 1,
  model: { provider: '', model: '' },
  maxDaysPerRun: 20,
  recentDays: 3,
  archives: {},
})

const errText = (err) => String((err && err.message) || err || '未知错误')

const safeName = (s) => String(s || '')
  .replace(/[\\/:*?"<>|\r\n\t]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 28)

function defaultDirFor(session) {
  const root = path.join(homedir(), 'Documents', '忆库')
  const title = safeName(session?.title || path.basename(session?.cwd || '') || '会话')
  const short = String(session?.id || '').replace(/^session-/, '').slice(0, 8) || crypto.randomBytes(4).toString('hex')
  return path.join(root, title + '-' + short)
}

function normalizeConfig(raw) {
  const d = DEFAULTS()
  const src = raw && typeof raw === 'object' ? raw : {}
  const model = src.model && typeof src.model === 'object' ? src.model : {}
  return {
    ...d,
    ...src,
    model: { provider: String(model.provider || ''), model: String(model.model || '') },
    maxDaysPerRun: Math.max(1, Math.min(100, Number(src.maxDaysPerRun) || d.maxDaysPerRun)),
    recentDays: Math.max(1, Math.min(14, Number(src.recentDays) || d.recentDays)),
    archives: src.archives && typeof src.archives === 'object' ? src.archives : {},
  }
}

function sessionArchive(cfg, sid) {
  const entry = cfg.archives?.[sid]
  if (!entry || !entry.dir) return null
  return entry
}

function bestArchiveFor(cfg, session) {
  const list = Object.values(cfg.archives || {}).filter((a) => a && a.dir)
  if (!list.length) return null
  const same = list.filter((a) => a.cwd && session?.cwd && a.cwd === session.cwd)
  const pool = same.length ? same : list
  pool.sort((a, b) => (Number(b.lastUsedAt) || 0) - (Number(a.lastUsedAt) || 0))
  return pool[0] || null
}

export function apply(ctx, pluginConfig = {}) {
  const log = (...args) => {
    try { ctx.logger?.info?.('[忆库]', ...args) } catch { /* 无 logger */ }
  }

  let cfgCache = null
  let sessionsCache = null
  let sessionsAt = 0
  let modelsCache = null
  let modelsAt = 0
  let writing = Promise.resolve()

  async function loadConfig() {
    if (cfgCache) return cfgCache
    try {
      cfgCache = normalizeConfig(JSON.parse(await readFile(CONFIG_FILE(), 'utf8')))
    } catch {
      cfgCache = normalizeConfig({ ...pluginConfig })
    }
    return cfgCache
  }

  async function saveConfig(next) {
    const cfg = normalizeConfig(next)
    await mkdir(STORE(), { recursive: true })
    const file = CONFIG_FILE()
    const tmp = file + '.tmp'
    await writeFile(tmp, JSON.stringify(cfg, null, 2), 'utf8')
    await rename(tmp, file)
    cfgCache = cfg
    return cfg
  }

  function mutate(fn) {
    writing = writing.then(async () => {
      const cfg = await loadConfig()
      const next = await fn(cfg)
      return saveConfig(next || cfg)
    })
    return writing
  }

  const archivedIds = () => {
    try {
      const reg = ctx.get('workspaceRegistry')
      return new Set((reg?.archivedSessionIds || []).map(String))
    } catch { return new Set() }
  }

  async function sessions({ fresh = false } = {}) {
    if (!fresh && sessionsCache && Date.now() - sessionsAt < 4000) return sessionsCache
    sessionsCache = await scanSessions({ archivedIds: archivedIds() })
    sessionsAt = Date.now()
    return sessionsCache
  }

  async function getSession(sid) {
    const rows = await sessions()
    return rows.find((s) => s.id === sid) || null
  }

  async function bindArchive(sid, dir, session) {
    const target = await ensureVault(dir || defaultDirFor(session))
    const cfg = await mutate((cur) => {
      const prev = cur.archives[sid] || {}
      cur.archives[sid] = {
        ...prev,
        dir: target,
        title: session?.title || prev.title || path.basename(target),
        cwd: session?.cwd || prev.cwd || '',
        boundAt: Number(prev.boundAt) || Date.now(),
        lastUsedAt: Date.now(),
      }
      return cur
    })
    return { dir: target, entry: cfg.archives[sid] }
  }

  async function touchArchive(sid) {
    try {
      await mutate((cur) => {
        if (cur.archives[sid]) cur.archives[sid].lastUsedAt = Date.now()
        return cur
      })
    } catch { /* 记不上不影响读 */ }
  }

  const runner = createRunner({
    getLlm: () => { try { return ctx.get('llm') } catch { return null } },
    getDefaultModel: () => {
      try {
        const svc = ctx.get('agentDefaultModel')
        const pick = svc && typeof svc.currentSelection === 'function' ? svc.currentSelection() : null
        return pick?.provider && pick?.model ? { provider: pick.provider, model: pick.model } : null
      } catch { return null }
    },
  })

  async function archivePayload(sid, session) {
    const cfg = await loadConfig()
    const entry = sessionArchive(cfg, sid)
    if (!entry) return { ok: true, bound: false, session: session || { id: sid } }
    await ensureVault(entry.dir)
    const [entries, ledger, diaries, stats] = await Promise.all([
      readCard(entry.dir),
      readLedger(entry.dir),
      listDiaries(entry.dir, await readLedger(entry.dir)),
      vaultStats(entry.dir, await readLedger(entry.dir)),
    ])
    const chapters = CHAPTERS.map((c) => ({
      name: c.name,
      color: c.color,
      hint: c.hint,
      entries: entries.filter((e) => e.chapter === c.name).sort((a, b) => String(b.date).localeCompare(String(a.date))),
    }))
    return {
      ok: true,
      bound: true,
      version: VERSION,
      session: session || { id: sid, title: entry.title, cwd: entry.cwd },
      dir: entry.dir,
      boundAt: entry.boundAt,
      entries,
      chapters,
      diaries,
      stats,
      ledger: { watermark: ledger.watermark, days: ledger.days },
      job: runner.status(),
    }
  }

  /* --------------------------------------------------------------- HTTP ---- */

  const sendJson = (res, code, obj) => {
    try {
      res.statusCode = code
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(obj))
    } catch { /* 断开 */ }
  }

  const blocked = (req, res) => {
    let conn = null
    try { conn = ctx.get('connection') } catch { conn = null }
    if (conn && typeof conn.requestRejection === 'function') {
      try {
        const rejection = conn.requestRejection({ headers: req.headers })
        if (rejection !== undefined && rejection !== null && rejection !== false) {
          sendJson(res, typeof rejection === 'number' ? rejection : 403, { ok: false, error: '没有权限（宿主信任栅栏拒绝）' })
          return true
        }
        return false
      } catch {
        sendJson(res, 403, { ok: false, error: '信任栅栏校验出错' })
        return true
      }
    }
    try {
      const host = String(req.headers.host || '')
      if (!host) return false
      if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host)) {
        sendJson(res, 403, { ok: false, error: '只接受本机请求' })
        return true
      }
      const pick = String(req.headers.origin || req.headers.referer || '')
      if (!pick) return false
      if (new URL(pick).host.toLowerCase() !== host.toLowerCase()) {
        sendJson(res, 403, { ok: false, error: '只接受同源请求' })
        return true
      }
      return false
    } catch { return false }
  }

  const readBody = async (req) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    if (!raw) return {}
    try { return JSON.parse(raw) } catch { return {} }
  }

  async function listSessionsPayload() {
    const cfg = await loadConfig()
    const rows = await sessions()
    return rows.map((s) => {
      const a = sessionArchive(cfg, s.id)
      return {
        id: s.id,
        title: s.title,
        cwd: s.cwd,
        workspace: s.workspace,
        createdAt: s.createdAt,
        lastActive: s.lastActive,
        archive: a ? { dir: a.dir, lastUsedAt: a.lastUsedAt, title: a.title } : null,
      }
    })
  }

  async function modelsPayload() {
    if (modelsCache && Date.now() - modelsAt < 10000) return modelsCache
    const out = { default: null, selected: null, providers: [], error: '' }
    try {
      const cfg = await loadConfig()
      out.selected = cfg.model.provider && cfg.model.model ? { ...cfg.model } : null
    } catch { /* 没配置 */ }
    try {
      const svc = ctx.get('agentDefaultModel')
      const pick = svc && typeof svc.currentSelection === 'function' ? svc.currentSelection() : null
      if (pick?.provider && pick?.model) out.default = { provider: pick.provider, model: pick.model }
    } catch { /* 没默认 */ }
    try {
      const llm = ctx.get('llm')
      const providers = llm && typeof llm.listProviders === 'function' ? llm.listProviders() : []
      for (const p of providers) {
        const row = { id: p.id, name: p.name || p.id, models: [] }
        try {
          const models = await llm.listModels(p.id)
          row.models = (models || []).map((m) => ({ id: m.id, name: m.name || m.id, description: m.description || '' }))
        } catch (err) { row.error = errText(err) }
        out.providers.push(row)
      }
    } catch (err) { out.error = errText(err) }
    modelsCache = out
    modelsAt = Date.now()
    return out
  }

  async function instructionFor(sid) {
    const cfg = await loadConfig()
    const session = await getSession(sid)
    let entry = sessionArchive(cfg, sid)
    if (!entry) {
      const best = bestArchiveFor(cfg, session)
      if (best) {
        entry = (await bindArchive(sid, best.dir, session)).entry
      } else {
        entry = (await bindArchive(sid, defaultDirFor(session), session)).entry
      }
    }
    await touchArchive(sid)
    const entries = await readCard(entry.dir)
    const ledger = await readLedger(entry.dir)
    const diaries = await listDiaries(entry.dir, ledger)
    const recent = diaries.slice(0, Math.max(1, Number(cfg.recentDays) || 3))
    if (!entries.length && !recent.length) {
      return { ok: false, entry, text: '忆库：这个会话还没有整理过。打开侧栏「忆库」，点「开始整理」就会把会话熬成记忆卡和日记。' }
    }
    const lines = [
      '【忆库 · 记忆档案】',
      '在回答用户这次的话之前，先用 read 把下面这些文件读一遍，把之前的记忆接上：',
      '- 记忆卡：' + path.join(entry.dir, CARD_FILE),
    ]
    if (recent.length) {
      lines.push('- 最近 ' + recent.length + ' 天日记：')
      for (const d of recent) lines.push('  · ' + path.join(entry.dir, DIARY_DIR, d.date + '.md'))
    }
    lines.push(
      '',
      '读完再回应用户。不要向用户复述这些路径，也不要说「我读了记忆卡」；如果用户这次问的事和档案里的旧事有关，可以自然提一句。',
      '如果档案和眼前的事实冲突，以眼前的事实为准。',
    )
    return { ok: true, entry, text: lines.join('\n') }
  }

  async function handle(req, res, url) {
    const route = (url.pathname.replace(new RegExp('^' + ROUTE), '') || '/').replace(/\/+$/, '') || '/'
    const method = String(req.method || 'GET').toUpperCase()
    const sidOf = (v) => String(v || url.searchParams.get('sessionId') || url.searchParams.get('sid') || '')

    if (method === 'GET' && route === '/status') {
      const cfg = await loadConfig()
      const rows = await sessions()
      return sendJson(res, 200, {
        ok: true,
        version: VERSION,
        configPath: CONFIG_FILE(),
        store: STORE(),
        sessions: rows.length,
        archives: Object.keys(cfg.archives || {}).length,
        model: cfg.model,
        maxDaysPerRun: cfg.maxDaysPerRun,
        recentDays: cfg.recentDays,
        job: runner.status(),
      })
    }

    if (method === 'GET' && route === '/sessions') {
      return sendJson(res, 200, { ok: true, sessions: await listSessionsPayload() })
    }

    if (method === 'GET' && route === '/archives') {
      const cfg = await loadConfig()
      const map = new Map()
      for (const [sid, a] of Object.entries(cfg.archives || {})) {
        if (!a?.dir) continue
        const row = map.get(a.dir) || { dir: a.dir, title: a.title || path.basename(a.dir), cwd: a.cwd || '', lastUsedAt: 0, sessions: [] }
        row.sessions.push(sid)
        row.lastUsedAt = Math.max(row.lastUsedAt, Number(a.lastUsedAt) || 0)
        map.set(a.dir, row)
      }
      return sendJson(res, 200, { ok: true, archives: [...map.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt) })
    }

    if (method === 'GET' && route === '/models') {
      return sendJson(res, 200, { ok: true, ...(await modelsPayload()) })
    }

    if (method === 'GET' && route === '/archive') {
      const sid = sidOf()
      if (!sid) return sendJson(res, 400, { ok: false, error: '要传 sessionId' })
      const session = await getSession(sid)
      return sendJson(res, 200, await archivePayload(sid, session))
    }

    if (method === 'GET' && route === '/diary') {
      const sid = sidOf()
      const cfg = await loadConfig()
      const entry = sessionArchive(cfg, sid)
      if (!entry) return sendJson(res, 404, { ok: false, error: '这个会话还没有档案' })
      const ledger = await readLedger(entry.dir)
      const diaries = await listDiaries(entry.dir, ledger)
      const date = String(url.searchParams.get('date') || diaries[0]?.date || '')
      if (!date) return sendJson(res, 404, { ok: false, error: '还没有日记' })
      const text = await readDiary(entry.dir, date)
      return sendJson(res, 200, { ok: true, date, text })
    }

    if (method === 'GET' && route === '/raw') {
      const sid = sidOf()
      const cfg = await loadConfig()
      const entry = sessionArchive(cfg, sid)
      if (!entry) return sendJson(res, 404, { ok: false, error: '这个会话还没有档案' })
      const date = String(url.searchParams.get('date') || '')
      if (!date) return sendJson(res, 400, { ok: false, error: '要传 date' })
      const text = await readRaw(entry.dir, date)
      return sendJson(res, 200, { ok: true, date, text })
    }

    if (method === 'GET' && route === '/search') {
      const sid = sidOf()
      const cfg = await loadConfig()
      const entry = sessionArchive(cfg, sid)
      if (!entry) return sendJson(res, 404, { ok: false, error: '这个会话还没有档案' })
      const q = String(url.searchParams.get('q') || url.searchParams.get('query') || '')
      const hits = await searchArchive(entry.dir, q, {
        limit: Number(url.searchParams.get('limit')) || 12,
        date: String(url.searchParams.get('date') || ''),
        scope: String(url.searchParams.get('scope') || 'all'),
      })
      return sendJson(res, 200, { ok: true, hits })
    }

    if (method === 'POST' && route === '/pickdir') {
      let picker = null
      try { picker = ctx.get('directoryPickerController') } catch { picker = null }
      if (!picker || typeof picker.pick !== 'function') {
        return sendJson(res, 400, { ok: false, error: '这个宿主没有提供选文件夹的窗口；可以直接在输入框里填绝对路径' })
      }
      const picked = await picker.pick(new AbortController().signal)
      return sendJson(res, 200, { ok: true, dir: picked || '' })
    }

    if (method === 'POST' && route === '/bind') {
      const body = await readBody(req)
      const sid = sidOf(body.sessionId)
      if (!sid) return sendJson(res, 400, { ok: false, error: '要传 sessionId' })
      const session = await getSession(sid)
      const dir = String(body.dir || '').trim()
      if (dir && !path.isAbsolute(dir)) return sendJson(res, 400, { ok: false, error: '请给绝对路径' })
      try {
        await bindArchive(sid, dir, session)
        return sendJson(res, 200, await archivePayload(sid, session))
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: '建不了档案：' + errText(err) })
      }
    }

    if (method === 'POST' && route === '/unbind') {
      const body = await readBody(req)
      const sid = sidOf(body.sessionId)
      if (!sid) return sendJson(res, 400, { ok: false, error: '要传 sessionId' })
      await mutate((cur) => { delete cur.archives[sid]; return cur })
      return sendJson(res, 200, { ok: true })
    }

    if (method === 'POST' && route === '/config') {
      const body = await readBody(req)
      const cfg = await mutate((cur) => {
        if (body.model && typeof body.model === 'object') {
          cur.model = { provider: String(body.model.provider || ''), model: String(body.model.model || '') }
        }
        if (body.maxDaysPerRun !== undefined) cur.maxDaysPerRun = Math.max(1, Math.min(100, Number(body.maxDaysPerRun) || 20))
        if (body.recentDays !== undefined) cur.recentDays = Math.max(1, Math.min(14, Number(body.recentDays) || 3))
        return cur
      })
      modelsCache = null
      return sendJson(res, 200, { ok: true, config: { model: cfg.model, maxDaysPerRun: cfg.maxDaysPerRun, recentDays: cfg.recentDays } })
    }

    if (method === 'POST' && route === '/distill') {
      const body = await readBody(req)
      const sid = sidOf(body.sessionId)
      if (!sid) return sendJson(res, 400, { ok: false, error: '要传 sessionId' })
      const cfg = await loadConfig()
      const entry = sessionArchive(cfg, sid)
      if (!entry) return sendJson(res, 400, { ok: false, error: '先给这个会话建一个档案' })
      const session = await getSession(sid) || { id: sid, title: entry.title, cwd: entry.cwd, file: '' }
      if (!session.file) {
        const row = await findSession(sid, { sessions: await sessions() })
        if (row) session.file = row.file
      }
      if (!session.file) return sendJson(res, 400, { ok: false, error: '找不到这个会话的原始日志（可能还没落盘或被归档）' })
      if (runner.isRunning()) return sendJson(res, 409, { ok: false, error: '已经有一个整理任务在跑', job: runner.status() })
      const choice = cfg.model.provider && cfg.model.model ? cfg.model : null
      const dates = Array.isArray(body.dates) ? body.dates.map(String) : undefined
      runner.run({
        session,
        dir: entry.dir,
        dates,
        force: Boolean(body.force),
        maxDays: body.maxDays || cfg.maxDaysPerRun,
        provider: choice?.provider,
        model: choice?.model,
      }).catch((err) => log('任务异常：', errText(err)))
      await new Promise((r) => setTimeout(r, 30))
      return sendJson(res, 200, { ok: true, job: runner.status() })
    }

    if (method === 'GET' && route === '/job') {
      return sendJson(res, 200, { ok: true, job: runner.status() })
    }

    if (method === 'POST' && route === '/stop') {
      return sendJson(res, 200, { ok: true, stopped: runner.stop(), job: runner.status() })
    }

    return sendJson(res, 404, { ok: false, error: '未知接口 ' + method + ' ' + route })
  }

  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE,
      handler: async (req, res) => {
        if (blocked(req, res)) return
        try {
          await handle(req, res, new URL(req.url, 'http://127.0.0.1'))
        } catch (err) {
          sendJson(res, 500, { ok: false, error: errText(err) })
        }
      },
    }), 'memory-atlas: HTTP API')
  } catch (err) {
    log('HTTP 路由没挂上：', errText(err))
  }

  /* ----------------------------------------------------------- 指令 ---- */

  try {
    ctx.effect(() => ctx.commands.register({
      name: 'yiku',
      description: '把忆库的记忆卡和最近几天日记递给这个会话，让助手先接上记忆',
      input: { hint: '可留空；也可以写一句这次想回忆什么' },
      handler: async (invocation) => {
        const sid = String(invocation?.agent?.id || '')
        if (!sid) return { kind: 'error', text: '不知道当前会话是谁，读不了忆库' }
        let result
        try { result = await instructionFor(sid) } catch (err) { return { kind: 'error', text: '读忆库失败：' + errText(err) } }
        if (!result.ok) return { kind: 'success', text: result.text }
        const agent = (() => { try { return ctx.get('agents')?.get(sid) } catch { return null } })() || invocation.agent
        if (!agent || typeof agent.followup !== 'function') return { kind: 'error', text: '这个会话没醒着，没法把记忆递过去' }
        try {
          await agent.followup({
            id: crypto.randomUUID(),
            role: 'user',
            content: [{ type: 'text', text: result.text }],
            source: { kind: 'plugin:memory-atlas-inject' },
          })
        } catch (err) {
          return { kind: 'error', text: '递记忆失败：' + errText(err) }
        }
        return { kind: 'success', text: '已把记忆卡和最近的日记递给这个会话。' }
      },
    }), 'memory-atlas: /yiku')
  } catch (err) {
    log('指令没挂上：', errText(err))
  }

  /* ----------------------------------------------------------- 工具 ---- */

  const textOutput = {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: String(value ?? '') }],
  }

  const archiveForExec = async (exec) => {
    const sid = String(exec?.agent?.id || '')
    const cfg = await loadConfig()
    const entry = sessionArchive(cfg, sid)
    return { sid, cfg, entry }
  }

  try {
    ctx.tools.register({
      name: 'atlas_search',
      description: '在「忆库」里搜索这个会话的长期记忆：记忆卡、按天日记、原始对话。问旧事、找原话、确认以前是否聊过什么时用它。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '关键词；中文直接写，空格分隔多个词' },
          date: { type: 'string', description: '只看某一天，格式 YYYY-MM-DD，可留空' },
          scope: { type: 'string', enum: ['all', 'card', 'diary', 'raw'], description: '搜索范围，默认 all' },
          limit: { type: 'number', description: '最多返回几条，默认 12' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      output: textOutput,
      async execute(args, exec) {
        const { entry } = await archiveForExec(exec)
        if (!entry) return '这个会话还没有「忆库」档案。先在侧栏「忆库」里建档并整理，之后才能搜。'
        const hits = await searchArchive(entry.dir, args.query, {
          date: String(args.date || ''),
          scope: String(args.scope || 'all'),
          limit: Number(args.limit) || 12,
        })
        if (!hits.length) return '忆库里没有找到「' + args.query + '」。'
        return hits.map((h, i) => {
          const where = h.kindLabel + (h.date ? ' · ' + h.date : '') + (h.section ? ' · ' + h.section : '')
          return (i + 1) + '. 【' + where + '】' + h.snippet
        }).join('\n\n')
      },
    })
  } catch (err) { log('atlas_search 没挂上：', errText(err)) }

  try {
    ctx.tools.register({
      name: 'atlas_read',
      description: '读「忆库」里的整本记忆卡，或某一天的日记 / 原始对话。需要完整上下文而不只是搜索片段时用它。',
      parameters: {
        type: 'object',
        properties: {
          what: { type: 'string', enum: ['card', 'diary', 'raw'], description: '读什么：card=记忆卡，diary=某天日记，raw=某天原始对话' },
          date: { type: 'string', description: 'diary/raw 必填，格式 YYYY-MM-DD' },
        },
        required: ['what'],
        additionalProperties: false,
      },
      output: textOutput,
      async execute(args, exec) {
        const { entry } = await archiveForExec(exec)
        if (!entry) return '这个会话还没有「忆库」档案。先在侧栏「忆库」里建档并整理。'
        if (args.what === 'card') {
          try { return (await readFile(path.join(entry.dir, CARD_FILE), 'utf8')).slice(0, 24000) } catch { return '记忆卡还是空的。' }
        }
        const date = String(args.date || '')
        if (!date) return '读日记或原始对话要传 date（YYYY-MM-DD）。'
        if (args.what === 'diary') {
          const text = await readDiary(entry.dir, date)
          return text ? text.slice(0, 24000) : '这一天还没有日记。'
        }
        const text = await readRaw(entry.dir, date)
        return text ? text.slice(0, 24000) + (text.length > 24000 ? '\n\n（已截断，需要更多请用 atlas_search 定位）' : '') : '这一天还没有原始对话存档。'
      },
    })
  } catch (err) { log('atlas_read 没挂上：', errText(err)) }

  try {
    ctx.effect(() => () => { runner.stop() })
  } catch { /* 没有 effect 也能跑 */ }

  log('已加载 v' + VERSION + '，档案目录：' + STORE())
}
