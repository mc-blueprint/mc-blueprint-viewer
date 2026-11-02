import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
/* global MutationObserver, document, location, URLSearchParams */

/** 別プロファイルのヘッドレスChromium。既存の撮影・計測とCDP呼出しを共有する。 */
export async function withBrowser(run) {
  const profile = await mkdtemp(join(tmpdir(), 'viewer-browser-'))
  let context
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.VIEWER_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      headless: true, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1,
      args: ['--disable-extensions', '--disable-background-networking', '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling', '--enable-precise-memory-info'],
    })
    const page = context.pages()[0]
    const session = await context.newCDPSession(page)
    const send = async (method, params = {}) => {
      if (method === 'Page.navigate') { await page.goto(params.url, { waitUntil: 'domcontentloaded' }); return }
      if (method === 'Page.captureScreenshot') {
        const r = params.clip
        const png = await page.screenshot({ type: 'png', fullPage: params.captureBeyondViewport === true,
          clip: r && { x: r.x, y: r.y, width: r.width, height: r.height } })
        return { data: png.toString('base64') }
      }
      return session.send(method, params)
    }
    const evaluate = expression => page.evaluate(expression)
    await send('Page.enable')
    await page.addInitScript(() => {
      new MutationObserver(() => {
        const el = document.querySelector('#viewport')
        if (el && !new URLSearchParams(location.search).has('still')) {
          el.style.width = '1280px'; el.style.height = '720px'
        }
      }).observe(document, { childList: true, subtree: true })
    })
    await run({ send, evaluate, profile, page })
  } finally {
    await context?.close()
    await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  }
}

/** 通知は永続フラグで待つ。起動失敗をタイムアウトと区別する。 */
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

/** 後処理とGPU処理の完了を待ち、canvasだけを撮影する。 */
export async function captureCanvas({ evaluate, send }, file) {
  const clip = await evaluate(`(async () => {
    await window.viewer.renderFrame();
    const r = window.viewer.renderer.domElement.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 };
  })()`)
  const screenshot = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true })
  await writeFile(file, Buffer.from(screenshot.data, 'base64'))
  return screenshot.data
}
