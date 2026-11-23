import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

/* 测试全部在临时目录里跑，不碰真实的 ~/.dsh 和 ~/Documents。 */
const root = await mkdtemp(path.join(os.tmpdir(), 'atlas-selftest-'))
const home = path.join(root, 'home')
process.env.USERPROFILE = home
process.env.HOME = home

const transcript = await import('../lib/transcript.mjs')
const vault = await import('../lib/vault.mjs')
const extract = await import('../lib/extract.mjs')
const jobs = await import('../lib/jobs.mjs')
const plugin = await import('../index.js')

let passed = 0
let failed = 0

async function test(name, fn) {
  try {
    await fn()
    passed += 1
    console.log('  ok   ' + name)
  } catch (err) {
    failed += 1
    console.log('  FAIL ' + name)
    console.log('       ' + String((err && err.stack) || err).split('\n').slice(0, 4).join('\n       '))
  }
}

function section(title) {
  console.log('\n' + title)
}

const zstdLine = (obj) => zlib.zstdCompressSync(Buffer.from(JSON.stringify(obj) + '\n', 'utf8'))
const ts = (y, m, d, h = 10, min = 0) => new Date(y, m - 1, d, h, min).getTime()

/* ------------------------------------------------------------ transcript */

section('transcript：多帧解码与真人发言')

const sessionEvent = { type: 'session', version: 4, id: 'session-abc', createdAt: ts(2026, 1, 5, 9), cwd: 'E:/fake', delegationDepth: 0 }
const userEvent = {
  type: 'user/message',
  time: ts(2026, 1, 5, 10, 5),
  data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '我想做一个记忆插件' }] },
}
const injectedEvent = {
  type: 'user/message',
  time: ts(2026, 1, 5, 10, 6),
  data: { role: 'user', source: { kind: 'plugin:other' }, content: [{ type: 'text', text: '注入的上下文' }] },
}
const assistantEvent = {
  type: 'assistant/message',
  time: ts(2026, 1, 5, 10, 7),
  data: { message: { role: 'assistant', content: [{ type: 'reasoning', text: '思考中' }, { type: 'text', text: '可以，先按天存档。' }] } },
}
const day2Event = {
  type: 'user/message',
  time: ts(2026, 1, 6, 9, 30),
  data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '今天继续做图谱。' }] },
}

await test('splitZstdFrames 能切开首尾相接的多个帧', () => {
  const buf = Buffer.concat([zstdLine(sessionEvent), zstdLine(userEvent), zstdLine(assistantEvent)])
  assert.equal(transcript.splitZstdFrames(buf).length, 3)
})

await test('decompressZstd 拼回全部帧的行', () => {
  const buf = Buffer.concat([zstdLine(sessionEvent), zstdLine(userEvent)])
  const lines = transcript.decompressZstd(buf).toString('utf8').trim().split('\n')
  assert.equal(lines.length, 2)
  assert.equal(JSON.parse(lines[0]).type, 'session')
  assert.equal(JSON.parse(lines[1]).data.content[0].text, '我想做一个记忆插件')
})

await test('splitZstdFrames 忽略没有魔数的垃圾数据', () => {
  assert.deepEqual(transcript.splitZstdFrames(Buffer.from('not zstd at all')), [])
})

await test('collectVoice 只留真人发言和助手正文，丢掉注入与推理', () => {
  const messages = transcript.collectVoice([sessionEvent, userEvent, injectedEvent, assistantEvent])
  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'user')
  assert.equal(messages[0].text, '我想做一个记忆插件')
  assert.equal(messages[1].role, 'assistant')
  assert.equal(messages[1].text, '可以，先按天存档。')
})

await test('groupByDay 按本地日分组并统计字数', () => {
  const messages = transcript.collectVoice([userEvent, assistantEvent, day2Event])
  const days = transcript.groupByDay(messages)
  assert.equal(days.length, 2)
  assert.equal(days[0].date, '2026-01-05')
  assert.equal(days[1].date, '2026-01-06')
  assert.equal(days[0].messages.length, 2)
  assert.ok(days[0].chars > 0)
})

await test('renderMessages 带时间和说话人', () => {
  const text = transcript.renderMessages([{ role: 'user', text: '早', time: ts(2026, 1, 5, 8, 3) }])
  assert.match(text, /【08:03】用户：早/)
})

