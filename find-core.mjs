/**
 * Full-history search over a DSH session log.
 *
 * The session file is an append-only JSONL log, compressed as a sequence of
 * independent zstd frames (one per append). Node's zstd decompressor stops at
 * the first frame, so the frames are located by their magic number and decoded
 * one by one.
 *
 * Searchable text comes from user/assistant/tool message content blocks.
 * Reasoning blocks are skipped by default: they are the model's scratchpad and
 * would flood the result list.
 */
import fs from 'node:fs'
import zlib from 'node:zlib'

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

export function decodeSessionFile(file) {
  const buf = fs.readFileSync(file)
  const offsets = []
  let from = 0
  for (;;) {
    const at = buf.indexOf(ZSTD_MAGIC, from)
    if (at < 0) break
    offsets.push(at)
    from = at + 4
  }
  const parts = []
  for (let i = 0; i < offsets.length; i += 1) {
    const start = offsets[i]
    const end = i + 1 < offsets.length ? offsets[i + 1] : buf.length
    try { parts.push(zlib.zstdDecompressSync(buf.subarray(start, end))) } catch { /* keep going */ }
  }
  const text = Buffer.concat(parts).toString('utf8')
  const events = []
  for (const line of text.split('\n')) {
    if (!line) continue
    try { events.push(JSON.parse(line)) } catch { /* partial line */ }
  }
  return events
}

/** Pull searchable text blocks out of one event. */
function blocksOf(event, includeReasoning) {
  const out = []
  const push = (block) => {
    if (!block || typeof block !== 'object') return
    if (block.type === 'reasoning' && !includeReasoning) return
    if (typeof block.text === 'string' && block.text) out.push(block.text)
  }
  if (event.type === 'user/message') {
    for (const b of (event.data && event.data.content) || []) push(b)
    return { role: 'user', blocks: out }
  }
  if (event.type === 'assistant/message') {
    const msg = (event.data && event.data.message) || {}
    for (const b of msg.content || []) push(b)
    return { role: 'assistant', blocks: out }
  }
  if (event.type === 'tool/result') {
    const msg = (event.data && event.data.message) || {}
    for (const b of msg.content || []) push(b)
    return { role: 'tool', blocks: out }
  }
  return null
}

function snippet(text, index, length, pad = 48) {
  const start = Math.max(0, index - pad)
  const end = Math.min(text.length, index + length + pad)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return prefix + text.slice(start, end).replace(/\s+/g, ' ').trim() + suffix
}

/**
 * @param {string} file session log path
 * @param {string} query needle
 * @param {{limit?: number, includeReasoning?: boolean, roles?: string[]}} [options]
 */
export function searchSessionFile(file, query, options = {}) {
  const q = String(query || '').trim()
  if (!q) return { matches: [], total: 0 }
  const needle = q.toLowerCase()
  const limit = Math.max(1, Math.min(options.limit || 100, 300))
  const roles = options.roles || ['user', 'assistant', 'tool']
  const events = decodeSessionFile(file)
  const matches = []
  let total = 0
  for (const event of events) {
    const parsed = blocksOf(event, !!options.includeReasoning)
    if (!parsed || !roles.includes(parsed.role)) continue
    for (const block of parsed.blocks) {
      const hay = block.toLowerCase()
      let idx = hay.indexOf(needle)
      while (idx !== -1) {
        total += 1
        if (matches.length < limit) {
          matches.push({
            seq: event.seq,
            time: event.time,
            role: parsed.role,
            turn: (event.data && event.data.turn) || null,
            snippet: snippet(block, idx, q.length),
          })
        }
        idx = hay.indexOf(needle, idx + needle.length)
      }
    }
  }
  return { matches, total, events: events.length }
}

/** Newest session log under $DSH_HOME/sessions (best guess at the open one). */
export function newestSessionFile(root) {
  let best = null
  let bestMtime = 0
  let entries = []
  try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { return null }
  for (const ws of entries) {
    if (!ws.isDirectory()) continue
    const wsDir = root + '/' + ws.name
    let sessions = []
    try { sessions = fs.readdirSync(wsDir, { withFileTypes: true }) } catch { continue }
    for (const s of sessions) {
      if (!s.isDirectory()) continue
      const file = wsDir + '/' + s.name + '/session.v4.jsonl.zstd'
      try {
        const st = fs.statSync(file)
        if (st.mtimeMs > bestMtime) { bestMtime = st.mtimeMs; best = { file, id: s.name, mtime: st.mtimeMs } }
      } catch { /* session without log */ }
    }
  }
  return best
}
