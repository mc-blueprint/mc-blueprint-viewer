import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { createServer } from 'vite'
import { devApi, cacheRoot } from './dev-api.mjs'
import { makeScene } from './generate-scenes.mjs'
import { withBrowser, waitReady, captureCanvas } from './browser.mjs'
/* global createImageBitmap, document */

const output = await mkdtemp(join(tmpdir(), 'viewer-still-'))
console.log(`保存先: ${output}`)
const sceneFile = join(output, 'scene.json.gz')
const results = []
const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
  plugins: [{ name: 'still-verification', configureServer(server) { server.middlewares.use(devApi({ sceneFile })) } }],
})
try {
  await server.listen()
  const url = `http://127.0.0.1:${server.httpServer.address().port}/`
  await withBrowser(async browser => {
    const { page, evaluate, send } = browser
    await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }))
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    const capture = async name => {
      const png = await captureCanvas(browser, join(output, `${name}.png`))
      const colors = await page.evaluate(async data => {
        const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob())
        const canvas = document.createElement('canvas')
        canvas.width = image.width; canvas.height = image.height
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0)
        image.close()
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
        const colors = new Set()
        for (let i = 0; i < pixels.length; i += 16) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`)
        return colors.size
      }, png)
      assert.ok(colors > 32, `${name}の画像が背景だけになっています`)
    }
    await page.setViewportSize({ width: 1600, height: 900 })
    for (const version of ['1.21.11', '26.1.2', '26.2', '26.3']) {
      const scene = makeScene('representative', undefined, version)
      const omitted = []
      for (const entry of scene.palette.filter(p => p.render === 'model')) {
        const name = entry.state.split(':')[1].split('[')[0]
        try { await access(join(cacheRoot(), 'assets', version, 'assets/minecraft/blockstates', `${name}.json`)) } catch (error) {
          if (error.code !== 'ENOENT') throw error
          omitted.push(entry.state)
          entry.render = 'invisible'
        }
      }
      const json = JSON.stringify(scene)
      await writeFile(sceneFile, gzipSync(Buffer.from(json)))
      const shots = []
      for (const view of ['iso', 'front', 'top']) {
        await page.goto(`${url}?still=${view}&preset=vanilla`)
        await waitReady(evaluate)
        assert.equal(await evaluate('window.viewer.controls.enabled'), false)
        assert.equal(await evaluate('window.viewer.quality.shader'), 'vanilla')
        assert.equal(await page.locator('#view-controls').isVisible(), false)
        assert.equal(await page.locator('#selection-panel').count(), 0)
        assert.deepEqual(await evaluate('[window.viewer.renderer.domElement.width, window.viewer.renderer.domElement.height]'), [1600, 900])
        await capture(`${version}-${view}`)
        shots.push({ view, camera: await evaluate('window.viewer.camera.position.toArray()') })
      }
      // 全体像とは別に、既存と同じカメラAPIで形状を判読できる北側拡大を残す。
      for (const [name, position, target] of [
        ['detail-west', [9, 5, -8], [8, 1.2, 3]],
        ['detail-east', [23, 5, -9], [23, 1.2, 3]],
      ]) {
        await evaluate(`window.viewer.camera.up.set(0,1,0); window.viewer.camera.position.set(${position}); window.viewer.controls.target.set(${target}); window.viewer.controls.update()`)
        await capture(`${version}-${name}`)
      }
      assert.deepEqual(errors, [])
      const manifest = JSON.parse(await readFile(join(cacheRoot(), 'assets', version, 'manifest.json'), 'utf8'))
      results.push({ version, sceneSHA256: createHash('sha256').update(json).digest('hex'), omitted, shots,
        jarSHA1: manifest.sha1, browser: (await send('Browser.getVersion')).product,
        metrics: await evaluate('window.viewer.metrics') })
      console.log(JSON.stringify(results.at(-1)))
    }
    for (const preset of ['soft', 'cinematic']) {
      await page.goto(`${url}?still=iso&preset=${preset}`)
      await waitReady(evaluate)
      assert.equal(await evaluate('window.viewer.quality.shader'), preset)
    }
    for (const query of ['still=invalid', 'still=iso&preset=invalid']) {
      await page.goto(`${url}?${query}`)
      await page.locator('[role="alert"]').waitFor()
      assert.equal(await evaluate('!!window.viewer?.ready'), false)
    }
    await page.goto(`${url}?still=iso`)
    await waitReady(evaluate)
    const before = await evaluate('window.viewer.camera.position.toArray()')
    await page.mouse.move(400, 400); await page.mouse.down(); await page.mouse.move(800, 600); await page.mouse.up()
    assert.deepEqual(await evaluate('window.viewer.camera.position.toArray()'), before)
    assert.deepEqual(errors, [])
  })
} finally { await server.close() }
await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2))
console.log(`画像・検証結果: ${output}`)
