import { mkdir, readFile, readdir, stat, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'

export const CHAPTERS = [
  { name: '我是谁', color: '#7f8cf8', hint: '身份、处境、在意的事' },
  { name: '在做的事', color: '#46b894', hint: '项目、目标、正在推进的工作' },
  { name: '偏好与习惯', color: '#e0a44e', hint: '工具、口味、沟通方式' },
  { name: '重要决定', color: '#d76f8b', hint: '做过的选择，以及为什么' },
  { name: '人与关系', color: '#4d9fd8', hint: '身边的人、称呼、相处方式' },
  { name: '待办与线索', color: '#9b78d8', hint: '没做完的事、以后要接的线' },
]

export const CHAPTER_NAMES = CHAPTERS.map((c) => c.name)

export const CARD_FILE = '记忆卡.md'
export const DIARY_DIR = '日记'
export const RAW_DIR = '原始对话'
export const LEDGER_FILE = '.atlas.json'

const pad2 = (n) => String(n).padStart(2, '0')
export const todayKey = (d = new Date()) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())

export function stamp(ms = Date.now()) {
  const d = new Date(ms)
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

export function chapterColor(name) {
  return CHAPTERS.find((c) => c.name === name)?.color || '#8b93a7'
}

/** 未知章节就近归到已有六章，保证记忆卡结构稳定。 */
export function normalizeChapter(raw) {
  const s = String(raw || '').trim()
  if (CHAPTER_NAMES.includes(s)) return s
  if (/身份|自我|是谁|性格/.test(s)) return '我是谁'
  if (/偏好|习惯|喜欢|口味|风格/.test(s)) return '偏好与习惯'
  if (/决定|选择|取舍/.test(s)) return '重要决定'
  if (/关系|人物|朋友|家人|同事|人脉/.test(s)) return '人与关系'
  if (/待办|线索|计划|todo|下一步/i.test(s)) return '待办与线索'
  return '在做的事'
}

const clean = (s) => String(s ?? '').replace(/\r\n/g, '\n').trim()

/** 解析记忆卡：## 章 / ### 条 / 正文 / <!-- d:日期 i:重要度 --> */
export function parseMemoryCard(text) {
  const entries = []
  let chapter = null
  let entry = null
  const flush = () => {
    if (!entry) return
    entry.body = entry.bodyLines.join('\n').trim()
    entry.title = entry.title.trim()
    if (entry.title) entries.push({ chapter: entry.chapter, title: entry.title, body: entry.body, date: entry.date, importance: entry.importance })
    entry = null
  }
  for (const raw of String(text || '').replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    if (line.startsWith('## ')) {
      flush()
      const name = line.slice(3).trim()
      chapter = CHAPTER_NAMES.includes(name) ? name : null
      continue
    }
    if (line.startsWith('### ')) {
      flush()
      entry = { chapter: chapter || '在做的事', title: line.slice(4).trim(), bodyLines: [], date: '', importance: 3 }
      continue
    }
    if (!entry) continue
    const dateMatch = line.match(/<!--\s*d:(\d{4}-\d{2}-\d{2})(?:\s+i:(\d))?\s*-->/)
    if (dateMatch) {
      entry.date = dateMatch[1]
      entry.importance = Number(dateMatch[2]) || entry.importance
      continue
    }
    entry.bodyLines.push(line)
  }
  flush()
  return entries
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    const da = a.date || ''
    const db = b.date || ''
    if (da !== db) return db.localeCompare(da)
    return (Number(b.importance) || 0) - (Number(a.importance) || 0)
  })
}

