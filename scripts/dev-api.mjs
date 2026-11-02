import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export function cacheRoot() {
  return join(process.env.LOCALAPPDATA ?? join(homedir(), '.cache'), 'mc-blueprint', 'cache')
}

/** 開発専用の読み取り API。ファイルはキャッシュまたは選択した scene のみから配信する。 */
export function devApi({ sceneFile = process.env.VIEWER_SCENE ?? '.dev-scenes/representative.scene.json.gz', assetsRoot = join(cacheRoot(), 'assets'), token = 'development' } = {}) {
  return async (req, res, next) => {
    if (!req.url?.startsWith('/api/')) return next()
    const host = req.headers.host ?? ''
    if (![`127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`].includes(host) || (req.headers.origin && req.headers.origin !== `http://${host}`)) {
      res.writeHead(403).end('許可されていない要求です'); return
    }
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end('認証が必要です'); return }
    if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }).end(); return }
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
