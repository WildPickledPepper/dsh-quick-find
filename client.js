/* dsh-session-find — client half.
 *
 * Ctrl+F (Cmd+F) inside an open conversation opens a small find bar. It walks
 * the rendered text nodes of the conversation region, highlights every hit and
 * jumps between hits with Enter / Shift+Enter.
 *
 * Highlighting uses the CSS Custom Highlight API: ranges are registered in
 * CSS.highlights and painted by ::highlight() rules — no DOM mutation, so
 * React never fights us. (Registering ranges without a ::highlight() rule
 * paints nothing, which is why the rule is injected here.)
 *
 * Rendered messages only: Harness virtualizes long histories, so turns that
 * are not mounted cannot be matched.
 */
window.__ModuleLoader__.load({
  id: 'dsh-quick-find',
  factory: () => {
    const HL_ALL = 'dsh-session-find'
    const HL_ACTIVE = 'dsh-session-find-active'
    const BAR_ID = 'dsh-find-bar'
    const STYLE_ID = 'dsh-find-style'

    let bar = null
    let input = null
    let counter = null
    let matches = []
    let active = -1
    let timer = null
    let lastQuery = ''

    function injectStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent =
        '::highlight(' + HL_ALL + '){background-color:rgba(255,214,10,.45);color:inherit;}' +
        '::highlight(' + HL_ACTIVE + '){background-color:rgba(255,140,0,.95);color:#1d1d1f;}'
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
      if (!matches.length) counter.textContent = lastQuery ? '无结果' : ''
      else counter.textContent = (active + 1) + ' / ' + matches.length
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

    function close() {
      clearHighlights()
      if (timer) { clearTimeout(timer); timer = null }
      if (bar && bar.parentNode) bar.parentNode.removeChild(bar)
      bar = null
      input = null
      counter = null
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
        'z-index:2147483000',
        'display:flex',
        'align-items:center',
        'gap:6px',
        'padding:6px 8px',
        'border-radius:10px',
        'background:var(--dsw-alias-bg-layer-1,#fff)',
        'box-shadow:0 8px 28px rgba(0,0,0,.22)',
        'border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12))',
        'font:13px/1.4 system-ui,sans-serif',
      ].join(';')

      input = document.createElement('input')
      input.type = 'text'
      input.placeholder = '在本会话中查找…'
      input.style.cssText = [
        'all:unset',
        'width:200px',
        'padding:3px 6px',
        'border-radius:6px',
        'background:var(--dsw-alias-interactive-bg-hover,rgba(120,120,128,.10))',
        'color:var(--dsw-alias-label-primary,#1d1d1f)',
      ].join(';')

      counter = document.createElement('span')
      counter.style.cssText = 'min-width:64px;text-align:center;font-size:12px;opacity:.7'
      counter.textContent = ''

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
        timer = setTimeout(() => search(value, false), 140)
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

      bar.appendChild(input)
      bar.appendChild(counter)
      bar.appendChild(prev)
      bar.appendChild(next)
      bar.appendChild(closeBtn)
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
      if (window.__dshSessionFindInstalled) return
      window.__dshSessionFindInstalled = true
      injectStyles()
      document.addEventListener('keydown', onKeydown, true)
      const dispose = () => {
        document.removeEventListener('keydown', onKeydown, true)
        close()
        window.__dshSessionFindInstalled = false
      }
      if (ctx && typeof ctx.effect === 'function') ctx.effect(() => dispose)
      return dispose
    }

    return { name: 'dsh-session-find', inject: [], apply }
  },
})