/* ------------------------------------------------------- 伪造一份会话日志 */

section('transcript：扫描会话目录')

const sessDir = path.join(home, '.dsh', 'sessions', '--E--fake--', 'session-abc')
await mkdir(sessDir, { recursive: true })
const sessFile = path.join(sessDir, 'session.v4.jsonl.zstd')
await writeFile(sessFile, Buffer.concat([zstdLine(sessionEvent), zstdLine(userEvent), zstdLine(assistantEvent), zstdLine(day2Event)]))
const projDir = path.join(home, '.dsh', 'storages', 'session_projcache', 'sessions')
await mkdir(projDir, { recursive: true })
await writeFile(path.join(projDir, 'session-abc.json'), JSON.stringify({
  record: {
    rows: {
      title: { val: { text: '做忆库插件' } },
      sessionListMetadata: { val: { blank: false, lastPromptAt: ts(2026, 1, 6, 9, 30) } },
    },
  },
}), 'utf8')

await test('readSessionHead 只读头部也能拿到会话元信息', async () => {
  const head = await transcript.readSessionHead(sessFile, 65536)
  assert.equal(head.type, 'session')
  assert.equal(head.cwd, 'E:/fake')
})

await test('readSessionEvents 读全所有帧', async () => {
  const events = await transcript.readSessionEvents(sessFile)
  assert.equal(events.length, 4)
})

await test('scanSessions 读出标题、工作区并认出会话文件', async () => {
  const rows = await transcript.scanSessions({})
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'session-abc')
  assert.equal(rows[0].title, '做忆库插件')
  assert.equal(rows[0].cwd, 'E:/fake')
  assert.equal(rows[0].file, sessFile)
})

await test('scanSessions 会过滤归档会话', async () => {
  const rows = await transcript.scanSessions({ archivedIds: new Set(['session-abc']) })
  assert.equal(rows.length, 0)
})

await test('findSession 能按 id 定位', async () => {
  const row = await transcript.findSession('session-abc')
  assert.equal(row.id, 'session-abc')
})

/* ---------------------------------------------------------------- 记忆卡 */

section('vault：记忆卡解析与合并')