/** 生成整本记忆卡。 */
export function renderMemoryCard(entries, { updatedAt = Date.now() } = {}) {
  const lines = [
    '# 记忆卡',
    '',
    '> 忆库自动整理。这里只放**长期有用**的事实，不放大段对话。',
    '> 最后更新：' + stamp(updatedAt) + ' · 原始对话按天存放在「原始对话/」，日记在「日记/」。',
    '',
  ]
  for (const chapter of CHAPTERS) {
    const list = sortEntries(entries.filter((e) => e.chapter === chapter.name))
    lines.push('## ' + chapter.name, '')
    if (!list.length) {
      lines.push('_（还没有记下什么）_', '')
      continue
    }
    for (const entry of list) {
      lines.push('### ' + entry.title, '')
      if (entry.body) lines.push(entry.body, '')
      lines.push('<!-- d:' + (entry.date || todayKey()) + ' i:' + (Number(entry.importance) || 3) + ' -->', '')
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

const normTitle = (s) => String(s || '').toLowerCase().replace(/[\s，。！？、：；,.!?:;·…—\-"'“”‘’（）()\[\]]+/g, '')

function bigrams(s) {
  const t = normTitle(s)
  const out = new Set()
  if (t.length <= 2) { if (t) out.add(t); return out }
  for (let i = 0; i < t.length - 1; i += 1) out.add(t.slice(i, i + 2))
  return out
}

/** Dice 相似度，用来判断两条记忆是不是同一件事。 */
export function titleSimilarity(a, b) {
  const na = normTitle(a)
  const nb = normTitle(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const A = bigrams(na)
  const B = bigrams(nb)
  if (!A.size || !B.size) return 0
  let hit = 0
  for (const x of A) if (B.has(x)) hit += 1
  return (2 * hit) / (A.size + B.size)
}

/**
 * 把新条目并进旧记忆卡：同章同题（或标题高度相似）视为同一条，更新正文与日期。
 * @returns {{entries: Array, added: number, updated: number}}
 */
export function mergeEntries(existing, incoming, { date = todayKey(), perChapter = 80 } = {}) {
  const base = (existing || []).map((e) => ({ ...e }))
  let added = 0
  let updated = 0
  for (const raw of incoming || []) {
    const chapter = normalizeChapter(raw.chapter)
    const title = clean(raw.title).slice(0, 60)
    if (!title) continue
    const body = clean(raw.body).slice(0, 1200)
    const importance = Math.max(1, Math.min(5, Number(raw.importance) || 3))
    let hit = base.find((e) => e.chapter === chapter && normTitle(e.title) === normTitle(title))
    if (!hit) hit = base.find((e) => e.chapter === chapter && titleSimilarity(e.title, title) >= 0.72)
    if (hit) {
      if (body && (body.length >= Math.min(24, String(hit.body || '').length) || !hit.body)) hit.body = body
      hit.title = String(hit.title || title).trim() || title
      hit.date = String(hit.date || '') > date ? hit.date : date
      hit.importance = Math.max(Number(hit.importance) || 1, importance)
      updated += 1
    } else {
      base.push({ chapter, title, body, date, importance })
      added += 1
    }
  }
  const limited = []
  for (const chapter of CHAPTERS) {
    limited.push(...sortEntries(base.filter((e) => e.chapter === chapter.name)).slice(0, perChapter))
  }
  return { entries: limited, added, updated }
}

export function renderDiary(date, doc) {
  const lines = ['# ' + date, '']
  if (doc.title) lines.push('## ' + doc.title, '')
  lines.push(clean(doc.diary) || '_（这一天没有留下日记）_', '')
  if (Array.isArray(doc.events) && doc.events.length) {
    lines.push('## 时间线', '')
    for (const ev of doc.events) {
      const at = clean(ev.at).slice(0, 12)
      const what = clean(ev.what).slice(0, 240)
      if (what) lines.push('- ' + (at ? '**' + at + '** ' : '') + what)
    }
    lines.push('')
  }
  if (Array.isArray(doc.cards) && doc.cards.length) {
    lines.push('## 今天记下的', '')
    for (const card of doc.cards) {
      const t = clean(card.title)
      if (t) lines.push('- **' + t + '** · ' + normalizeChapter(card.chapter))
    }
    lines.push('')
  }
  lines.push('---', '_由忆库根据当天的原始对话整理；原始对话见「原始对话/' + date + '.md」。_', '')
  return lines.join('\n')
}

export async function ensureVault(dir) {
  const root = path.resolve(String(dir || ''))
  if (!root) throw new Error('档案目录为空')
  await mkdir(path.join(root, DIARY_DIR), { recursive: true })
  await mkdir(path.join(root, RAW_DIR), { recursive: true })
  try { await stat(path.join(root, CARD_FILE)) } catch {
    await writeFile(path.join(root, CARD_FILE), renderMemoryCard([], {}), 'utf8')
  }
  try { await stat(path.join(root, LEDGER_FILE)) } catch {
    await writeFile(path.join(root, LEDGER_FILE), JSON.stringify(defaultLedger(), null, 2), 'utf8')
  }
  return root
}

export function defaultLedger() {
  return { version: 1, createdAt: Date.now(), updatedAt: Date.now(), watermark: 0, days: {} }
}

export async function readLedger(dir) {
  try {
    const json = JSON.parse(await readFile(path.join(dir, LEDGER_FILE), 'utf8'))
    return { ...defaultLedger(), ...json, days: json?.days && typeof json.days === 'object' ? json.days : {} }
  } catch {
    return defaultLedger()
  }
}

export async function writeLedger(dir, ledger) {
  const file = path.join(dir, LEDGER_FILE)
  const tmp = file + '.tmp'
  await writeFile(tmp, JSON.stringify({ ...ledger, updatedAt: Date.now() }, null, 2), 'utf8')
  await rename(tmp, file)
}

export async function writeCard(dir, entries, opts = {}) {
  const file = path.join(dir, CARD_FILE)
  const tmp = file + '.tmp'
  await writeFile(tmp, renderMemoryCard(entries, opts), 'utf8')
  await rename(tmp, file)
}

export async function readCard(dir) {
  try { return parseMemoryCard(await readFile(path.join(dir, CARD_FILE), 'utf8')) } catch { return [] }
}

export async function writeRawDay(dir, date, text) {
  await mkdir(path.join(dir, RAW_DIR), { recursive: true })
  const file = path.join(dir, RAW_DIR, date + '.md')
  const tmp = file + '.tmp'
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, file)
}

export async function writeDiary(dir, date, doc) {
  await mkdir(path.join(dir, DIARY_DIR), { recursive: true })
  const file = path.join(dir, DIARY_DIR, date + '.md')
  const tmp = file + '.tmp'
  await writeFile(tmp, renderDiary(date, doc), 'utf8')
  await rename(tmp, file)
}

export async function readDiary(dir, date) {
  try { return await readFile(path.join(dir, DIARY_DIR, date + '.md'), 'utf8') } catch { return '' }
}

export async function readRaw(dir, date) {
  try { return await readFile(path.join(dir, RAW_DIR, date + '.md'), 'utf8') } catch { return '' }
}

async function listMd(dir) {
  try {
    const names = await readdir(dir)
    return names.filter((n) => n.endsWith('.md')).sort()
  } catch { return [] }
}

/** 日记列表：文件为准，账本补状态。 */
export async function listDiaries(dir, ledger) {
  const names = await listMd(path.join(dir, DIARY_DIR))
  const days = ledger?.days || {}
  const out = []
  for (const name of names) {
    const date = name.replace(/\.md$/, '')
    const file = path.join(dir, DIARY_DIR, name)
    let text = ''
    let chars = 0
    try {
      text = await readFile(file, 'utf8')
      chars = text.length
    } catch { continue }
    const excerpt = text
      .replace(/^#.*$/gm, '')
      .replace(/^##\s*时间线.*$/m, '')
      .replace(/<!--[^>]*-->/g, '')
      .replace(/[*_>#]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 130)
    const meta = days[date] || {}
    out.push({
      date,
      chars,
      excerpt,
      status: meta.status || 'done',
      messages: Number(meta.messages) || 0,
      cardCount: Number(meta.cardCount) || 0,
      processedAt: Number(meta.processedAt) || 0,
      error: meta.error || '',
    })
  }
  return out.sort((a, b) => b.date.localeCompare(a.date))
}

export async function vaultStats(dir, ledger) {
  const entries = await readCard(dir)
  const diaries = await listDiaries(dir, ledger)
  const raws = await listMd(path.join(dir, RAW_DIR))
  let cardChars = 0
  try { cardChars = (await readFile(path.join(dir, CARD_FILE), 'utf8')).length } catch { /* 空 */ }
  return {
    cards: entries.length,
    chapters: CHAPTERS.map((c) => ({ name: c.name, color: c.color, count: entries.filter((e) => e.chapter === c.name).length })),
    days: diaries.length,
    rawDays: raws.length,
    chars: cardChars + diaries.reduce((n, d) => n + d.chars, 0),
    messages: Object.values(ledger?.days || {}).reduce((n, d) => n + (Number(d.messages) || 0), 0),
    lastDiary: diaries[0]?.date || '',
  }
}

const KIND_LABEL = { card: '记忆卡', diary: '日记', raw: '原始对话' }

/** 全文检索：记忆卡 + 日记 + 原始对话。 */
export async function searchArchive(dir, query, { limit = 12, date = '', scope = 'all' } = {}) {
  const q = String(query || '').trim()
  if (!q) return []
  const terms = [...new Set(q.toLowerCase().split(/\s+/).filter(Boolean))]
  const files = []
  if (scope === 'all' || scope === 'card') files.push({ kind: 'card', date: '', file: path.join(dir, CARD_FILE) })
  if (scope === 'all' || scope === 'diary') {
    for (const name of await listMd(path.join(dir, DIARY_DIR))) {
      const d = name.replace(/\.md$/, '')
      if (date && d !== date) continue
      files.push({ kind: 'diary', date: d, file: path.join(dir, DIARY_DIR, name) })
    }
  }
  if (scope === 'all' || scope === 'raw') {
    for (const name of await listMd(path.join(dir, RAW_DIR))) {
      const d = name.replace(/\.md$/, '')
      if (date && d !== date) continue
      files.push({ kind: 'raw', date: d, file: path.join(dir, RAW_DIR, name) })
    }
  }

  const hits = []
  for (const item of files) {
    let text = ''
    try {
      const info = await stat(item.file)
      if (info.size > 8 * 1024 * 1024) continue
      text = await readFile(item.file, 'utf8')
    } catch { continue }
    const lower = text.toLowerCase()
    let first = -1
    let count = 0
    let matched = 0
    for (const term of terms) {
      const at = lower.indexOf(term)
      if (at < 0) continue
      matched += 1
      if (first < 0 || at < first) first = at
      let from = at
      let n = 0
      while (from >= 0 && n < 40) { count += 1; n += 1; from = lower.indexOf(term, from + term.length) }
    }
    if (!matched || first < 0) continue
    const before = text.slice(Math.max(0, first - 80), first)
    const after = text.slice(first, Math.min(text.length, first + 180))
    const snippet = (before + after).replace(/\s+/g, ' ').trim()
    let section = ''
    if (item.kind === 'card') {
      for (const mark of text.matchAll(/^###\s+(.+)$/gm)) {
        if (mark.index > first) break
        section = mark[1].trim()
      }
    }
    const weight = item.kind === 'card' ? 5 : item.kind === 'diary' ? 3 : 1
    hits.push({
      kind: item.kind,
      kindLabel: KIND_LABEL[item.kind],
      date: item.date,
      section,
      score: matched * weight * 10 + count,
      snippet,
    })
  }
  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, Math.max(1, Math.min(40, Number(limit) || 12)))
}
