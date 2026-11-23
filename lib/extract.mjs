import { CHAPTER_NAMES, normalizeChapter, titleSimilarity } from './vault.mjs'

export const SYSTEM = [
  '你是「忆库」的记忆整理师。你读到的是一天里用户和 AI 助手的真实对话。',
  '你的工作不是复述聊天，而是把值得长期记住的东西写进一本能带走的档案。',
  '',
  '原则：',
  '1. 只写对话里确实出现过的事实。不猜测、不补全、不把助手的建议当成用户的选择。',
  '2. 长期有用：身份与处境、正在做的事、稳定的偏好、做过的决定和理由、重要的人、没完成的线索。',
  '3. 不写：工具输出、代码细节、一次性的问答、寒暄、模型自己的推理过程。',
  '4. 用中文短句。称用户为「用户」，称助手为「我」。',
  '5. 记忆卡条目要能独立看懂，不依赖上下文；标题短而具体，正文一到三句。',
  '6. 日记像一个人晚上写的回顾：今天做了什么、卡在哪、情绪和偏好、明天可以接上的线。不要流水账。',
].join('\n')

export const OUTPUT_SHAPE = [
  '{',
  '  "title": "这一天的短标题，不超过 14 个字",',
  '  "diary": "150-400 字的日记，可分 2-4 段",',
  '  "cards": [',
  '    { "chapter": "我是谁|在做的事|偏好与习惯|重要决定|人与关系|待办与线索", "title": "短标题", "body": "一到三句事实", "importance": 1 }',
  '  ],',
  '  "events": [ { "at": "HH:MM", "what": "这一刻发生了什么" } ]',
  '}',
].join('\n')

function existingBlock(existing) {
  const lines = []
  for (const chapter of CHAPTER_NAMES) {
    const titles = (existing || []).filter((e) => e.chapter === chapter).map((e) => e.title).slice(0, 40)
    if (titles.length) lines.push(chapter + '：' + titles.join(' / '))
  }
  return lines.length ? lines.join('\n') : '（还没有任何条目）'
}

export function buildDayPrompt({ date, transcript, existing, part = 1, parts = 1, userName = '' }) {
  const partLine = parts > 1 ? '这是当天对话的第 ' + part + '/' + parts + ' 段，只整理这一段里出现的内容。' : ''
  return [
    '日期：' + date,
    partLine,
    userName ? '用户在这个工作区的称呼：' + userName : '',
    '',
    '【已经记在记忆卡里的标题】（不要重复造新条目；如果今天有更新，沿用同一个标题写，系统会自动合并）',
    existingBlock(existing),
    '',
    '【当天的对话】',
    transcript,
    '',
    '【输出要求】',
    '只输出一个 JSON 对象，不要代码围栏，不要在 JSON 前后写解释。字段如下：',
    OUTPUT_SHAPE,
    '',
    '规则：',
    '- cards 最多 6 条；没有值得长期记的就给空数组 []。',
    '- 每条 card 的 chapter 必须是上面六个之一。',
    '- importance 取 1-5：5 = 身份/长期目标，3 = 一般事实，1 = 小偏好。',
    '- diary 不要复述每句话，写「今天整体发生了什么、用户在意什么、我帮到了哪里、还有什么没完」。',
    '- events 取 2-6 个当天真正关键的时刻，at 用 24 小时制。',
    '- 宁缺毋滥：不确定是否长期有用的，不要写进 cards。',
  ].filter((x) => x !== '').join('\n')
}

export function buildRetryPrompt(basePrompt) {
  return basePrompt + '\n\n【重要】上一次输出无法被 JSON 解析。这次只输出 JSON 对象本身，第一个字符必须是 {，最后一个字符必须是 }。不要 markdown 代码块，不要任何说明文字。'
}

/** 从模型输出里抠出 JSON；容忍代码围栏、前后废话、尾逗号。 */
export function parseModelJson(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim()
  if (!raw) return null
  const candidates = []
  const fenced = raw.match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/i)
  if (fenced) candidates.push(fenced[1].trim())
  candidates.push(raw)
  const first = raw.indexOf('{')
  const last = raw.lastIndexOf('}')
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1))
  for (const candidate of candidates) {
    for (const variant of [candidate, candidate.replace(/,\s*([}\]])/g, '$1')]) {
      try {
        const json = JSON.parse(variant)
        if (json && typeof json === 'object' && !Array.isArray(json)) return json
      } catch { /* 下一个 */ }
    }
  }
  return null
}

const cleanText = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max)

