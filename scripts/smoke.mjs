import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'

const profile = await mkdtemp(join(tmpdir(), 'viewer-smoke-'))
const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false } })
try {
  await server.listen()
  const address = server.httpServer.address()
  const browser = process.env.VIEWER_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  const { stdout } = await promisify(execFile)(browser, [
    '--headless', '--no-first-run', '--disable-extensions', '--disable-background-networking',
    `--user-data-dir=${profile}`, '--dump-dom', '--virtual-time-budget=10000',
    `http://127.0.0.1:${address.port}/`,
  ], { timeout: 45000, windowsHide: true, maxBuffer: 1024 * 1024 })
  if (!stdout.includes('scene 検証済み') || !stdout.includes('<canvas') || stdout.includes('role="alert"')) {
    throw new Error(`ブラウザでの scene 読み込みまたは WebGL 初期化に失敗しました:\n${stdout}`)
  }
  console.log('ヘッドレスブラウザ: scene 検証・WebGL canvas 作成に成功')
} finally {
  await server.close()
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
