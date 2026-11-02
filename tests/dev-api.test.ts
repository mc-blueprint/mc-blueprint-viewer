import { createServer, request } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { devApi } from '../scripts/dev-api.mjs'
import { loadScene } from '../src/scene/load'
import { makeScene } from '../scripts/generate-scenes.mjs'
import { gzipSync } from 'node:zlib'

let root: string, base: string
const server = createServer()
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'viewer-api-'))
  await mkdir(join(root, 'assets', 'test'), { recursive: true })
  await writeFile(join(root, 'assets', 'test', 'model.json'), '{"test":true}')
  await mkdir(join(root, 'private'))
  await writeFile(join(root, 'private', 'secret.json'), '{}')
  await symlink(join(root, 'private'), join(root, 'assets', 'test', 'link'), 'junction')
  await writeFile(join(root, 'scene.gz'), gzipSync(JSON.stringify(makeScene())))
  server.on('request', devApi({ sceneFile: join(root, 'scene.gz'), assetsRoot: join(root, 'assets') }))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  base = `http://127.0.0.1:${address.port}`
})
afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
})
const auth = { Authorization: 'Bearer development' }
it('gzip scene とキャッシュのアセットを認証付きで取得する', async () => {
  const response = await fetch(`${base}/api/scene`, { headers: auth })
  expect(response.status).toBe(200)
  expect(response.headers.get('content-encoding')).toBeNull()
  expect((await loadScene(new Uint8Array(await response.arrayBuffer()))).document.minecraftVersion).toBe('1.21.11')
  expect(await (await fetch(`${base}/api/assets/test/model.json`, { headers: auth })).json()).toEqual({ test: true })
})
it('認証・Host・Origin・メソッドと未知の API を検査する', async () => {
  expect((await fetch(`${base}/api/scene`)).status).toBe(401)
  for (const host of ['evil.example', '127.0.0.1:1']) {
    const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
      request(`${base}/api/scene`, { headers: { ...auth, Host: host } }, response => {
        response.resume()
        resolve(response.statusCode)
      }).on('error', reject).end()
    })
    expect(hostStatus).toBe(403)
  }
  expect((await fetch(`${base}/api/scene`, { headers: { ...auth, Origin: 'http://evil.example' } })).status).toBe(403)
  expect((await fetch(`${base}/api/scene`, { method: 'POST', headers: auth })).status).toBe(405)
  expect((await fetch(`${base}/api/unknown`, { headers: auth })).status).toBe(404)
})
it.each(['test/%2e%2e%5cscene.gz', 'test/%2e%2e%2f%2e%2e%2fscene.gz', 'test/C:%5csecret'])('キャッシュ外のパス %s を拒否する', async path => {
  expect((await fetch(`${base}/api/assets/${path}`, { headers: auth })).status).toBe(403)
})
it('キャッシュ内のリンクからキャッシュ外を参照できない', async () => {
  expect((await fetch(`${base}/api/assets/test/link/secret.json`, { headers: auth })).status).toBe(403)
})
it('editsを保存し、再生成イベントを認証付きSSEで配信する', async () => {
  const eventResponse = await fetch(`${base}/api/events`, { headers: auth })
  expect(eventResponse.headers.get('content-type')).toContain('text/event-stream')
  const reader = eventResponse.body!.getReader()
  await reader.read()
  const saved = await fetch(`${base}/api/edits`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ formatVersion: 1, scene: 'sha', edits: [] }) })
  expect(saved.status).toBe(204)
  expect((await fetch(`${base}/api/regenerate`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' } })).status).toBe(202)
  const event = await reader.read()
  expect(new TextDecoder().decode(event.value)).toContain('event: scene-updated')
  await reader.cancel()
})
it('edits APIはJSON種別と本文サイズを制限する', async () => {
  expect((await fetch(`${base}/api/edits`, { method: 'POST', headers: auth, body: '{}' })).status).toBe(415)
  expect((await fetch(`${base}/api/edits`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: ' '.repeat(1024 * 1024 + 1) })).status).toBe(413)
})
