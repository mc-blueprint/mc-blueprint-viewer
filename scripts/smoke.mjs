import { createServer } from 'vite'
import { withBrowser, waitReady } from './browser.mjs'

const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false } })
try {
  await server.listen()
  const address = server.httpServer.address()
  await withBrowser(async ({ send, evaluate }) => {
    await send('Page.navigate', { url: `http://127.0.0.1:${address.port}/` })
    await waitReady(evaluate)
    const result = await evaluate('!!document.querySelector("canvas") && !window.viewer.renderer.getContext().isContextLost()')
    if (!result) throw new Error('WebGL の描画コンテキストを利用できません')
    const state = () => evaluate('({position: window.viewer.camera.position.toArray(), target: window.viewer.controls.target.toArray(), distance: window.viewer.controls.getDistance()})')
    const initial = await state()
    const drag = async (button, buttons) => {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 600, y: 400, button, buttons, clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 680, y: 440, button, buttons })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 680, y: 440, button, buttons: 0, clickCount: 1 })
    }
    await drag('left', 1)
    const rotated = await state()
    await drag('right', 2)
    const panned = await state()
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 600, y: 400, deltaX: 0, deltaY: -200 })
    const zoomed = await state()
    if (JSON.stringify(initial.position) === JSON.stringify(rotated.position) ||
      JSON.stringify(rotated.target) === JSON.stringify(panned.target) || zoomed.distance >= panned.distance) {
      throw new Error('カメラの回転・移動・拡大が入力へ応答しません')
    }
  })
  console.log('ヘッドレスブラウザ: scene 検証・メッシュ準備完了・マウスによる回転/移動/拡大を確認')
} finally {
  await server.close()
}
