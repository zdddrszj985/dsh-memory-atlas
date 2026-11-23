window.__ModuleLoader__.load({
  id: 'dsh-memory-atlas',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const useState = React.useState
    const useEffect = React.useEffect
    const useMemo = React.useMemo
    const useRef = React.useRef
    const useCallback = React.useCallback

    const API = '/api/memory-atlas'
    const LS_KEY = 'dsh-memory-atlas:session'

    async function api(path, opts) {
      const options = Object.assign({ credentials: 'same-origin' }, opts || {})
      if (options.body && !options.method) options.method = 'POST'
      if (options.body) options.headers = Object.assign({ 'content-type': 'application/json' }, options.headers || {})
      const res = await fetch(API + path, options)
      let json = null
      try { json = await res.json() } catch (e) { json = null }
      if (!json) throw new Error('宿主没有返回 JSON（HTTP ' + res.status + '）')
      if (!json.ok) throw new Error(json.error || ('请求失败 HTTP ' + res.status))
      return json
    }

    function cls() {
      const out = []
      for (let i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i])
      return out.join(' ')
    }

    function clamp(n, a, b) { return Math.max(a, Math.min(b, n)) }

    function shortDate(s) {
      if (!s) return ''
      const p = String(s).split('-')
      return p.length === 3 ? (Number(p[1]) + '月' + Number(p[2]) + '日') : String(s)
    }

    function when(ms) {
      if (!ms) return ''
      const d = new Date(Number(ms))
      if (isNaN(d.getTime())) return ''
      const pad = function (n) { return String(n).padStart(2, '0') }
      return (d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
    }

    const CSS = [
      '.ma-root{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#f6f7f9);color:var(--dsw-alias-label-primary,#1b1c1f);font-size:13px;line-height:1.55;overflow:hidden}',
      '.ma-head{flex:0 0 auto;padding:18px 24px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07));background:var(--dsw-alias-bg-layer-1,#fff)}',
      '.ma-headline{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.ma-logo{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:linear-gradient(135deg,#6d7cf6,#9b6de0);color:#fff;flex:0 0 auto;box-shadow:0 4px 14px rgba(109,124,246,.32)}',
      '.ma-title{font-size:17px;font-weight:650;letter-spacing:.02em}',
      '.ma-sub{color:var(--dsw-alias-label-tertiary,#8a8f98);font-size:12px;max-width:520px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ma-grow{flex:1 1 auto}',
      '.ma-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.ma-input,.ma-select{height:30px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.13));background:var(--dsw-alias-bg-layer-2,#f3f4f6);color:inherit;padding:0 9px;font:inherit;outline:none;min-width:0}',
      '.ma-input:focus,.ma-select:focus{border-color:var(--dsw-alias-brand-primary,#6d7cf6);box-shadow:0 0 0 3px rgba(109,124,246,.13)}',
      '.ma-input::placeholder{color:var(--dsw-alias-label-tertiary,#9aa0a8)}',
      '.ma-search{width:190px;padding-left:28px;background-image:url("data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%2714%27 height=%2714%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%238a8f98%27 stroke-width=%272%27><circle cx=%2711%27 cy=%2711%27 r=%277%27/><path d=%27M20 20l-4-4%27/></svg>");background-repeat:no-repeat;background-position:9px 8px}',
      '.ma-btn{height:30px;padding:0 11px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.13));background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;transition:background .14s,border-color .14s,transform .08s}',
      '.ma-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.045))}',
      '.ma-btn:active{transform:translateY(1px)}',
      '.ma-btn:disabled{opacity:.45;cursor:not-allowed}',
      '.ma-btn.primary{background:var(--dsw-alias-brand-primary,#5f6ee8);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff);font-weight:600}',
      '.ma-btn.primary:hover{filter:brightness(1.06)}',
      '.ma-btn.danger{color:#d9534f;border-color:rgba(217,83,79,.35)}',
      '.ma-btn.ghost{border-color:transparent;background:transparent}',
      '.ma-tabs{flex:0 0 auto;display:flex;gap:4px;padding:8px 24px 0;background:var(--dsw-alias-bg-layer-1,#fff);border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07))}',
      '.ma-tab{position:relative;padding:7px 13px 10px;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#5d626b);font:inherit;font-weight:550;cursor:pointer;border-radius:8px 8px 0 0}',
      '.ma-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04))}',
      '.ma-tab.on{color:var(--dsw-alias-brand-primary,#5f6ee8)}',
      '.ma-tab.on:after{content:"";position:absolute;left:11px;right:11px;bottom:-1px;height:2px;border-radius:2px;background:var(--dsw-alias-brand-primary,#5f6ee8)}',
      '.ma-body{flex:1 1 auto;min-height:0;overflow:auto;padding:16px 24px 28px}',
      '.ma-banner{flex:0 0 auto;margin:10px 24px 0;padding:9px 12px;border-radius:9px;background:rgba(109,124,246,.09);border:1px solid rgba(109,124,246,.18);display:flex;align-items:center;gap:10px;font-size:12px}',
      '.ma-bar{flex:1 1 auto;height:5px;border-radius:3px;background:rgba(109,124,246,.16);overflow:hidden;min-width:60px}',
      '.ma-bar i{display:block;height:100%;background:linear-gradient(90deg,#6d7cf6,#9b6de0);border-radius:3px;transition:width .35s}',
      '.ma-note{padding:10px 12px;border-radius:9px;background:rgba(217,83,79,.09);border:1px solid rgba(217,83,79,.25);color:#c64540;font-size:12px;margin-bottom:12px;white-space:pre-wrap}',
      '.ma-empty{border:1px dashed var(--dsw-alias-border-l2,rgba(0,0,0,.16));border-radius:14px;padding:44px 24px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;background:var(--dsw-alias-bg-layer-1,#fff)}',
      '.ma-empty h3{margin:4px 0 0;font-size:16px}',
      '.ma-empty p{margin:0;color:var(--dsw-alias-label-secondary,#60656e);max-width:460px;font-size:12.5px}',
      '.ma-grid{display:grid;grid-template-columns:206px minmax(0,1fr);gap:18px;align-items:start}',
      '.ma-side{position:sticky;top:0;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07));border-radius:12px;padding:8px;display:flex;flex-direction:column;gap:2px}',
      '.ma-side button{border:0;background:transparent;color:inherit;font:inherit;text-align:left;padding:7px 9px;border-radius:7px;cursor:pointer;display:flex;align-items:center;gap:7px}',
      '.ma-side button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.045))}',
      '.ma-side button.on{background:rgba(109,124,246,.11);color:var(--dsw-alias-brand-primary,#5f6ee8);font-weight:600}',
      '.ma-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto}',
      '.ma-count{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8f98);font-variant-numeric:tabular-nums}',
      '.ma-chap{margin-bottom:20px}',
      '.ma-chap h3{display:flex;align-items:center;gap:7px;margin:0 0 8px;font-size:13px;letter-spacing:.02em}',
      '.ma-chap h3 small{font-weight:400;color:var(--dsw-alias-label-tertiary,#8a8f98);font-size:11px}',
      '.ma-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:9px}',
      '.ma-card{position:relative;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));background:var(--dsw-alias-bg-layer-1,#fff);border-radius:11px;padding:11px 12px 10px;cursor:pointer;transition:border-color .14s,box-shadow .14s,transform .14s;overflow:hidden}',
      '.ma-card:hover{border-color:rgba(109,124,246,.4);box-shadow:0 5px 18px rgba(30,34,60,.08);transform:translateY(-1px)}',
      '.ma-card .k{font-weight:600;font-size:12.5px;margin-bottom:3px;padding-right:46px}',
      '.ma-card .b{color:var(--dsw-alias-label-secondary,#5d626b);font-size:12px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap}',
      '.ma-card .m{display:flex;align-items:center;gap:6px;margin-top:7px;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8a8f98)}',
      '.ma-mark{position:absolute;top:10px;right:10px;font-size:10px;color:var(--dsw-alias-label-tertiary,#9aa0a8);letter-spacing:.08em}',
      '.ma-diaries{display:flex;flex-direction:column;gap:3px}',
      '.ma-diaryrow{border:0;background:transparent;color:inherit;font:inherit;text-align:left;padding:7px 8px;border-radius:7px;cursor:pointer;display:flex;flex-direction:column;gap:1px}',
      '.ma-diaryrow:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.045))}',
      '.ma-diaryrow.on{background:rgba(109,124,246,.11)}',
      '.ma-diaryrow b{font-size:12px}',
      '.ma-diaryrow span{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8a8f98)}',
      '.ma-paper{background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07));border-radius:12px;padding:20px 22px;min-height:320px}',
      '.ma-paper h2{margin:0 0 3px;font-size:16px}',
      '.ma-paper .meta{color:var(--dsw-alias-label-tertiary,#8a8f98);font-size:11.5px;margin-bottom:14px}',
      '.ma-prose p{margin:0 0 9px;white-space:pre-wrap}',
      '.ma-prose h4{margin:15px 0 7px;font-size:13px;color:var(--dsw-alias-brand-primary,#5f6ee8)}',
      '.ma-prose .li{margin:0 0 6px;padding-left:14px;position:relative}',
      '.ma-prose .li:before{content:"·";position:absolute;left:2px;color:var(--dsw-alias-brand-primary,#5f6ee8);font-weight:700}',
      '.ma-prose .q{margin:0 0 8px;padding:6px 10px;border-left:3px solid rgba(109,124,246,.5);background:rgba(109,124,246,.06);border-radius:0 6px 6px 0;white-space:pre-wrap}',
      '.ma-seg{display:inline-flex;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f1f2f4);gap:2px}',
      '.ma-seg button{border:0;background:transparent;color:var(--dsw-alias-label-secondary,#5d626b);font:inherit;font-size:12px;padding:4px 10px;border-radius:6px;cursor:pointer}',
      '.ma-seg button.on{background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;box-shadow:0 1px 4px rgba(0,0,0,.1)}',
      '.ma-hits{display:flex;flex-direction:column;gap:8px;margin-top:12px}',
      '.ma-hit{padding:9px 11px;border-radius:9px;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));cursor:pointer}',
      '.ma-hit:hover{border-color:rgba(109,124,246,.4)}',
      '.ma-hit .h{font-size:11px;color:var(--dsw-alias-brand-primary,#5f6ee8);margin-bottom:3px}',
      '.ma-hit .s{font-size:12px;color:var(--dsw-alias-label-secondary,#5d626b);white-space:pre-wrap}',
      '.ma-field{display:flex;flex-direction:column;gap:5px;margin-bottom:14px;max-width:560px}',
      '.ma-field label{font-size:12px;font-weight:600}',
      '.ma-field .hint{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8a8f98)}',
      '.ma-section{background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07));border-radius:12px;padding:18px 20px;margin-bottom:14px;max-width:820px}',
      '.ma-section h3{margin:0 0 4px;font-size:14px}',
      '.ma-section .desc{color:var(--dsw-alias-label-tertiary,#8a8f98);font-size:11.5px;margin-bottom:14px}',
      '.ma-path{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;background:var(--dsw-alias-bg-layer-2,#f3f4f6);border-radius:6px;padding:6px 8px;word-break:break-all}',
      '.ma-graphwrap{position:relative;height:min(66vh,620px);min-height:380px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07));border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff);overflow:hidden}',
      '.ma-graphwrap:before{content:"";position:absolute;inset:0;background-image:radial-gradient(circle at 1px 1px,rgba(120,125,140,.14) 1px,transparent 0);background-size:22px 22px;pointer-events:none}',
      '.ma-svg{display:block;width:100%;height:100%;cursor:grab;touch-action:none}',
      '.ma-svg.drag{cursor:grabbing}',
      '.ma-node{cursor:pointer}',
      '.ma-tip{position:absolute;z-index:5;max-width:280px;pointer-events:none;background:var(--dsw-alias-bg-layer-3,#1f2230);color:#fff;border-radius:8px;padding:7px 9px;font-size:11.5px;box-shadow:0 8px 24px rgba(0,0,0,.24);line-height:1.45}',
      '.ma-tip b{display:block;font-size:12px;margin-bottom:2px}',
      '.ma-zoom{position:absolute;right:10px;top:10px;display:flex;flex-direction:column;gap:5px;z-index:2}',
      '.ma-zoom button{width:28px;height:28px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;cursor:pointer;font-size:14px;line-height:1}',
      '.ma-legend{position:absolute;left:10px;bottom:8px;display:flex;gap:10px;flex-wrap:wrap;max-width:70%;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8a8f98);z-index:2}',
      '.ma-legend i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:3px}',
      '.ma-overlay{position:fixed;inset:0;z-index:1000;background:rgba(14,16,24,.38);display:flex;align-items:center;justify-content:center;padding:24px}',
      '.ma-modal{width:min(620px,100%);max-height:80vh;overflow:auto;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1b1c1f);border-radius:14px;padding:22px 24px;box-shadow:0 24px 70px rgba(0,0,0,.3)}',
      '.ma-modal h3{margin:6px 0 6px;font-size:17px}',
      '.ma-modal .body{white-space:pre-wrap;font-size:13px;color:var(--dsw-alias-label-secondary,#4f545d);line-height:1.7}',
      '.ma-chip{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:2px 8px;font-size:10.5px;background:rgba(109,124,246,.1);color:var(--dsw-alias-brand-primary,#5f6ee8)}',
      '.ma-stats{display:flex;gap:22px;flex-wrap:wrap;margin:6px 0 14px}',
      '.ma-stats div{display:flex;flex-direction:column}',
      '.ma-stats b{font-size:20px;font-weight:650;font-variant-numeric:tabular-nums}',
      '.ma-stats span{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8a8f98)}',
      '.ma-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:1200;background:var(--dsw-alias-bg-layer-3,#242734);color:#fff;padding:8px 14px;border-radius:9px;font-size:12px;box-shadow:0 10px 30px rgba(0,0,0,.25);max-width:80vw}',
      '@media (max-width:720px){.ma-grid{grid-template-columns:1fr}.ma-side{position:static;flex-direction:row;overflow:auto}.ma-head{padding:14px 16px 10px}.ma-body{padding:14px 16px}.ma-tabs{padding:6px 16px 0}.ma-search{width:140px}}',
    ].join('\n')

    function ensureCss() {
      if (typeof document === 'undefined') return
      if (document.getElementById('dsh-memory-atlas-css')) return
      const tag = document.createElement('style')
      tag.id = 'dsh-memory-atlas-css'
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    function Icon(props) {
      const size = props.size || 18
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('circle', { cx: 12, cy: 12, r: 2.4, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 5, cy: 6.5, r: 2 }),
        h('circle', { cx: 19, cy: 6.5, r: 2 }),
        h('circle', { cx: 5, cy: 17.5, r: 2 }),
        h('circle', { cx: 19, cy: 17.5, r: 2 }),
        h('path', { d: 'M7 7.3l2.8 2.4M17 7.3l-2.8 2.4M7 16.7l2.8-2.4M17 16.7l-2.8-2.4' })
      )
    }

    function Empty(props) {
      return h('div', { className: 'ma-empty' },
        h('div', { style: { width: 46, height: 46, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'rgba(109,124,246,.1)', color: 'var(--dsw-alias-brand-primary,#5f6ee8)' } }, h(Icon, { size: 26 })),
        h('h3', null, props.title || '还没有记忆档案'),
        h('p', null, props.desc || '把某个会话的历史整理成记忆卡和日记。之后压缩了上下文、或者新开会话，输入 /yiku 就能把记忆接回来。'),
        props.children
      )
    }

    function Toast(props) {
      if (!props.text) return null
      return h('div', { className: 'ma-toast' }, props.text)
    }

    function Modal(props) {
      const e = props.entry
      useEffect(function () {
        if (!e) return
        function onKey(ev) { if (ev.key === 'Escape') props.onClose() }
        window.addEventListener('keydown', onKey)
        return function () { window.removeEventListener('keydown', onKey) }
      }, [e])
      if (!e) return null
      return h('div', { className: 'ma-overlay', onMouseDown: function (ev) { if (ev.target === ev.currentTarget) props.onClose() } },
        h('div', { className: 'ma-modal' },
          h('span', { className: 'ma-chip' }, e.chapter || '记忆', e.date ? ' · ' + e.date : ''),
          h('h3', null, e.title || '（无标题）'),
          e.importance ? h('div', { className: 'meta', style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary,#8a8f98)' } }, '重要度 ' + e.importance + '/5') : null,
          h('div', { className: 'body' }, e.body || ''),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 18 } },
            h('button', { className: 'ma-btn', onClick: props.onClose }, '关闭')
          )
        )
      )
    }

    function JobBar(props) {
      const job = props.job
      if (!job || !job.running) return null
      const pct = job.total ? Math.round(((job.index + (job.phase === 'done' ? 1 : 0)) / job.total) * 100) : 0
      return h('div', { className: 'ma-banner' },
        h('span', { style: { fontWeight: 600, whiteSpace: 'nowrap' } }, job.stopped ? '正在停止' : '正在整理'),
        h('span', { style: { color: 'var(--dsw-alias-label-secondary,#5d626b)', whiteSpace: 'nowrap' } }, (job.date || '') + (job.phase ? ' · ' + job.phase : '')),
        h('div', { className: 'ma-bar' }, h('i', { style: { width: clamp(pct, 3, 100) + '%' } })),
        h('span', { style: { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' } }, (job.total ? (Math.min(job.index + 1, job.total) + '/' + job.total) : '') + (job.message ? ' · ' + job.message : '')),
        h('button', { className: 'ma-btn danger', style: { height: 24 }, onClick: props.onStop, disabled: job.stopped }, job.stopped ? '停止中…' : '停止')
      )
    }

    function Graph(props) {
      const data = props.data
      const wrapRef = useRef(null)
      const drag = useRef(null)
      const [t, setT] = useState({ x: 0, y: 0, k: 1 })
      const [dragging, setDragging] = useState(false)
      const [tip, setTip] = useState(null)
      const q = String(props.query || '').trim().toLowerCase()

      const layout = useMemo(function () {
        const W = 1000, H = 720, cx = 500, cy = 300, RX = 240, RY = 175
        const chapters = (data.chapters || []).map(function (c, i) {
          const ang = -Math.PI / 2 + i * Math.PI / 3
          return Object.assign({}, c, { x: cx + Math.cos(ang) * RX, y: cy + Math.sin(ang) * RY, ang: ang })
        })
        const nodes = []
        chapters.forEach(function (c) {
          const list = (c.entries || []).slice(0, 16)
          list.forEach(function (e, i) {
            const ang = c.ang + (i - (list.length - 1) / 2) * 0.26
            const rr = 60 + Math.floor(i / 8) * 24
            nodes.push(Object.assign({}, e, {
              x: c.x + Math.cos(ang) * rr,
              y: c.y + Math.sin(ang) * rr,
              color: c.color,
              chapter: c.name,
            }))
          })
        })
        const ds = (data.diaries || []).slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)) }).slice(-14)
        const diaries = ds.map(function (d, i) {
          return Object.assign({}, d, {
            x: 85 + (ds.length <= 1 ? 415 : i * (830 / (ds.length - 1))),
            y: 640,
          })
        })
        return { W: W, H: H, cx: cx, cy: cy, chapters: chapters, nodes: nodes, diaries: diaries }
      }, [data])

      function zoomBy(factor, cx, cy) {
        const ax = cx === undefined ? 500 : cx
        const ay = cy === undefined ? 300 : cy
        setT(function (prev) {
          const k = clamp(prev.k * factor, 0.5, 2.4)
          const ratio = k / prev.k
          return { k: k, x: ax - (ax - prev.x) * ratio, y: ay - (ay - prev.y) * ratio }
        })
      }

      useEffect(function () {
        const el = wrapRef.current
        if (!el) return
        function onWheel(ev) {
          ev.preventDefault()
          zoomBy(ev.deltaY < 0 ? 1.12 : 0.9)
        }
        el.addEventListener('wheel', onWheel, { passive: false })
        return function () { el.removeEventListener('wheel', onWheel) }
      }, [])

      function hit(e) {
        if (!q) return true
        const hay = (String(e.title || '') + ' ' + String(e.body || '') + ' ' + String(e.chapter || '') + ' ' + String(e.date || '')).toLowerCase()
        return hay.indexOf(q) >= 0
      }

      function showTip(ev, title, body, color) {
        const el = wrapRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        let x = ev.clientX - r.left + 14
        const y = ev.clientY - r.top + 14
        if (x > r.width - 270) x = ev.clientX - r.left - 286
        setTip({ x: Math.max(6, x), y: y, title: title, body: body, color: color })
      }

      function onPointerDown(ev) {
        if (ev.button !== 0) return
        if (ev.target && ev.target.closest && ev.target.closest('.ma-node')) return
        drag.current = { sx: ev.clientX, sy: ev.clientY, x: t.x, y: t.y }
        setDragging(true)
        try { ev.currentTarget.setPointerCapture(ev.pointerId) } catch (e) { /* 忽略 */ }
      }
      function onPointerMove(ev) {
        if (!drag.current) return
        const d = drag.current
        setT(function (prev) { return { x: d.x + (ev.clientX - d.sx), y: d.y + (ev.clientY - d.sy), k: prev.k } })
      }
      function onPointerUp(ev) {
        drag.current = null
        setDragging(false)
        try { ev.currentTarget.releasePointerCapture(ev.pointerId) } catch (e) { /* 忽略 */ }
      }

      const totalCards = (data.entries || []).length
      const totalDays = (data.diaries || []).length

      return h('div', { className: 'ma-graphwrap', ref: wrapRef },
        h('div', { style: { position: 'absolute', left: 13, top: 10, zIndex: 2, pointerEvents: 'none' } },
          h('div', { style: { fontSize: 12, fontWeight: 600 } }, '记忆图谱'),
          h('div', { style: { fontSize: 10.5, color: 'var(--dsw-alias-label-tertiary,#8a8f98)' } }, totalCards + ' 条记忆 · ' + totalDays + ' 天日记' + (q ? ' · 高亮「' + props.query + '」' : ''))
        ),
        h('div', { className: 'ma-zoom' },
          h('button', { title: '放大', onClick: function () { zoomBy(1.18) } }, '+'),
          h('button', { title: '缩小', onClick: function () { zoomBy(1 / 1.18) } }, '−'),
          h('button', { title: '复位', onClick: function () { setT({ x: 0, y: 0, k: 1 }) } }, '⟲')
        ),
        h('svg', {
          className: cls('ma-svg', dragging && 'drag'),
          viewBox: '0 0 1000 720',
          preserveAspectRatio: 'xMidYMid meet',
          onPointerDown: onPointerDown,
          onPointerMove: onPointerMove,
          onPointerUp: onPointerUp,
          onPointerLeave: onPointerUp,
        },
          h('defs', null,
            h('linearGradient', { id: 'ma-core', x1: '0', y1: '0', x2: '1', y2: '1' },
              h('stop', { offset: '0%', stopColor: '#6d7cf6' }),
              h('stop', { offset: '100%', stopColor: '#9b6de0' })
            ),
            h('filter', { id: 'ma-glow', x: '-50%', y: '-50%', width: '200%', height: '200%' },
              h('feGaussianBlur', { stdDeviation: '7', result: 'b' }),
              h('feMerge', null, h('feMergeNode', { in: 'b' }), h('feMergeNode', { in: 'SourceGraphic' }))
            )
          ),
          h('g', { transform: 'translate(' + t.x + ',' + t.y + ') scale(' + t.k + ')' },
            h('rect', { x: -500, y: -360, width: 2000, height: 1440, fill: 'transparent' }),
            layout.chapters.map(function (c) {
              return h('line', { key: 'ce-' + c.name, x1: layout.cx, y1: layout.cy, x2: c.x, y2: c.y, stroke: c.color, strokeWidth: 1.4, opacity: 0.3 })
            }),
            layout.nodes.map(function (e, i) {
              const on = hit(e)
              return h('g', {
                key: 'n-' + i,
                className: 'ma-node',
                opacity: on ? 1 : 0.16,
                onMouseEnter: function (ev) { showTip(ev, e.title || '记忆', (e.date ? e.date + ' · ' : '') + (e.body || ''), e.color) },
                onMouseLeave: function () { setTip(null) },
                onClick: function () { props.onOpenEntry(e) },
              },
                h('line', { x1: c0(e, layout).x, y1: c0(e, layout).y, x2: e.x, y2: e.y, stroke: e.color, strokeWidth: 0.8, opacity: 0.35 }),
                h('circle', { cx: e.x, cy: e.y, r: 4.6 + (Number(e.importance) || 2) * 0.55, fill: e.color, stroke: 'var(--dsw-alias-bg-layer-1,#fff)', strokeWidth: 1.3 }),
                q && on ? h('circle', { cx: e.x, cy: e.y, r: 8 + (Number(e.importance) || 2), fill: 'none', stroke: e.color, strokeWidth: 1.2, opacity: 0.55 }) : null
              )
            }),
            layout.chapters.map(function (c) {
              return h('g', { key: 'c-' + c.name, className: 'ma-node' },
                h('circle', { cx: c.x, cy: c.y, r: 34, fill: c.color, opacity: 0.13 }),
                h('circle', { cx: c.x, cy: c.y, r: 34, fill: 'none', stroke: c.color, strokeWidth: 1.4, opacity: 0.72 }),
                h('text', { x: c.x, y: c.y + 4, textAnchor: 'middle', fontSize: c.name.length > 3 ? 9.5 : 11.5, fontWeight: 600, fill: c.color }, c.name),
                h('text', { x: c.x, y: c.y + 52, textAnchor: 'middle', fontSize: 9.5, fill: 'var(--dsw-alias-label-tertiary,#8a8f98)' }, (c.entries || []).length + ' 条')
              )
            }),
            h('circle', { cx: layout.cx, cy: layout.cy, r: 58, fill: 'url(#ma-core)', opacity: 0.1 }),
            h('circle', { cx: layout.cx, cy: layout.cy, r: 43, fill: 'url(#ma-core)', filter: 'url(#ma-glow)' }),
            h('text', { x: layout.cx, y: layout.cy + 7, textAnchor: 'middle', fontSize: 20, fontWeight: 650, fill: '#fff' }, '我'),
            h('text', { x: layout.cx, y: layout.cy + 61, textAnchor: 'middle', fontSize: 8.5, letterSpacing: '2.6', fill: 'var(--dsw-alias-label-tertiary,#8a8f98)' }, 'MEMORY'),
            totalCards === 0 ? h('text', { x: layout.cx, y: layout.cy + 104, textAnchor: 'middle', fontSize: 11, fill: 'var(--dsw-alias-label-secondary,#5d626b)' }, '还没有记忆，先整理一次') : null,
            h('line', { x1: 55, y1: 640, x2: 945, y2: 640, stroke: 'var(--dsw-alias-border-l2,rgba(0,0,0,.14))', strokeDasharray: '3 5' }),
            h('text', { x: 55, y: 662, fontSize: 9.5, fill: 'var(--dsw-alias-label-tertiary,#8a8f98)' }, '时间河 · 日记'),
            layout.diaries.map(function (d, i) {
              return h('g', { key: 'd-' + d.date, className: 'ma-node', onClick: function () { props.onOpenDiary(d.date) },
                onMouseEnter: function (ev) { showTip(ev, d.date + ' 的日记', (d.messages || 0) + ' 条发言 · ' + (d.cardCount || 0) + ' 条新记忆', '#6d7cf6') },
                onMouseLeave: function () { setTip(null) } },
                h('circle', { cx: d.x, cy: d.y, r: 3.5 + Math.min(Number(d.cardCount) || 0, 9), fill: '#6d7cf6', opacity: 0.35 + Math.min(Number(d.cardCount) || 0, 9) * 0.06, stroke: 'var(--dsw-alias-bg-layer-1,#fff)', strokeWidth: 1 }),
                h('text', { x: d.x, y: d.y + 22, textAnchor: 'middle', fontSize: 8.5, fill: 'var(--dsw-alias-label-tertiary,#8a8f98)' }, String(d.date).slice(5))
              )
            })
          )
        ),
        h('div', { className: 'ma-legend' },
          layout.chapters.map(function (c) {
            return h('span', { key: 'l-' + c.name }, h('i', { style: { background: c.color } }), c.name)
          })
        ),
        tip ? h('div', { className: 'ma-tip', style: { left: tip.x, top: tip.y } },
          h('b', { style: { color: tip.color } }, tip.title),
          h('span', null, String(tip.body || '').slice(0, 160) + (String(tip.body || '').length > 160 ? '…' : ''))
        ) : null
      )
    }

    function centerOf(e, layout) {
      const c = layout.chapters.filter(function (x) { return x.name === e.chapter })[0]
      return c || { x: layout.cx, y: layout.cy }
    }
    const c0 = centerOf

    function CardView(props) {
      const data = props.data
      const [chapter, setChapter] = useState('')
      const [hits, setHits] = useState(null)
      const [searching, setSearching] = useState(false)
      const [err, setErr] = useState('')
      const q = String(props.query || '').trim()
      const lower = q.toLowerCase()
      const chapters = data.chapters || []

      const shown = (data.entries || []).filter(function (e) {
        if (chapter && e.chapter !== chapter) return false
        if (!lower) return true
        return (String(e.title || '') + ' ' + String(e.body || '') + ' ' + String(e.date || '')).toLowerCase().indexOf(lower) >= 0
      })

      async function fullSearch() {
        if (!q) return
        setSearching(true)
        setErr('')
        try {
          const r = await api('/search?sid=' + encodeURIComponent(props.sid) + '&q=' + encodeURIComponent(q) + '&limit=20')
          setHits(r.hits || [])
        } catch (e) { setErr(e.message) } finally { setSearching(false) }
      }

      if (!(data.entries || []).length) {
        return h(Empty, { title: '记忆卡还是空的', desc: '点上面的「开始整理」，把会话按天读一遍，生成记忆卡和日记。整理是逐日进行的，随时可以停，下次接着来。' })
      }

      return h('div', null,
        h('div', { className: 'ma-grid' },
          h('div', { className: 'ma-side' },
            h('button', { className: cls(!chapter && 'on'), onClick: function () { setChapter('') } },
              h('span', null, '全部'), h('span', { className: 'ma-count' }, (data.entries || []).length)
            ),
            chapters.map(function (c) {
              return h('button', { key: c.name, className: cls(chapter === c.name && 'on'), onClick: function () { setChapter(c.name) } },
                h('span', { className: 'ma-dot', style: { background: c.color } }),
                h('span', null, c.name),
                h('span', { className: 'ma-count' }, (c.entries || []).length)
              )
            })
          ),
          h('div', { style: { minWidth: 0 } },
            h('div', { className: 'ma-row', style: { justifyContent: 'space-between', marginBottom: 12 } },
              h('div', { className: 'ma-row' },
                h('b', { style: { fontSize: 14 } }, chapter || '全部记忆'),
                h('span', { style: { color: 'var(--dsw-alias-label-tertiary,#8a8f98)', fontSize: 11.5 } }, shown.length + ' 条' + (q ? ' · 含「' + q + '」' : ''))
              ),
              h('button', { className: 'ma-btn', disabled: !q || searching, onClick: fullSearch }, searching ? '搜索中…' : '在日记和原文里搜')
            ),
            err ? h('div', { className: 'ma-note' }, err) : null,
            shown.length === 0 ? h('div', { style: { padding: '28px 0', color: 'var(--dsw-alias-label-tertiary,#8a8f98)' } }, '没有匹配的记忆条目，可以试试右边的全文搜索。') : null,
            chapters.map(function (c) {
              const list = shown.filter(function (e) { return e.chapter === c.name })
              if (!list.length) return null
              return h('section', { className: 'ma-chap', key: c.name },
                h('h3', null, h('span', { className: 'ma-dot', style: { background: c.color } }), c.name, h('small', null, list.length + ' 条')),
                h('div', { className: 'ma-cards' },
                  list.map(function (e, i) {
                    return h('article', { className: 'ma-card', key: c.name + '-' + i, onClick: function () { props.onOpenEntry(e) } },
                      h('div', { className: 'ma-mark' }, '★★★★★'.slice(0, clamp(Number(e.importance) || 1, 1, 5))),
                      h('div', { className: 'k' }, e.title || '（无标题）'),
                      h('div', { className: 'b' }, e.body || ''),
                      h('div', { className: 'm' }, h('span', null, e.date || ''), e.source === 'auto' ? h('span', null, '· 自动') : null)
                    )
                  })
                )
              )
            }),
            hits ? h('div', { style: { marginTop: 18 } },
              h('div', { className: 'ma-row', style: { justifyContent: 'space-between' } },
                h('b', { style: { fontSize: 13 } }, '全文命中 ' + hits.length + ' 处'),
                h('button', { className: 'ma-btn ghost', onClick: function () { setHits(null) } }, '收起')
              ),
              h('div', { className: 'ma-hits' },
                hits.map(function (hit, i) {
                  return h('div', { className: 'ma-hit', key: 'h' + i, onClick: function () { props.onOpenHit(hit) } },
                    h('div', { className: 'h' }, hit.kindLabel + (hit.date ? ' · ' + hit.date : '') + (hit.section ? ' · ' + hit.section : '')),
                    h('div', { className: 's' }, hit.snippet)
                  )
                })
              )
            ) : null
          )
        )
      )
    }

    function Prose(props) {
      const lines = String(props.text || '').split(/\r?\n/)
      const out = []
      let buf = []
      function flush() {
        if (!buf.length) return
        out.push(h('p', { key: 'p' + out.length }, buf.join('\n')))
        buf = []
      }
      lines.forEach(function (line, i) {
        const s = line.trim()
        if (!s) { flush(); return }
        if (s.indexOf('## ') === 0) { flush(); out.push(h('h4', { key: 'h' + i }, s.slice(3))); return }
        if (s.indexOf('# ') === 0) { flush(); out.push(h('h4', { key: 'h' + i }, s.slice(2))); return }
        if (s.indexOf('- ') === 0 || s.indexOf('* ') === 0) { flush(); out.push(h('div', { className: 'li', key: 'l' + i }, s.slice(2))); return }
        if (s.indexOf('> ') === 0) { flush(); out.push(h('div', { className: 'q', key: 'q' + i }, s.slice(2))); return }
        buf.push(line)
      })
      flush()
      return h('div', { className: 'ma-prose' }, out)
    }

    function DiaryView(props) {
      const data = props.data
      const diaries = data.diaries || []
      const [date, setDate] = useState(diaries[0] ? diaries[0].date : '')
      const [mode, setMode] = useState('diary')
      const [text, setText] = useState('')
      const [loading, setLoading] = useState(false)
      const [err, setErr] = useState('')

      useEffect(function () {
        if (props.focus && props.focus.date) {
          setDate(props.focus.date)
          setMode(props.focus.mode || 'diary')
        }
      }, [props.focus])

      useEffect(function () {
        if (!diaries.length) { setText(''); return }
        if (!date) { setDate(diaries[0].date); return }
        let alive = true
        setLoading(true)
        setErr('')
        const route = mode === 'raw' ? '/raw' : '/diary'
        api(route + '?sid=' + encodeURIComponent(props.sid) + '&date=' + encodeURIComponent(date))
          .then(function (r) { if (alive) setText(r.text || '') })
          .catch(function (e) { if (alive) { setText(''); setErr(e.message) } })
          .finally(function () { if (alive) setLoading(false) })
        return function () { alive = false }
      }, [date, mode, diaries.length, props.sid])

      if (!diaries.length) {
        return h(Empty, { title: '还没有日记', desc: '整理一次之后，每天的对话会存成一篇日记；原始对话也会按天留档，随时可以翻回原话。' })
      }

      const row = diaries.filter(function (d) { return d.date === date })[0] || {}
      return h('div', { className: 'ma-grid' },
        h('div', { className: 'ma-side ma-diaries' },
          diaries.map(function (d) {
            return h('button', { key: d.date, className: cls('ma-diaryrow', d.date === date && 'on'), onClick: function () { setDate(d.date) } },
              h('b', null, shortDate(d.date)),
              h('span', null, (d.messages || 0) + ' 条 · ' + (d.cardCount || 0) + ' 记忆' + (d.status === 'error' ? ' · 失败' : ''))
            )
          })
        ),
        h('div', { className: 'ma-paper' },
          h('div', { className: 'ma-row', style: { justifyContent: 'space-between', marginBottom: 8 } },
            h('div', null,
              h('h2', null, shortDate(date) + ' · ' + (mode === 'raw' ? '原始对话' : '日记')),
              h('div', { className: 'meta' }, (row.messages || 0) + ' 条发言' + (row.chars ? ' · ' + row.chars + ' 字' : '') + (row.status === 'error' ? ' · 上次整理失败：' + (row.error || '') : ''))
            ),
            h('div', { className: 'ma-seg' },
              h('button', { className: cls(mode === 'diary' && 'on'), onClick: function () { setMode('diary') } }, '日记'),
              h('button', { className: cls(mode === 'raw' && 'on'), onClick: function () { setMode('raw') } }, '原始对话')
            )
          ),
          err ? h('div', { className: 'ma-note' }, err) : null,
          loading ? h('div', { style: { color: 'var(--dsw-alias-label-tertiary,#8a8f98)', padding: '18px 0' } }, '读取中…') : h(Prose, { text: text })
        )
      )
    }

    function SettingsView(props) {
      const data = props.data
      const boot = props.boot || {}
      const models = props.models || {}
      const [dir, setDir] = useState(data.dir || '')
      const [follow, setFollow] = useState(!(boot.model && boot.model.provider && boot.model.model))
      const [provider, setProvider] = useState((boot.model && boot.model.provider) || '')
      const [model, setModel] = useState((boot.model && boot.model.model) || '')
      const [maxDays, setMaxDays] = useState(boot.maxDaysPerRun || 20)
      const [recentDays, setRecentDays] = useState(boot.recentDays || 3)
      const [busy, setBusy] = useState('')
      const [err, setErr] = useState('')

      useEffect(function () { setDir(data.dir || '') }, [data.dir])
      useEffect(function () {
        const m = boot.model || {}
        setFollow(!(m.provider && m.model))
        setProvider(m.provider || '')
        setModel(m.model || '')
        setMaxDays(boot.maxDaysPerRun || 20)
        setRecentDays(boot.recentDays || 3)
      }, [boot])

      const providers = models.providers || []
      const current = providers.filter(function (p) { return p.id === provider })[0]
      const defaultText = models.default ? (models.default.provider + ' / ' + models.default.model) : '（宿主没有报告默认模型）'

      async function run(name, fn) {
        setBusy(name)
        setErr('')
        try { await fn() } catch (e) { setErr(e.message) } finally { setBusy('') }
      }

      function saveModel() {
        run('model', async function () {
          const selected = follow ? { provider: '', model: '' } : { provider: provider, model: model }
          if (!follow && (!provider || !model)) throw new Error('请选一个模型，或者勾选跟随默认')
          await props.onSaveConfig({ model: selected })
          props.onToast('模型设置已保存')
        })
      }

      function saveRun() {
        run('run', async function () {
          await props.onSaveConfig({ maxDaysPerRun: Number(maxDays) || 20, recentDays: Number(recentDays) || 3 })
          props.onToast('整理设置已保存')
        })
      }

      return h('div', null,
        err ? h('div', { className: 'ma-note' }, err) : null,
        h('section', { className: 'ma-section' },
          h('h3', null, '档案位置'),
          h('div', { className: 'desc' }, '每个会话绑一个本地文件夹。记忆卡、日记、原始对话都是纯文本，放在你自己的硬盘上，不会上传到任何地方。'),
          data.bound ? h('div', { style: { marginBottom: 12 } },
            h('div', { className: 'ma-path' }, data.dir),
            h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary,#8a8f98)', marginTop: 6 } }, '建立于 ' + when(data.boundAt) + ' · ' + (data.stats ? data.stats.days : 0) + ' 天 · ' + (data.stats ? data.stats.cards : 0) + ' 条记忆')
          ) : null,
          h('div', { className: 'ma-row', style: { marginBottom: 10 } },
            h('input', { className: 'ma-input', style: { flex: '1 1 320px' }, value: dir, placeholder: '绝对路径，例如 E:\\我的记忆\\某个会话', onChange: function (e) { setDir(e.target.value) } }),
            h('button', { className: 'ma-btn', disabled: busy === 'bind', onClick: function () { run('bind', async function () { await props.onBind(dir.trim()) ; props.onToast('已绑定档案') }) } }, '绑定'),
            h('button', { className: 'ma-btn', disabled: busy === 'pick', onClick: function () { run('pick', async function () { await props.onPick() }) } }, '选文件夹…'),
            h('button', { className: 'ma-btn', disabled: busy === 'default', onClick: function () { run('default', async function () { await props.onBind('') ; props.onToast('已建默认档案') }) } }, '用默认位置')
          ),
          h('div', { className: 'ma-row' },
            h('span', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary,#8a8f98)' } }, '默认位置在 ~/Documents/忆库/ 下，按会话标题建子文件夹。'),
            data.bound ? h('button', { className: 'ma-btn ghost danger', disabled: busy === 'unbind', onClick: function () { if (!window.confirm('只解除绑定，文件不会删除。确定吗？')) return; run('unbind', async function () { await props.onUnbind() ; props.onToast('已解除绑定') }) } }, '解除绑定') : null
          )
        ),
        h('section', { className: 'ma-section' },
          h('h3', null, '整理用哪个模型'),
          h('div', { className: 'desc' }, '整理时把每天的对话交给这个模型，产出日记和记忆卡。留空就跟随会话当前的默认模型。'),
          h('div', { className: 'ma-row', style: { marginBottom: 10 } },
            h('label', { className: 'ma-row', style: { gap: 6, cursor: 'pointer' } },
              h('input', { type: 'checkbox', checked: follow, onChange: function (e) { setFollow(e.target.checked) } }),
              h('span', null, '跟随默认：' + defaultText)
            )
          ),
          h('div', { className: 'ma-row', style: { marginBottom: 10 } },
            h('select', { className: 'ma-select', disabled: follow, value: provider, onChange: function (e) { setProvider(e.target.value); setModel('') } },
              h('option', { value: '' }, '选择 provider…'),
              providers.map(function (p) { return h('option', { key: p.id, value: p.id }, p.name || p.id) })
            ),
            h('select', { className: 'ma-select', disabled: follow || !provider, value: model, onChange: function (e) { setModel(e.target.value) } },
              h('option', { value: '' }, '选择模型…'),
              (current ? current.models : []).map(function (m) { return h('option', { key: m.id, value: m.id }, m.name || m.id) })
            ),
            h('button', { className: 'ma-btn primary', disabled: busy === 'model', onClick: saveModel }, busy === 'model' ? '保存中…' : '保存')
          ),
          models.error ? h('div', { style: { fontSize: 11.5, color: '#c64540' } }, '模型列表读取失败：' + models.error) : null
        ),
        h('section', { className: 'ma-section' },
          h('h3', null, '整理节奏'),
          h('div', { className: 'desc' }, '每次最多整理多少天（从最早的未整理日开始）。整理完可以再点一次继续。'),
          h('div', { className: 'ma-row' },
            h('label', { style: { fontSize: 12 } }, '每次最多 ',
              h('input', { className: 'ma-input', type: 'number', min: 1, max: 100, style: { width: 66, margin: '0 5px' }, value: maxDays, onChange: function (e) { setMaxDays(e.target.value) } }),
              ' 天'
            ),
            h('label', { style: { fontSize: 12, marginLeft: 16 } }, '/yiku 带回最近 ',
              h('input', { className: 'ma-input', type: 'number', min: 1, max: 14, style: { width: 56, margin: '0 5px' }, value: recentDays, onChange: function (e) { setRecentDays(e.target.value) } }),
              ' 天'
            ),
            h('button', { className: 'ma-btn', disabled: busy === 'run', onClick: saveRun }, '保存')
          )
        ),
        h('section', { className: 'ma-section' },
          h('h3', null, '维护'),
          h('div', { className: 'desc' }, '重新整理会覆盖已经整理过的日子，一般只在换了模型、或者想重做时用。'),
          h('div', { className: 'ma-row' },
            h('button', { className: 'ma-btn danger', disabled: !data.bound || props.jobRunning, onClick: function () { if (window.confirm('重新整理全部有日记的日子？记忆卡里的条目会被更新。')) props.onForce() } }, '重新整理全部'),
            h('button', { className: 'ma-btn', onClick: props.onRefresh }, '刷新档案')
          ),
          h('div', { style: { marginTop: 14, fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary,#8a8f98)' } },
            '配置：', h('span', { className: 'ma-path', style: { display: 'inline-block' } }, boot.configPath || '~/.dsh/memory-atlas/config.json')
          )
        ),
        h('section', { className: 'ma-section' },
          h('h3', null, '怎么用'),
          h('div', { className: 'desc', style: { marginBottom: 8 } }, '整理完之后：'),
          h('div', { className: 'ma-prose' },
            h('div', { className: 'li' }, '在任意会话输入 /yiku，助手会先读记忆卡和最近几天的日记，再回你的话。'),
            h('div', { className: 'li' }, '问旧事时，助手可以用 atlas_search 搜记忆卡、日记和原始对话，不必凭印象编。'),
            h('div', { className: 'li' }, '这个面板可以看到记忆图谱、按天日记和原始对话。')
          )
        )
      )
    }

    function App() {
      ensureCss()
      const [boot, setBoot] = useState(null)
      const [sessions, setSessions] = useState([])
      const [sid, setSid] = useState(function () { try { return localStorage.getItem(LS_KEY) || '' } catch (e) { return '' } })
      const [data, setData] = useState(null)
      const [tab, setTab] = useState('graph')
      const [query, setQuery] = useState('')
      const [job, setJob] = useState(null)
      const [models, setModels] = useState(null)
      const [error, setError] = useState('')
      const [toast, setToast] = useState('')
      const [busy, setBusy] = useState('')
      const [entry, setEntry] = useState(null)
      const [focus, setFocus] = useState(null)

      const loadSessions = useCallback(async function () {
        try { const r = await api('/sessions'); setSessions(r.sessions || []) } catch (e) { /* 列表旧着也能用 */ }
      }, [])

      const reload = useCallback(async function (id) {
        const target = id || sid
        if (!target) return
        const d = await api('/archive?sid=' + encodeURIComponent(target))
        setData(d)
        setJob(d.job || null)
      }, [sid])

      useEffect(function () {
        let alive = true
        api('/status').then(function (r) { if (alive) setBoot(r) }).catch(function (e) { if (alive) setError(e.message) })
        api('/models').then(function (r) { if (alive) setModels(r) }).catch(function () { if (alive) setModels({ providers: [] }) })
        api('/sessions').then(function (r) {
          if (!alive) return
          const rows = r.sessions || []
          setSessions(rows)
          setSid(function (cur) {
            const found = rows.filter(function (s) { return s.id === cur })[0]
            return found ? cur : (rows[0] ? rows[0].id : '')
          })
        }).catch(function (e) { if (alive) setError(e.message) })
        return function () { alive = false }
      }, [])

      useEffect(function () {
        if (!sid) return
        try { localStorage.setItem(LS_KEY, sid) } catch (e) { /* 隐私模式 */ }
        let alive = true
        setData(null)
        api('/archive?sid=' + encodeURIComponent(sid)).then(function (d) {
          if (!alive) return
          setData(d)
          setJob(d.job || null)
        }).catch(function (e) { if (alive) setError(e.message) })
        return function () { alive = false }
      }, [sid])

      useEffect(function () {
        if (!job || !job.running) return
        const timer = setInterval(function () {
          api('/job').then(function (r) {
            setJob(r.job)
            if (!r.job.running) {
              clearInterval(timer)
              reload()
              loadSessions()
              setToast(r.job.error ? ('整理结束：' + r.job.error) : ('整理完成：新增 ' + (r.job.added || 0) + ' 条，更新 ' + (r.job.updated || 0) + ' 条'))
            }
          }).catch(function () { /* 下次再试 */ })
        }, 1200)
        return function () { clearInterval(timer) }
      }, [job && job.running, sid, reload, loadSessions])

      useEffect(function () {
        if (!toast) return
        const t = setTimeout(function () { setToast('') }, 2800)
        return function () { clearTimeout(t) }
      }, [toast])

      async function doBind(dir) {
        const d = await api('/bind', { body: JSON.stringify({ sessionId: sid, dir: dir }) })
        setData(d)
        setJob(d.job || null)
        await loadSessions()
        return d
      }

      async function doPick() {
        const r = await api('/pickdir', { method: 'POST', body: '{}' })
        if (r.dir) { await doBind(r.dir); setToast('已绑定档案') }
      }

      async function saveConfig(patch) {
        const r = await api('/config', { body: JSON.stringify(patch) })
        setBoot(function (prev) { return Object.assign({}, prev || {}, r.config) })
        return r
      }

      async function start(force) {
        setBusy('start')
        setError('')
        try {
          if (!data || !data.bound) await doBind('')
          const r = await api('/distill', { body: JSON.stringify({ sessionId: sid, force: Boolean(force) }) })
          setJob(r.job)
          setTab('graph')
          setToast('开始整理，逐日进行，可以随时停')
        } catch (e) { setError(e.message) } finally { setBusy('') }
      }

      async function stop() {
        try { const r = await api('/stop', { method: 'POST', body: '{}' }); setJob(r.job); setToast('正在停止…') } catch (e) { setError(e.message) }
      }

      function openHit(hit) {
        if (hit.kind === 'card') {
          const found = (data.entries || []).filter(function (e) { return e.title === hit.section })[0]
          if (found) { setEntry(found); return }
          setQuery(hit.section || ''); setTab('card'); return
        }
        setTab('diary')
        setFocus({ date: hit.date, mode: hit.kind === 'raw' ? 'raw' : 'diary', n: Date.now() })
      }

      const currentSession = (data && data.session) || sessions.filter(function (s) { return s.id === sid })[0] || {}
      const running = Boolean(job && job.running)
      const counts = data && data.stats ? data.stats : null
      const tabs = [
        { id: 'graph', label: '图谱' },
        { id: 'card', label: '记忆卡', count: counts ? counts.cards : 0 },
        { id: 'diary', label: '日记', count: counts ? counts.days : 0 },
        { id: 'settings', label: '设置' },
      ]

      let body = null
      if (!sid) {
        body = h(Empty, { title: '没有找到会话', desc: '这个 DSH 里还没有可整理的会话，先去聊几句再回来。' })
      } else if (tab === 'settings') {
        body = h(SettingsView, {
          boot: boot, data: data || { bound: false }, models: models, jobRunning: running,
          onBind: doBind, onPick: doPick,
          onUnbind: async function () { const r = await api('/unbind', { body: JSON.stringify({ sessionId: sid }) }); setData({ ok: true, bound: false, session: currentSession }); await loadSessions(); return r },
          onSaveConfig: saveConfig, onRefresh: function () { reload().then(function () { setToast('已刷新') }).catch(function (e) { setError(e.message) }) },
          onForce: function () { start(true) }, onToast: setToast,
        })
      } else if (!data) {
        body = h('div', { style: { padding: 40, color: 'var(--dsw-alias-label-tertiary,#8a8f98)' } }, '读取档案中…')
      } else if (!data.bound) {
        body = h(Empty, {
          title: '给这个会话建一份记忆',
          desc: '会把历史对话按天整理成记忆卡和日记，原始对话也按天留档。全部存在本地，整理过程可以随时停。',
        }, h('div', { className: 'ma-row', style: { marginTop: 8 } },
          h('button', { className: 'ma-btn primary', disabled: busy === 'start', onClick: function () { start(false) } }, busy === 'start' ? '准备中…' : '用默认位置开始'),
          h('button', { className: 'ma-btn', disabled: busy === 'pick', onClick: function () { doPick().catch(function (e) { setError(e.message) }) } }, '选一个文件夹…')
        ))
      } else if (tab === 'graph') {
        body = h(Graph, {
          data: data, query: query,
          onOpenEntry: setEntry,
          onOpenDiary: function (date) { setTab('diary'); setFocus({ date: date, mode: 'diary', n: Date.now() }) },
        })
      } else if (tab === 'card') {
        body = h(CardView, { data: data, sid: sid, query: query, onOpenEntry: setEntry, onOpenHit: openHit })
      } else if (tab === 'diary') {
        body = h(DiaryView, { key: sid, data: data, sid: sid, focus: focus })
      }

      return h('div', { className: 'ma-root' },
        h('header', { className: 'ma-head' },
          h('div', { className: 'ma-headline' },
            h('div', { className: 'ma-logo' }, h(Icon, { size: 19 })),
            h('div', { style: { minWidth: 0 } },
              h('div', { className: 'ma-title' }, '忆库'),
              h('div', { className: 'ma-sub' }, (currentSession.title || '选择一个会话') + (data && data.bound ? ' · ' + data.dir : ' · 还没有档案'))
            ),
            h('div', { className: 'ma-grow' }),
            h('input', { className: 'ma-input ma-search', value: query, placeholder: '搜记忆…', onChange: function (e) { setQuery(e.target.value) } }),
            h('select', { className: 'ma-select', style: { maxWidth: 230 }, value: sid, onChange: function (e) { setSid(e.target.value) } },
              sessions.map(function (s) {
                return h('option', { key: s.id, value: s.id }, (s.archive ? '● ' : '') + (s.title || s.id))
              })
            ),
            h('button', { className: 'ma-btn primary', disabled: running || busy === 'start' || !sid, onClick: function () { start(false) } }, running ? '整理中…' : (data && data.bound ? '开始整理' : '建档整理')),
            h('button', { className: 'ma-btn', title: '刷新', onClick: function () { loadSessions(); reload().catch(function (e) { setError(e.message) }) } }, '⟳')
          )
        ),
        h('nav', { className: 'ma-tabs' },
          tabs.map(function (t) {
            return h('button', { key: t.id, className: cls('ma-tab', tab === t.id && 'on'), onClick: function () { setTab(t.id) } },
              t.label,
              t.count ? h('span', { style: { marginLeft: 5, fontSize: 10.5, opacity: .75 } }, t.count) : null
            )
          })
        ),
        running ? h(JobBar, { job: job, onStop: stop }) : null,
        h('main', { className: 'ma-body' },
          error ? h('div', { className: 'ma-note', onClick: function () { setError('') }, style: { cursor: 'pointer' } }, error + '（点一下关掉）') : null,
          body
        ),
        h(Modal, { entry: entry, onClose: function () { setEntry(null) } }),
        h(Toast, { text: toast })
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ensureCss()
        const slots = ctx.slots || (typeof ctx.get === 'function' ? ctx.get('slots') : null)
        if (!slots) return
        slots.inject('sidebar.panellist', function () {
          return slots.register({ name: 'sidebar.panellist', id: 'memory-atlas', order: 20, label: function () { return '忆库' } }, Icon)
        })
        slots.inject('main', function () {
          return slots.register({ name: 'main', key: 'memory-atlas' }, App)
        })
      },
    }
  },
})