await test('renderMemoryCard / parseMemoryCard 往返保持章节、正文、日期、重要度', () => {
  const entries = [
    { chapter: '我是谁', title: '名字', body: '用户叫小林。', date: '2026-01-05', importance: 4 },
    { chapter: '偏好与习惯', title: '咖啡口味', body: '喜欢手冲，不加糖。', date: '2026-01-06', importance: 3 },
  ]
  const text = vault.renderMemoryCard(entries, { updatedAt: ts(2026, 1, 6, 12) })
  assert.match(text, /## 我是谁/)
  assert.match(text, /### 咖啡口味/)
  const back = vault.parseMemoryCard(text)
  assert.equal(back.length, 2)
  const coffee = back.find((e) => e.title === '咖啡口味')
  assert.equal(coffee.chapter, '偏好与习惯')
  assert.equal(coffee.date, '2026-01-06')
  assert.equal(coffee.importance, 3)
  assert.match(coffee.body, /手冲/)
})

await test('parseMemoryCard 把未知章节归到「在做的事」', () => {
  const back = vault.parseMemoryCard('## 乱七八糟\n\n### 一件事\n\n正文\n')
  assert.equal(back.length, 1)
  assert.equal(back[0].chapter, '在做的事')
})

await test('titleSimilarity 同题 1，近题高，不相关低', () => {
  assert.equal(vault.titleSimilarity('咖啡口味', '咖啡口味！'), 1)
  assert.ok(vault.titleSimilarity('喜欢手冲咖啡', '喜欢手冲咖啡豆') > 0.7)
  assert.ok(vault.titleSimilarity('咖啡口味', '住在杭州') < 0.2)
})

await test('mergeEntries 同章近题合并、正文更新、日期前移，新条目追加', () => {
  const existing = [
    { chapter: '偏好与习惯', title: '喜欢手冲咖啡', body: '喜欢手冲，不加糖。', date: '2026-01-01', importance: 3 },
  ]
  const out = vault.mergeEntries(existing, [
    { chapter: '偏好', title: '喜欢手冲咖啡', body: '喜欢手冲，不加糖，最近开始喝浅烘。', importance: 4 },
    { chapter: '在做的事', title: '开发忆库插件', body: '按天整理会话。', importance: 4 },
  ], { date: '2026-01-06' })
  assert.equal(out.added, 1)
  assert.equal(out.updated, 1)
  assert.equal(out.entries.length, 2)
  const coffee = out.entries.find((e) => e.title === '喜欢手冲咖啡')
  assert.match(coffee.body, /浅烘/)
  assert.equal(coffee.date, '2026-01-06')
  assert.equal(coffee.importance, 4)
})

await test('mergeEntries 每章有条数上限', () => {
  const existing = [1, 2, 3].map((n) => ({ chapter: '待办与线索', title: '任务' + n, body: 'x', date: '2026-01-0' + n, importance: 3 }))
  const out = vault.mergeEntries(existing, [], { perChapter: 2 })
  assert.equal(out.entries.length, 2)
})

/* ------------------------------------------------------------ 模型输出 */

section('extract：模型 JSON 与归一化')

await test('parseModelJson 容忍代码围栏、前后废话和尾逗号', () => {
  const text = '好的，结果如下：\n\`\`\`json\n{"diary":"今天做了插件","cards":[{"chapter":"在做的事","title":"忆库","body":"x"},],}\n\`\`\`\n希望有帮助。'
  const json = extract.parseModelJson(text)
  assert.equal(json.diary, '今天做了插件')
  assert.equal(json.cards.length, 1)
})

await test('parseModelJson 遇到非 JSON 返回 null', () => {
  assert.equal(extract.parseModelJson('今天天气不错'), null)
  assert.equal(extract.parseModelJson(''), null)
})

await test('normalizeDayDoc 归章、去重、截断过长正文', () => {
  const doc = extract.normalizeDayDoc({
    title: '做插件的一天',
    diary: 'd'.repeat(9000),
    cards: [
      { chapter: '偏好', title: '喜欢手冲咖啡', body: '不加糖', importance: 9 },
      { chapter: '偏好', title: '喜欢手冲咖啡！', body: '重复', importance: 3 },
      { chapter: '乱七八糟', title: '忆库进度', body: 'v' .repeat(3000) },
      { chapter: '我是谁', title: '', body: '没有标题' },
    ],
    events: [
      { at: '09:30', what: '开始写插件' },
      { at: '', what: '' },
    ],
  }, { date: '2026-01-05' })
  assert.equal(doc.cards.length, 2)
  assert.equal(doc.cards[0].chapter, '偏好与习惯')
  assert.equal(doc.cards[0].importance, 5)
  assert.equal(doc.cards[1].chapter, '在做的事')
  assert.equal(doc.cards[1].body.length, 1200)
  assert.equal(doc.diary.length, 4000)
  assert.equal(doc.events.length, 1)
})

await test('mergeDayDocs 合并分块、按时间排事件', () => {
  const out = extract.mergeDayDocs([
    { title: '上', diary: '第一段', cards: [{ chapter: '在做的事', title: '插件结构', body: '短', importance: 3 }], events: [{ at: '10:00', what: '写代码' }] },
    { title: '', diary: '第二段', cards: [{ chapter: '在做的事', title: '插件结构', body: '更长的正文', importance: 4 }], events: [{ at: '09:00', what: '起床' }] },
  ], '2026-01-05')
  assert.match(out.diary, /第一段[\s\S]*第二段/)
  assert.equal(out.cards.length, 1)
  assert.equal(out.cards[0].body, '更长的正文')
  assert.equal(out.cards[0].importance, 4)
  assert.deepEqual(out.events.map((e) => e.at), ['09:00', '10:00'])
})

await test('splitForModel 不丢消息且不超过段数上限', () => {
  const messages = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 'x'.repeat(500) + i, time: 0 }))
  const parts = extract.splitForModel(messages, { maxChars: 1200, maxChunks: 3 })
  assert.ok(parts.length > 1 && parts.length <= 3)
  assert.equal(parts.flat().length, 10)
})

/* ------------------------------------------------------------- 文件读写 */

section('vault：档案读写与检索')

