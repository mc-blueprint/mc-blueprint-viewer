import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { createServer } from 'vite'
import { devApi } from './dev-api.mjs'
import { makeScene } from './generate-scenes.mjs'
import { waitReady, withBrowser } from './browser.mjs'

const output = await mkdtemp(join(tmpdir(), 'viewer-shaders-'))
const sceneFile = join(output, 'scene.json.gz')
const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
  plugins: [{ name: 'shader-verification', configureServer(server) { server.middlewares.use(devApi({ sceneFile })) } }],
})
const results = []
try {
  await server.listen()
  const url = `http://127.0.0.1:${server.httpServer.address().port}/`
  await withBrowser(async ({ send, evaluate }) => {
    console.log(`ブラウザ: ${(await send('Browser.getVersion')).product}`)
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.renderErrors = []; const originalError = console.error; console.error = (...args) => { window.renderErrors.push(args.map(String).join(' ')); originalError(...args) }; window.addEventListener('error', e => window.renderErrors.push(e.message))` })
    for (const preset of ['vanilla', 'soft', 'cinematic']) {
      const scene = makeScene()
      Object.assign(scene.preview, { shader: preset, quality: 'medium', shadows: true, timeOfDay: 0 })
      const json = JSON.stringify(scene)
      await writeFile(sceneFile, gzipSync(Buffer.from(json)))
      await send('Page.navigate', { url: `${url}?shader=${preset}` })
      await waitReady(evaluate)
      assert.equal(await evaluate('window.viewer.quality.shader'), preset)
      for (const view of [
        { name: 'overview', position: [38, 22, 33], target: [16, 1, 7] },
        { name: 'detail', position: [20, 8, -10], target: [16, 1, 3] },
      ]) {
        const result = await evaluate(`(async () => {
          const v = window.viewer;
          v.camera.position.set(${view.position}); v.controls.target.set(${view.target}); v.controls.update();
          await v.renderFrame();
          const gl = v.renderer.getContext(), rect = v.renderer.domElement.getBoundingClientRect();
          const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
          gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          const samples = [];
          for (let y = 180; y < 540; y += 4) for (let x = 160; x < 1120; x += 4) {
            const i = (y * gl.drawingBufferWidth + x) * 4; samples.push(pixels[i], pixels[i+1], pixels[i+2]);
          }
          const sun = v.meshes.group.parent.children.find(c => c.isDirectionalLight);
          return { quality: v.quality, ready: v.ready, shadowRadius: sun.shadow.radius, toneMapping: v.renderer.toneMapping,
            fog: !!v.meshes.group.parent.fog, errors: window.renderErrors, samples,
            clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 } };
        })()`)
        assert.deepEqual(result.errors, [])
        assert.equal(result.ready, true)
        assert.equal(result.fog, preset === 'cinematic')
        assert.equal(result.shadowRadius, preset === 'vanilla' ? 1 : 3)
        const image = await send('Page.captureScreenshot', { format: 'png', clip: result.clip, captureBeyondViewport: true })
        await writeFile(join(output, `${preset}-${view.name}.png`), Buffer.from(image.data, 'base64'))
        const { samples, clip, ...metadata } = result
        assert.ok(clip.width > 0 && samples.some(value => value > 0))
        results.push({ preset, view: view.name, sceneSHA256: createHash('sha256').update(json).digest('hex'), ...metadata,
          pixelSHA256: createHash('sha256').update(Buffer.from(samples)).digest('hex') })
      }
      // 同一ページ内での往復切替でも、完了通知とGPU資源の解放を確認する。
      const memory = await evaluate(`(async () => {
        const v = window.viewer;
        await v.setPreset('vanilla'); const baseline = v.renderer.info.memory.textures;
        for (let i = 0; i < 3; i++) { await v.setPreset('cinematic'); await v.setPreset('soft'); await v.setPreset('vanilla'); }
        return { baseline, final: v.renderer.info.memory.textures, ready: v.ready, shader: v.quality.shader, errors: window.renderErrors };
      })()`)
      assert.equal(memory.ready, true)
      assert.equal(memory.shader, 'vanilla')
      assert.deepEqual(memory.errors, [])
      assert.equal(memory.final, memory.baseline, 'プリセット切替でテクスチャが残留しています')
    }
    for (const view of ['overview', 'detail']) assert.equal(new Set(results.filter(r => r.view === view).map(r => r.pixelSHA256)).size, 3)
  })
} finally { await server.close() }
await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2))
console.log(JSON.stringify(results, null, 2))
console.log(`画像・検証結果: ${output}`)
