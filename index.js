/**
 * dsh-quick-find — host half.
 *
 * Serves full-history search for the find bar: the browser only sees rendered
 * messages, so old turns are searched from the session log on disk instead.
 *
 *   GET /session-find/search?q=<needle>&session=<id>&limit=<n>
 *     -> { ok, session: { id }, total, matches: [{ seq, time, role, turn, snippet }] }
 *
 * Imports nothing from @deepseek-ai/* — profile plugins cannot resolve the
 * host's own packages on every DSH layout.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { searchSessionFile, newestSessionFile } from './find-core.mjs'

export const name = 'session-find'
export const inject = ['webServer']

const home = () => process.env.DSH_HOME || path.join(os.homedir(), '.dsh')

function findSessionFile(sessionId) {
  const root = path.join(home(), 'sessions')
  if (!sessionId) {
    const newest = newestSessionFile(root)
    return newest ? newest.file : null
  }
  const wanted = new Set([sessionId, sessionId.startsWith('session-') ? sessionId.slice(8) : 'session-' + sessionId])
  let workspaces = []
  try { workspaces = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()) } catch { return null }
  for (const ws of workspaces) {
    const wsDir = path.join(root, ws.name)
    let sessions = []
    try { sessions = fs.readdirSync(wsDir, { withFileTypes: true }).filter((e) => e.isDirectory()) } catch { continue }
    for (const s of sessions) {
      if (!wanted.has(s.name)) continue
      const file = path.join(wsDir, s.name, 'session.v4.jsonl.zstd')
      if (fs.existsSync(file)) return file
    }
  }
  return null
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

export function apply(ctx) {
  ctx.inject(['webServer'], (sub) => {
    const handler = async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost')
        const q = String(url.searchParams.get('q') || '').trim()
        const sessionId = String(url.searchParams.get('session') || '').trim()
        const limit = Number(url.searchParams.get('limit')) || 40
        if (q.length < 1) { json(res, 200, { ok: true, total: 0, matches: [] }); return }
        const file = findSessionFile(sessionId)
        if (!file) { json(res, 200, { ok: false, error: '找不到会话日志' }); return }
        const result = searchSessionFile(file, q, { limit })
        json(res, 200, {
          ok: true,
          session: { id: path.basename(path.dirname(file)) },
          total: result.total,
          events: result.events,
          matches: result.matches,
        })
      } catch (error) {
        json(res, 200, { ok: false, error: String((error && error.message) || error) })
      }
    }
    sub.effect(() => sub.webServer.register({ kind: 'exact', path: '/session-find/search', handler }))
  })
}
