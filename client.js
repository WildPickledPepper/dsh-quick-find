/* dsh-quick-find — client half.
 *
 * Ctrl+F (Cmd+F) inside an open conversation opens a find bar that searches
 * twice:
 *   1. the rendered messages (instant, highlighted via CSS Custom Highlight API)
 *   2. the whole session log on the host (GET /session-find/search), so turns
 *      that Harness has not mounted yet are still searchable
 *
 * Rendered hits jump with Enter / Shift+Enter; history hits are listed with a
 * snippet and jump when the text is on screen (window.find), otherwise they
 * tell you to scroll the older turns in first.
 */
window.__ModuleLoader__.load({
  id: 'dsh-quick-find',
  factory: () => {
    const HL_ALL = 'dsh-quick-find'
    const HL_ACTIVE = 'dsh-quick-find-active'
    const BAR_ID = 'dsh-find-bar'
    const STYLE_ID = 'dsh-find-style'

    let bar = null
    let input = null
    let counter = null
    let historyCount = null
    let results = null
    let matches = []
    let active = -1
    let timer = null
    let historyTimer = null
    let lastQuery = ''
    let historySeq = 0

    function injectStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent =
        '::highlight(' + HL_ALL + '){background-color:rgba(255,214,10,.45);color:inherit;}' +
        '::highlight(' + HL_ACTIVE + '){background-color:rgba(255,140,0,.95);color:#1d1d1f;}' +
        '#' + BAR_ID + ' .qfr-item:hover{background:rgba(120,120,128,.12);}'
      document.head.appendChild(style)
    }

    function regionCandidates() {
      const list = []
      for (const sel of ['[data-conversation-region]', '[data-chat-flow]', '[data-chat-turn]', 'main']) {
        const el = document.querySelector(sel)
        if (!el) continue
        const region = el.closest('[data-conversation-region]') || el
        if (list.indexOf(region) === -1) list.push(region)
      }
      if (list.indexOf(document.body) === -1) list.push(document.body)
      return list
    }

    function currentSessionId() {
      const el = document.querySelector('[data-conversation-session]')
      return el ? el.getAttribute('data-conversation-session') || '' : ''
    }

    function scan(root, q, out) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const value = node.nodeValue
          if (!value || !value.trim()) return NodeFilter.FILTER_REJECT
          const el = node.parentElement
          if (!el) return NodeFilter.FILTER_REJECT
          const tag = el.tagName
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'INPUT') return NodeFilter.FILTER_REJECT
          if (el.closest('#' + BAR_ID)) return NodeFilter.FILTER_REJECT
          return NodeFilter.FILTER_ACCEPT
        },
      })
      let node
      let visited = 0
      while ((node = walker.nextNode()) && visited++ < 30000 && out.length < 500) {
        const text = node.nodeValue.toLowerCase()
        let idx = text.indexOf(q)
        while (idx !== -1 && out.length < 500) {
          try {
            const range = document.createRange()
            range.setStart(node, idx)
            range.setEnd(node, idx + q.length)
            out.push({ range, node })
          } catch (_) { /* node changed under us */ }
          idx = text.indexOf(q, idx + q.length)
        }
      }
      return out
    }

    function collect(query) {
      matches = []
      active = -1
      const q = String(query || '').trim().toLowerCase()
      lastQuery = q
      if (!q) return
      for (const root of regionCandidates()) {
        const out = scan(root, q, [])
        if (out.length) { matches = out; return }
      }
    }

    function clearHighlights() {
      try {
        if (window.CSS && window.CSS.highlights) {
          window.CSS.highlights.delete(HL_ALL)
          window.CSS.highlights.delete(HL_ACTIVE)
        }
      } catch (_) { /* ignore */ }
    }

    function paint() {
      clearHighlights()
      if (!matches.length) return
      const api = window.CSS && window.CSS.highlights
      const HighlightCtor = window.Highlight
      if (!api || typeof HighlightCtor !== 'function') return
      try {
        api.set(HL_ALL, new HighlightCtor(...matches.map((m) => m.range)))
        if (active >= 0 && active < matches.length) api.set(HL_ACTIVE, new HighlightCtor(matches[active].range))
      } catch (_) { /* ignore */ }
    }

    function renderCounter() {
      if (!counter) return
      if (!matches.length) counter.textContent = lastQuery ? '页内 0' : ''
      else counter.textContent = '页内 ' + (active + 1) + '/' + matches.length
    }

    function focusActive() {
      renderCounter()
      paint()
      if (active < 0 || active >= matches.length) return
      const node = matches[active].node
      const el = (node && node.parentElement) || null
      if (!el) return
      try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }) }
      catch (_) { try { el.scrollIntoView() } catch (_2) { /* ignore */ } }
    }

    function search(value, keepIndex) {
      collect(value)
      if (!keepIndex || active < 0 || active >= matches.length) active = matches.length ? 0 : -1
      focusActive()
    }

    function step(delta) {
      if (!matches.length) { renderCounter(); return }
      active = (active + delta + matches.length) % matches.length
      focusActive()
    }

    /* ---------- history (session log) ---------- */

    function jumpToHistory(item) {
      const probe = String(item.snippet || '').replace(/^…/, '').replace(/…$/, '').slice(0, 24)
      let found = false
      try { found = typeof window.find === 'function' ? window.find(probe, false, false, true) : false } catch (_) { found = false }
      if (!found) {
        window.alert(
          '这条消息还没有渲染到页面上（seq ' + item.seq + '，' + item.role + '）。\n' +
          '先把这段历史向上滚动加载出来，再点一次这条结果。'
        )
      }
    }

    function renderHistory(data) {
      if (!results) return
      results.textContent = ''
      const list = (data && data.matches) || []
      if (historyCount) historyCount.textContent = '历史 ' + ((data && data.total) || 0)
      if (!list.length) return
      for (const item of list) {
        const row = document.createElement('div')
        row.className = 'qfr-item'
        row.style.cssText = 'padding:4px 6px;border-radius:6px;cursor:pointer;display:flex;gap:6px;align-items:baseline'
        const tag = document.createElement('span')
        tag.textContent = item.role === 'user' ? '我' : (item.role === 'assistant' ? 'AI' : '工具')
        tag.style.cssText = 'flex:0 0 auto;font-size:11px;opacity:.55;min-width:26px'
        const snip = document.createElement('span')
        snip.textContent = item.snippet
        snip.style.cssText = 'flex:1 1 auto;font-size:12px;opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
        row.appendChild(tag)
        row.appendChild(snip)
        row.addEventListener('click', () => jumpToHistory(item))
        results.appendChild(row)
      }
    }

    function searchHistory(query) {
      const q = String(query || '').trim()
      if (q.length < 2) { renderHistory(null); return }
      const seq = ++historySeq
      const sid = currentSessionId()
      const url = '/session-find/search?q=' + encodeURIComponent(q) + '&limit=30' + (sid ? '&session=' + encodeURIComponent(sid) : '')
      fetch(url, { cache: 'no-store' })
        .then((r) => r.json())
        .then((data) => { if (seq === historySeq) renderHistory(data) })
        .catch(() => { if (seq === historySeq && historyCount) historyCount.textContent = '历史 ?' })
    }

    function close() {
      clearHighlights()
      if (timer) { clearTimeout(timer); timer = null }
      if (historyTimer) { clearTimeout(historyTimer); historyTimer = null }
      if (bar && bar.parentNode) bar.parentNode.removeChild(bar)
      bar = null
      input = null
      counter = null
      historyCount = null
      results = null
      matches = []
      active = -1
      lastQuery = ''
    }

    function styleButton(btn) {
      btn.type = 'button'
      btn.style.cssText = [
        'all:unset',
        'cursor:pointer',
        'padding:2px 7px',
        'border-radius:5px',
        'font-size:12px',
        'line-height:18px',
        'color:var(--dsw-alias-label-secondary,#666)',
      ].join(';')
      btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(120,120,128,0.14)' })
      btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent' })
      return btn
    }

    function open() {
      injectStyles()
      if (bar) { if (input) input.focus(); return }

      bar = document.createElement('div')
      bar.id = BAR_ID
      bar.style.cssText = [
        'position:fixed',
        'top:64px',
        'right:24px',
        'width:min(560px, calc(100vw - 48px))',
        'z-index:2147483000',
        'display:flex',
        'flex-direction:column',
        'gap:4px',
        'padding:6px 8px',
        'border-radius:10px',
        'background:var(--dsw-alias-bg-layer-1,#fff)',
        'box-shadow:0 8px 28px rgba(0,0,0,.22)',
        'border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12))',
        'font:13px/1.4 system-ui,sans-serif',
      ].join(';')

      const top = document.createElement('div')
      top.style.cssText = 'display:flex;align-items:center;gap:6px'

      input = document.createElement('input')
      input.type = 'text'
      input.placeholder = '在本会话中查找（含未渲染的历史）…'
      input.style.cssText = [
        'all:unset',
        'flex:1 1 auto',
        'padding:3px 6px',
        'border-radius:6px',
        'background:var(--dsw-alias-interactive-bg-hover,rgba(120,120,128,.10))',
        'color:var(--dsw-alias-label-primary,#1d1d1f)',
      ].join(';')

      counter = document.createElement('span')
      counter.style.cssText = 'flex:0 0 auto;min-width:56px;text-align:center;font-size:12px;opacity:.7'
      counter.textContent = ''

      historyCount = document.createElement('span')
      historyCount.style.cssText = 'flex:0 0 auto;min-width:52px;text-align:center;font-size:12px;opacity:.7'
      historyCount.textContent = ''

      const prev = styleButton(document.createElement('button'))
      prev.textContent = '↑'
      prev.title = '上一个 (Shift+Enter)'
      prev.addEventListener('click', () => step(-1))

      const next = styleButton(document.createElement('button'))
      next.textContent = '↓'
      next.title = '下一个 (Enter)'
      next.addEventListener('click', () => step(1))

      const closeBtn = styleButton(document.createElement('button'))
      closeBtn.textContent = '✕'
      closeBtn.title = '关闭 (Esc)'
      closeBtn.addEventListener('click', close)

      input.addEventListener('input', () => {
        const value = input.value
        if (timer) clearTimeout(timer)
        if (historyTimer) clearTimeout(historyTimer)
        timer = setTimeout(() => search(value, false), 140)
        historyTimer = setTimeout(() => searchHistory(value), 380)
      })
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          if (!matches.length && input.value.trim()) { search(input.value, false); return }
          step(event.shiftKey ? -1 : 1)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          close()
        }
      })

      results = document.createElement('div')
      results.style.cssText = 'display:flex;flex-direction:column;gap:1px;max-height:210px;overflow:auto'

      top.appendChild(input)
      top.appendChild(counter)
      top.appendChild(historyCount)
      top.appendChild(prev)
      top.appendChild(next)
      top.appendChild(closeBtn)
      bar.appendChild(top)
      bar.appendChild(results)
      document.body.appendChild(bar)
      input.focus()
      input.select()
    }

    function onKeydown(event) {
      const isFind = (event.ctrlKey || event.metaKey) && !event.altKey && String(event.key).toLowerCase() === 'f'
      if (isFind) {
        event.preventDefault()
        event.stopPropagation()
        open()
        return
      }
      if (bar && event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }

    function apply(ctx) {
      if (window.__dshQuickFindInstalled) return
      window.__dshQuickFindInstalled = true
      injectStyles()
      document.addEventListener('keydown', onKeydown, true)
      const dispose = () => {
        document.removeEventListener('keydown', onKeydown, true)
        close()
        window.__dshQuickFindInstalled = false
      }
      if (ctx && typeof ctx.effect === 'function') ctx.effect(() => dispose)
      return dispose
    }

    return { name: 'dsh-quick-find', inject: [], apply }
  },
})
