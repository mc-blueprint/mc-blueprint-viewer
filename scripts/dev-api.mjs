import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export function cacheRoot() {
  return join(process.env.LOCALAPPDATA ?? join(homedir(), '.cache'), 'mc-blueprint', 'cache')
}

/** 開発専用 API。scene / asset の配信に加え、edits の保存・再生成・更新通知をメモリ上で模擬する。 */
export function devApi({ sceneFile = process.env.VIEWER_SCENE ?? '.dev-scenes/representative.scene.json.gz', assetsRoot = join(cacheRoot(), 'assets'), token = 'development' } = {}) {
  let savedEdits
  const eventClients = new Set()
  return async (req, res, next) => {
    if (!req.url?.startsWith('/api/')) return next()
    const host = req.headers.host ?? ''
    if (![`127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`].includes(host) || (req.headers.origin && req.headers.origin !== `http://${host}`)) {
      res.writeHead(403).end('許可されていない要求です'); return
    }
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end('認証が必要です'); return }
    if (pathOnly(req.url) === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      res.write(': connected\n\n')
      eventClients.add(res)
      res.on('close', () => eventClients.delete(res))
      return
    }
    if (req.method === 'POST' && ['/api/edits', '/api/regenerate'].includes(pathOnly(req.url))) {
      if (req.headers['content-type'] !== 'application/json') { res.writeHead(415).end('application/json が必要です'); return }
      if (pathOnly(req.url) === '/api/edits') {
        try {
          const chunks = []
          let length = 0
          for await (const chunk of req) {
            length += chunk.length
            if (length > 1024 * 1024) { res.writeHead(413).end('要求が大きすぎます'); return }
            chunks.push(chunk)
          }
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (!value || value.formatVersion !== 1 || typeof value.scene !== 'string' || !Array.isArray(value.edits)) {
            res.writeHead(400).end('edits v1 形式が必要です'); return
          }
          savedEdits = value
          res.writeHead(204).end()
        } catch { res.writeHead(400).end('JSON を読み込めません'); }
        return
      }
      if (!savedEdits) { res.writeHead(409).end('先に edits を保存してください'); return }
      for (const client of eventClients) client.write('event: scene-updated\ndata: {}\n\n')
      res.writeHead(202, { 'Content-Type': 'application/json' }).end(JSON.stringify({ accepted: true }))
      return
    }
    if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET, POST' }).end(); return }
    try {
      const path = decodeURIComponent(req.url.split('?')[0])
      let file
      if (path === '/api/scene') file = resolve(sceneFile)
      else if (path.startsWith('/api/assets/')) {
        const suffix = path.slice('/api/assets/'.length)
        if (suffix.includes('\\') || suffix.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) {
          res.writeHead(403).end(); return
        }
        const root = await realpath(assetsRoot)
        file = await realpath(resolve(root, suffix))
        const rel = relative(root, file)
        if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) { res.writeHead(403).end(); return }
      } else { res.writeHead(404).end(); return }
      if (!(await stat(file)).isFile()) { res.writeHead(404).end(); return }
      const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.gz') ? 'application/gzip' : 'application/json'
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' })
      createReadStream(file).on('error', () => res.destroy()).pipe(res)
    } catch (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 400).end('ファイルを読み込めません')
    }
  }
}

function pathOnly(url) {
  return url?.split('?')[0] ?? ''
}
