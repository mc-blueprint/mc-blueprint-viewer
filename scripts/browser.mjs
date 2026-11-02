import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { setTimeout, clearTimeout } from 'node:timers'

/** 別プロファイルのヘッドレス Chromium。既存のブラウザ画面には接続しない。 */
export async function withBrowser(run) {
  const profile = await mkdtemp(join(tmpdir(), 'viewer-browser-'))
  const child = spawn(process.env.VIEWER_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
    '--headless', '--no-first-run', '--disable-extensions', '--disable-background-networking',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--enable-precise-memory-info',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' })
  let launchError
  child.on('error', error => { launchError = error })
  let socket
  const pending = new Map()
  let id = 0
  try {
    let port
    const deadline = Date.now() + 20000
    while (!port) {
      if (launchError) throw launchError
      try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0] } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      if (Date.now() > deadline) throw new Error('ヘッドレスブラウザの起動がタイムアウトしました')
      if (!port) await delay(100)
    }
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    socket = new globalThis.WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    socket.onmessage = event => {
      const message = JSON.parse(event.data)
      if (!message.id) return
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      clearTimeout(request.timer)
      if (message.error) request.reject(new Error(JSON.stringify(message.error)))
      else request.resolve(message.result)
    }
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP タイムアウト: ${method}`)) }, 120000)
      pending.set(requestId, { resolve, reject, timer })
      socket.send(JSON.stringify({ id: requestId, method, params }))
    })
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    await send('Page.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `new MutationObserver(() => { const el = document.querySelector('#viewport'); if (el) { el.style.width = '1280px'; el.style.height = '720px'; } }).observe(document, { childList: true, subtree: true })` })
    await run({ send, evaluate, profile })
    await send('Browser.close')
  } finally {
    socket?.close()
    for (const request of pending.values()) clearTimeout(request.timer)
    if (child.exitCode === null) {
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)])
      if (child.exitCode === null) child.kill()
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  }
}

export async function waitReady(evaluate, timeout = 120000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const state = await evaluate(`({ready: !!window.viewer?.ready, error: document.querySelector('[role="alert"]')?.textContent})`)
    if (state.error) throw new Error(state.error)
    if (state.ready) return
    await delay(100)
  }
  throw new Error('メッシュの準備がタイムアウトしました')
}