const dir = path.join(root, 'vault')
await test('ensureVault 建目录、空记忆卡和账本', async () => {
  const out = await vault.ensureVault(dir)
  assert.equal(out, dir)
  assert.match(await readFile(path.join(dir, '记忆卡.md'), 'utf8'), /# 记忆卡/)
  const ledger = await vault.readLedger(dir)
  assert.equal(ledger.version, 1)
})

const cardEntries = [
  { chapter: '偏好与习惯', title: '咖啡口味', body: '喜欢手冲咖啡，不加糖。', date: '2026-01-05', importance: 4 },
  { chapter: '在做的事', title: '忆库插件', body: '做记忆档案和可视化图谱。', date: '2026-01-06', importance: 5 },
]
await test('writeCard / readCard 往返', async () => {
  await vault.writeCard(dir, cardEntries, { updatedAt: ts(2026, 1, 6, 12) })
  const back = await vault.readCard(dir)
  assert.equal(back.length, 2)
  assert.equal(back.find((e) => e.title === '咖啡口味').importance, 4)
})

await test('writeDiary / readDiary 往返', async () => {
  await vault.writeDiary(dir, '2026-01-06', {
    title: '把忆库跑起来',
    diary: '今天主要在写记忆卡和检索，顺手记了咖啡的预算。',
    events: [{ at: '14:00', what: '写完搜索' }],
    cards: [{ chapter: '在做的事', title: '忆库插件' }],
  })
  const text = await vault.readDiary(dir, '2026-01-06')
  assert.match(text, /把忆库跑起来/)
  assert.match(text, /写完搜索/)
})

await test('writeRawDay / readRaw 往返', async () => {
  await vault.writeRawDay(dir, '2026-01-06', '【14:00】用户：咖啡没了。\n')
  assert.match(await vault.readRaw(dir, '2026-01-06'), /咖啡没了/)
})

await test('listDiaries 按日期倒序并带账本状态', async () => {
  const ledger = await vault.readLedger(dir)
  ledger.days['2026-01-06'] = { status: 'done', messages: 12, cardCount: 2, processedAt: Date.now() }
  await vault.writeLedger(dir, ledger)
  const rows = await vault.listDiaries(dir, await vault.readLedger(dir))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].date, '2026-01-06')
  assert.equal(rows[0].status, 'done')
  assert.equal(rows[0].messages, 12)
})

await test('vaultStats 统计卡片、天数和字数', async () => {
  const stats = await vault.vaultStats(dir, await vault.readLedger(dir))
  assert.equal(stats.cards, 2)
  assert.equal(stats.days, 1)
  assert.equal(stats.rawDays, 1)
  assert.ok(stats.chars > 0)
  assert.equal(stats.chapters.find((c) => c.name === '偏好与习惯').count, 1)
})

await test('searchArchive 命中记忆卡、日记和原文，卡片排前面', async () => {
  const hits = await vault.searchArchive(dir, '咖啡')
  assert.ok(hits.length >= 2)
  assert.equal(hits[0].kind, 'card')
  assert.equal(hits[0].section, '咖啡口味')
  assert.ok(hits.some((h) => h.kind === 'diary'))
  assert.ok(hits.some((h) => h.kind === 'raw'))
})

await test('searchArchive 支持日期和范围过滤', async () => {
  const diaryOnly = await vault.searchArchive(dir, '咖啡', { scope: 'diary' })
  assert.ok(diaryOnly.every((h) => h.kind === 'diary'))
  const otherDay = await vault.searchArchive(dir, '咖啡', { date: '2026-01-07', scope: 'diary' })
  assert.equal(otherDay.length, 0)
})

section('extract / jobs：端到端整理一天')

