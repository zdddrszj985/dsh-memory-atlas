import { collectVoice, groupByDay, readSessionEvents, renderMessages } from './transcript.mjs'
import { extractDay } from './extract.mjs'
import { mergeEntries, readCard, readLedger, writeCard, writeDiary, writeLedger, writeRawDay } from './vault.mjs'

const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

function rawDoc(session, date, messages) {
  return [
    '# ' + date + ' 原始对话',
    '',
    '> 会话：' + (session?.title || session?.id || '未知') ,
    '> 只保留真人发言与助手正文；工具调用、推理和注入上下文已滤除。',
    '',
    renderMessages(messages),
    '',
  ].join('\n')
}

/**
 * 提炼任务：一次只跑一个，逐天落盘，可停止、可续跑。
 */
export function createRunner({ getLlm, getDefaultModel }) {
  let job = null
  let controller = null

  const snapshot = () => (job ? { ...job, log: job.log.slice(-30) } : null)

  function log(text) {
    if (!job) return
    job.log.push({ at: stamp(), text: String(text || '') })
    if (job.log.length > 80) job.log.splice(0, job.log.length - 80)
    job.message = String(text || '')
  }

  async function run({ session, dir, dates, force = false, maxDays = 20, provider, model }) {
    if (job?.running) throw new Error('已经有一个整理任务在跑')
    if (!session?.file) throw new Error('找不到这个会话的原始日志')
    if (!dir) throw new Error('这个会话还没有绑定档案')

    controller = new AbortController()
    job = {
      running: true,
      ok: null,
      error: '',
      stopped: false,
      sessionId: session.id,
      dir,
      total: 0,
      index: 0,
      date: '',
      phase: '读取',
      message: '正在读取会话…',
      added: 0,
      updated: 0,
      startedAt: Date.now(),
      finishedAt: 0,
      log: [],
    }

    try {
      log('读取会话日志…')
      const events = await readSessionEvents(session.file)
      const days = groupByDay(collectVoice(events))
      const ledger = await readLedger(dir)
      let todo = days.filter((d) => d.messages.length > 0)
      if (Array.isArray(dates) && dates.length) {
        const want = new Set(dates.map(String))
        todo = todo.filter((d) => want.has(d.date))
      }
      if (!force) todo = todo.filter((d) => ledger.days[d.date]?.status !== 'done')
      todo.sort((a, b) => a.date.localeCompare(b.date))
      const limit = Math.max(1, Math.min(100, Number(maxDays) || 20))
      const skipped = Math.max(0, todo.length - limit)
      todo = todo.slice(0, limit)
      job.total = todo.length
      if (!todo.length) {
        job.running = false
        job.ok = true
        job.finishedAt = Date.now()
        log('没有需要整理的新内容')
        return snapshot()
      }
      log('共 ' + todo.length + ' 天待整理' + (skipped ? '，另有 ' + skipped + ' 天留到下次' : ''))
      const choice = provider && model ? { provider, model } : (typeof getDefaultModel === 'function' ? getDefaultModel() : null)
      if (!choice?.provider || !choice?.model) throw new Error('没有可用的模型：先去「忆库 → 设置」里选一个')
      job.model = choice.provider + '/' + choice.model

      let failStreak = 0
      for (const day of todo) {
        if (controller.signal.aborted) { job.stopped = true; break }
        job.date = day.date
        job.phase = '存档'
        job.index += 1
        log('第 ' + job.index + '/' + job.total + ' 天 · ' + day.date + '：写入原始对话')
        await writeRawDay(dir, day.date, rawDoc(session, day.date, day.messages))
        ledger.days[day.date] = {
          ...(ledger.days[day.date] || {}),
          status: 'processing',
          messages: day.messages.length,
          chars: day.chars,
          startedAt: Date.now(),
        }
        await writeLedger(dir, ledger)

        try {
          job.phase = '整理'
          const existing = await readCard(dir)
          log('第 ' + job.index + '/' + job.total + ' 天 · ' + day.date + '：请模型整理（' + day.messages.length + ' 条 / ' + day.chars + ' 字）')
          const doc = await extractDay({
            llm: getLlm(),
            provider: choice.provider,
            model: choice.model,
            date: day.date,
            messages: day.messages,
            existing,
            signal: controller.signal,
            onPart: (i, n) => { if (n > 1) log('长对话分 ' + n + ' 段，正在整理第 ' + i + ' 段') },
          })
          const merged = mergeEntries(existing, doc.cards, { date: day.date })
          job.phase = '落盘'
          await writeCard(dir, merged.entries, { updatedAt: Date.now() })
          await writeDiary(dir, day.date, doc)
          ledger.days[day.date] = {
            status: 'done',
            processedAt: Date.now(),
            messages: day.messages.length,
            chars: day.chars,
            cardCount: doc.cards.length,
            added: merged.added,
            updated: merged.updated,
            title: doc.title || '',
            error: '',
          }
          ledger.watermark = Math.max(Number(ledger.watermark) || 0, Math.max(...day.messages.map((m) => Number(m.time) || 0)))
          await writeLedger(dir, ledger)
          job.added += merged.added
          job.updated += merged.updated
          failStreak = 0
          log('第 ' + job.index + '/' + job.total + ' 天 · ' + day.date + '：完成，新增 ' + merged.added + ' 条，更新 ' + merged.updated + ' 条')
        } catch (err) {
          if (controller.signal.aborted) {
            ledger.days[day.date] = { ...(ledger.days[day.date] || {}), status: 'stopped', error: '已停止' }
            await writeLedger(dir, ledger)
            job.stopped = true
            break
          }
          failStreak += 1
          const message = String(err?.message ?? err)
          ledger.days[day.date] = { ...(ledger.days[day.date] || {}), status: 'error', error: message, finishedAt: Date.now() }
          await writeLedger(dir, ledger)
          log('第 ' + job.index + '/' + job.total + ' 天 · ' + day.date + '：失败 — ' + message)
          if (failStreak >= 2) throw new Error('连续两天整理失败：' + message)
        }
      }
      job.running = false
      job.ok = !job.stopped
      job.finishedAt = Date.now()
      if (job.stopped) log('已停止。已经落盘的部分都在，下次会从这里继续。')
      else if (skipped) log('这一轮完成；还有 ' + skipped + ' 天更早的内容，再点一次「继续整理」就会接着补。')
      else log('全部完成。')
    } catch (err) {
      job.running = false
      job.ok = false
      job.error = String(err?.message ?? err)
      job.finishedAt = Date.now()
      log('任务结束：' + job.error)
    }
    return snapshot()
  }

  function stop() {
    if (!job?.running) return false
    controller?.abort()
    job.stopped = true
    job.message = '正在停止…'
    return true
  }

  return { run, stop, status: snapshot, isRunning: () => Boolean(job?.running) }
}
