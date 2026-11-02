import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { devApi } from './dev-api.mjs'
import { makeScene } from './generate-scenes.mjs'
import { waitReady, withBrowser } from './browser.mjs'

const output = await mkdtemp(join(tmpdir(), 'viewer-light-'))
const sceneFile = join(output, 'scene.json.gz')
const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
  plugins: [{ name: 'light-verification', configureServer(server) { server.middlewares.use(devApi({ sceneFile })) } }],
})
const cases = [
  { name: 'day', preview: { timeOfDay: 6000 } },
  { name: 'night', preview: { timeOfDay: 18000 } },
  { name: 'night-no-block', preview: { timeOfDay: 18000, blockLight: false } },
  { name: 'night-bright', preview: { timeOfDay: 18000, brightness: 1 } },
  { name: 'shadow-medium', preview: { timeOfDay: 0, shadows: true, quality: 'medium' } },
  { name: 'shadow-high', preview: { timeOfDay: 0, shadows: true, quality: 'high' } },
  { name: 'shadow-low', preview: { timeOfDay: 0, shadows: true, quality: 'low' } },
  { name: 'shadow-disabled', preview: { timeOfDay: 0, shadows: false, quality: 'medium' } },
]
const results = []
try {
  await server.listen()
  const url = `http://127.0.0.1:${server.httpServer.address().port}/`
  await withBrowser(async ({ send, evaluate }) => {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.renderErrors = []; const originalError = console.error; console.error = (...args) => { window.renderErrors.push(args.map(String).join(' ')); originalError(...args) }; window.addEventListener('error', e => window.renderErrors.push(e.message))` })
    for (const preset of cases) {
      const scene = makeScene()
      Object.assign(scene.preview, preset.preview)
      await writeFile(sceneFile, gzipSync(Buffer.from(JSON.stringify(scene))))
      await send('Page.navigate', { url: `${url}?verification=${preset.name}` })
      await waitReady(evaluate)
      await evaluate(`window.viewer.camera.position.set(29, 6, 10); window.viewer.controls.target.set(22, 1, 3); window.viewer.controls.update()`)
      await delay(400)
      await waitReady(evaluate)
      const result = await evaluate(`(() => {
        const v = window.viewer, gl = v.renderer.getContext();
        const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        v.renderer.render(v.meshes.group.parent, v.camera);
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let luminance = 0;
        // 固定画面中央の地面・光源を含む領域だけを比較する。
        let samples = 0;
        for (let y = 150; y < 450; y++) for (let x = 350; x < 950; x++) {
          const i = (y * gl.drawingBufferWidth + x) * 4;
          luminance += pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722; samples++;
        }
        const sun = v.meshes.group.parent.children.find(c => c.isDirectionalLight);
        return { luminance: luminance / samples, shadowMap: v.renderer.shadowMap.enabled,
          shadowSize: sun.shadow.map?.width ?? 0,
          errors: window.renderErrors, faces: v.metrics.faces,
          light: [...v.meshes.group.children[0].children[0].geometry.getAttribute('light').array.slice(0, 3)] };
      })()`)
      if (result.errors.length) throw new Error(result.errors.join('\n'))
      const image = await send('Page.captureScreenshot', { format: 'png' })
      await writeFile(join(output, `${preset.name}.png`), Buffer.from(image.data, 'base64'))
      results.push({ name: preset.name, ...result })
    }
    const byName = Object.fromEntries(results.map(result => [result.name, result]))
    if (!(byName.day.luminance > byName.night.luminance && byName.night.luminance > byName['night-no-block'].luminance && byName['night-bright'].luminance > byName.night.luminance)) throw new Error('昼夜・ブロック光・明るさの画素比較が不一致です')
    if (!byName['shadow-medium'].shadowMap || !byName['shadow-high'].shadowMap || byName['shadow-low'].shadowMap) throw new Error('品質ごとの影設定が不一致です')
    if (byName['shadow-medium'].shadowSize !== 2048 || byName['shadow-high'].shadowSize !== 4096 || byName['shadow-disabled'].shadowMap || !(byName['shadow-medium'].luminance < byName['shadow-disabled'].luminance)) throw new Error('シャドウマップの解像度・描画結果が不一致です')
    await evaluate(`document.querySelector('#floor').value = '1'; document.querySelector('#floor').dispatchEvent(new Event('change'))`)
    await waitReady(evaluate)
    if (!await evaluate(`window.viewer.meshes.group.children.every(c => c.children.every(m => m.geometry.getAttribute('light').version > 0))`)) throw new Error('再構築メッシュの光属性が未更新です')
  })
} finally { await server.close() }
await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2))
console.log(JSON.stringify(results, null, 2))
console.log(`画像・検証結果: ${output}`)