/** 把模型 JSON 归一化成内部结构。 */
export function normalizeDayDoc(json, { date = '' } = {}) {
  if (!json || typeof json !== 'object') return null
  const cards = []
  const seen = new Set()
  for (const raw of Array.isArray(json.cards) ? json.cards : []) {
    if (!raw || typeof raw !== 'object') continue
    const title = cleanText(raw.title, 60)
    if (!title) continue
    const chapter = normalizeChapter(raw.chapter)
    const key = chapter + '|' + title.toLowerCase()
    if (seen.has(key)) continue
    if (cards.some((c) => titleSimilarity(c.title, title) >= 0.86)) continue
    seen.add(key)
    cards.push({
      chapter,
      title,
      body: cleanText(raw.body, 1200),
      importance: Math.max(1, Math.min(5, Number(raw.importance) || 3)),
    })
    if (cards.length >= 8) break
  }
  const events = []
  for (const raw of Array.isArray(json.events) ? json.events : []) {
    if (!raw || typeof raw !== 'object') continue
    const what = cleanText(raw.what, 240)
    if (!what) continue
    events.push({ at: cleanText(raw.at, 12), what })
    if (events.length >= 8) break
  }
  return {
    date,
    title: cleanText(json.title, 40),
    diary: cleanText(json.diary, 4000),
    cards,
    events,
  }
}

export function mergeDayDocs(docs, date) {
  const out = { date, title: '', diary: '', cards: [], events: [] }
  for (const doc of docs || []) {
    if (!doc) continue
    if (!out.title && doc.title) out.title = doc.title
    if (doc.diary) out.diary += (out.diary ? '\n\n' : '') + doc.diary
    out.cards.push(...(doc.cards || []))
    out.events.push(...(doc.events || []))
  }
  out.diary = out.diary.slice(0, 8000)
  const uniq = []
  for (const card of out.cards) {
    const hit = uniq.find((c) => c.chapter === card.chapter && titleSimilarity(c.title, card.title) >= 0.72)
    if (hit) {
      if ((card.body || '').length > (hit.body || '').length) hit.body = card.body
      hit.importance = Math.max(hit.importance, card.importance)
    } else uniq.push(card)
  }
  out.cards = uniq.slice(0, 12)
  out.events = out.events.slice(0, 10).sort((a, b) => String(a.at).localeCompare(String(b.at)))
  return out
}

/** 按总字数把当天消息切成最多 maxChunks 段。 */
export function splitForModel(messages, { maxChars = 14000, maxChunks = 4 } = {}) {
  const list = (messages || []).map((m) => ({ ...m, block: '【' + (m.role === 'user' ? '用户' : '助手') + '】' + String(m.text || '').trim() }))
  const total = list.reduce((n, m) => n + m.block.length + 2, 0)
  if (total <= maxChars) return [list]
  const size = Math.max(5000, Math.min(maxChars, Math.ceil(total / maxChunks)))
  const groups = []
  let cur = []
  let chars = 0
  for (const m of list) {
    if (cur.length && chars + m.block.length > size) {
      groups.push(cur)
      cur = []
      chars = 0
    }
    cur.push(m)
    chars += m.block.length + 2
  }
  if (cur.length) groups.push(cur)
  while (groups.length > maxChunks) {
    const tail = groups.pop()
    groups[groups.length - 1].push(...tail)
  }
  return groups
}

const flatten = (group) => (group || []).map((m) => m.block).join('\n\n')

async function streamText({ llm, provider, model, system, prompt, maxTokens, signal }) {
  if (!llm || typeof llm.stream !== 'function') throw new Error('宿主没有可用的 LLM 服务')
  if (!provider || !model) throw new Error('没有选到可用于整理的模型')
  if (signal?.aborted) throw new Error('已停止')
  let text = ''
  let failure = ''
  const stream = llm.stream({
    provider,
    model,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    temperature: 0.2,
    maxTokens: Number(maxTokens) || 3600,
  })
  for await (const chunk of stream) {
    if (signal?.aborted) throw new Error('已停止')
    if (!chunk) continue
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
    else if (chunk.type === 'finish') {
      const kind = chunk.reason && typeof chunk.reason === 'object' ? chunk.reason.kind : chunk.reason
      if (kind && !['stop', 'end-turn', 'tool-calls', 'length', 'max-tokens'].includes(kind)) failure = '模型没有正常结束（' + kind + '）'
    }
  }
  if (!text.trim() && failure) throw new Error(failure)
  return text
}

/**
 * 整理一天：长对话切块，逐块调用模型，合并结果。
 */
export async function extractDay({ llm, provider, model, date, messages, existing, signal, maxTokens = 3600, onPart }) {
  const parts = splitForModel(messages)
  const docs = []
  for (let i = 0; i < parts.length; i += 1) {
    if (signal?.aborted) throw new Error('已停止')
    if (onPart) onPart(i + 1, parts.length)
    const base = buildDayPrompt({ date, transcript: flatten(parts[i]), existing, part: i + 1, parts: parts.length })
    let text = await streamText({ llm, provider, model, system: SYSTEM, prompt: base, maxTokens, signal })
    let json = parseModelJson(text)
    if (!json) {
      text = await streamText({ llm, provider, model, system: SYSTEM, prompt: buildRetryPrompt(base), maxTokens, signal })
      json = parseModelJson(text)
    }
    if (!json) throw new Error('模型输出不是可解析的 JSON（第 ' + (i + 1) + ' 段）')
    const doc = normalizeDayDoc(json, { date })
    if (!doc || (!doc.diary && doc.cards.length === 0)) throw new Error('模型没有给出日记或记忆条目（第 ' + (i + 1) + ' 段）')
    docs.push(doc)
  }
  return mergeDayDocs(docs, date)
}