const payload = {
  title: '做忆库的一天',
  diary: '今天把忆库的整理流程跑通了。',
  cards: [{ chapter: '在做的事', title: '忆库整理流程', body: '按天读取原始对话，生成日记和记忆卡。', importance: 4 }],
  events: [{ at: '10:00', what: '跑通整理流程' }],
}
const fakeLlmOk = {
  stream() {
    return (async function* () {
      yield { type: 'text-delta', text: JSON.stringify(payload) }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()
  },
}

await test('extractDay 解析失败会自动重试一次', async () => {
  let calls = 0
  const flaky = {
    stream() {
      calls += 1
      const text = calls === 1 ? '这不是 JSON' : JSON.stringify(payload)
      return (async function* () {
        yield { type: 'text-delta', text }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  const doc = await extract.extractDay({
    llm: flaky, provider: 'p', model: 'm', date: '2026-01-05',
    messages: [{ role: 'user', text: '我们做忆库', time: ts(2026, 1, 5, 10) }],
    existing: [],
  })
  assert.equal(calls, 2)
  assert.equal(doc.cards[0].title, '忆库整理流程')
  assert.match(doc.diary, /跑通/)
})

await test('runner 把一天整理成记忆卡、日记、原始对话和账本', async () => {
  const runDir = path.join(root, 'run-vault')
  await vault.ensureVault(runDir)
  const runner = jobs.createRunner({ getLlm: () => fakeLlmOk, getDefaultModel: () => null })
  const result = await runner.run({
    session: { id: 'session-abc', title: '做忆库插件', file: sessFile },
    dir: runDir,
    dates: ['2026-01-05'],
    provider: 'p',
    model: 'm',
  })
  assert.equal(result.ok, true)
  assert.equal(result.total, 1)
  assert.equal(result.added, 1)
  const card = await vault.readCard(runDir)
  assert.equal(card.length, 1)
  assert.equal(card[0].title, '忆库整理流程')
  assert.match(await vault.readDiary(runDir, '2026-01-05'), /跑通/)
  const raw = await vault.readRaw(runDir, '2026-01-05')
  assert.match(raw, /我想做一个记忆插件/)
  assert.match(raw, /可以，先按天存档/)
  const ledger = await vault.readLedger(runDir)
  assert.equal(ledger.days['2026-01-05'].status, 'done')
  assert.equal(ledger.days['2026-01-05'].messages, 2)
  assert.ok(ledger.watermark > 0)
})

await test('runner 第二轮跳过已完成的一天', async () => {
  const runDir = path.join(root, 'run-vault')
  const runner = jobs.createRunner({ getLlm: () => fakeLlmOk, getDefaultModel: () => null })
  const result = await runner.run({
    session: { id: 'session-abc', title: '做忆库插件', file: sessFile },
    dir: runDir,
    dates: ['2026-01-05'],
    provider: 'p',
    model: 'm',
  })
  assert.equal(result.ok, true)
  assert.equal(result.total, 0)
  assert.match(result.log.map((x) => x.text).join(' '), /没有需要整理的新内容/)
})

/* --------------------------------------------------------------- 插件 */

section('index.js：路由、工具、指令')

const routes = []
const tools = []
const commands = []
const disposers = []
const fakeCtx = {
  logger: { info() {} },
  effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); return d },
  get(name) {
    if (name === 'workspaceRegistry') return { archivedSessionIds: [] }
    return null
  },
  webServer: { register(opts) { routes.push(opts); return () => {} } },
  tools: { register(spec) { tools.push(spec); return () => {} } },
  commands: { register(spec) { commands.push(spec); return () => {} } },
}

plugin.apply(fakeCtx, {})

async function call(route, { method = 'GET', body = null, headers } = {}) {
  const chunks = body === null ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  const req = Readable.from(chunks)
  req.method = method
  req.url = '/api/memory-atlas' + route
  req.headers = headers || { host: '127.0.0.1:57679' }
  let text = ''
  const res = {
    statusCode: 200,
    setHeader() {},
    end(chunk) { if (chunk) text += String(chunk) },
  }
  await routes[0].handler(req, res)
  return { status: res.statusCode, json: text ? JSON.parse(text) : null }
}

await test('apply 注册前缀路由、两个工具和 /yiku', () => {
  assert.equal(plugin.name, 'memory-atlas')
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, '/api/memory-atlas')
  assert.deepEqual(tools.map((t) => t.name).sort(), ['atlas_read', 'atlas_search'])
  assert.deepEqual(commands.map((c) => c.name), ['yiku'])
})

await test('GET /status 返回版本与会话数', async () => {
  const r = await call('/status')
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.equal(r.json.version, '0.1.1')
  assert.equal(r.json.sessions, 1)
})

await test('GET /sessions 返回扫描到的会话', async () => {
  const r = await call('/sessions')
  assert.equal(r.status, 200)
  assert.equal(r.json.sessions.length, 1)
  assert.equal(r.json.sessions[0].title, '做忆库插件')
})

await test('POST /bind 建档，GET /archive 返回章节与条目', async () => {
  const bound = await call('/bind', { method: 'POST', body: { sessionId: 'session-abc', dir } })
  assert.equal(bound.status, 200)
  assert.equal(bound.json.bound, true)
  assert.equal(bound.json.dir, dir)
  const archive = await call('/archive?sessionId=session-abc')
  assert.equal(archive.status, 200)
  assert.equal(archive.json.bound, true)
  assert.equal(archive.json.entries.length, 2)
  assert.equal(archive.json.chapters.length, 6)
})

await test('GET /diary、/raw、/search 读取已建档内容', async () => {
  const diary = await call('/diary?sessionId=session-abc&date=2026-01-06')
  assert.equal(diary.status, 200)
  assert.match(diary.json.text, /把忆库跑起来/)
  const raw = await call('/raw?sessionId=session-abc&date=2026-01-06')
  assert.equal(raw.status, 200)
  assert.match(raw.json.text, /咖啡没了/)
  const search = await call('/search?sessionId=session-abc&q=' + encodeURIComponent('咖啡'))
  assert.equal(search.status, 200)
  assert.ok(search.json.hits.length >= 2)
})

await test('POST /config 更新每次天数', async () => {
  const r = await call('/config', { method: 'POST', body: { maxDaysPerRun: 7, recentDays: 4 } })
  assert.equal(r.status, 200)
  assert.equal(r.json.config.maxDaysPerRun, 7)
  assert.equal(r.json.config.recentDays, 4)
})

await test('GET /archives 列出已绑定档案', async () => {
  const r = await call('/archives')
  assert.equal(r.status, 200)
  assert.equal(r.json.archives.length, 1)
  assert.deepEqual(r.json.archives[0].sessions, ['session-abc'])
})

await test('atlas_search 工具能搜到记忆卡', async () => {
  const tool = tools.find((t) => t.name === 'atlas_search')
  const out = await tool.execute({ query: '咖啡' }, { agent: { id: 'session-abc' } })
  assert.match(out, /记忆卡/)
  assert.match(out, /咖啡口味/)
})

await test('atlas_read 工具能读整本记忆卡', async () => {
  const tool = tools.find((t) => t.name === 'atlas_read')
  const out = await tool.execute({ what: 'card' }, { agent: { id: 'session-abc' } })
  assert.match(out, /# 记忆卡/)
  assert.match(out, /忆库插件/)
})

await test('/yiku 把记忆卡和日记路径递进当前会话', async () => {
  let injected = ''
  const agent = { id: 'session-abc', async followup(msg) { injected = msg.content[0].text } }
  const res = await commands[0].handler({ agent, rawInput: '' })
  assert.equal(res.kind, 'success')
  assert.match(injected, /记忆卡/)
  assert.match(injected, /2026-01-06\.md/)
})

await test('非本机 Host 被信任栅栏拒绝', async () => {
  const r = await call('/status', { headers: { host: 'evil.example.com' } })
  assert.equal(r.status, 403)
  assert.equal(r.json.ok, false)
})

await test('POST /unbind 解除绑定后 /archive 返回未绑定', async () => {
  const r = await call('/unbind', { method: 'POST', body: { sessionId: 'session-abc' } })
  assert.equal(r.status, 200)
  const archive = await call('/archive?sessionId=session-abc')
  assert.equal(archive.json.bound, false)
})

await test('未知接口回 404', async () => {
  const r = await call('/nope')
  assert.equal(r.status, 404)
})

/* -------------------------------------------------------------- 语法检查 */

section('客户端与入口语法')

for (const rel of ['../client.js', '../index.js', '../lib/transcript.mjs', '../lib/vault.mjs', '../lib/extract.mjs', '../lib/jobs.mjs']) {
  await test('node --check ' + path.basename(rel), () => {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), rel)
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr || r.stdout)
  })
}

/* ------------------------------------------------------------------ 收尾 */

for (const d of disposers) {
  try { await d() } catch { /* 清理失败不影响断言 */ }
}
if (!process.env.ATLAS_KEEP) await rm(root, { recursive: true, force: true })

console.log('\n' + passed + ' passed, ' + failed + ' failed')
if (failed) process.exitCode = 1
