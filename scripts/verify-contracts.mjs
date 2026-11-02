import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { createServer } from 'vite'
import { devApi } from './dev-api.mjs'
import { makeScene } from './generate-scenes.mjs'
import { captureCanvas, waitReady, withBrowser } from './browser.mjs'

/* global window */

const output = await mkdtemp(join(tmpdir(), 'viewer-contracts-'))
const sceneFile = join(output, 'scene.json.gz')
const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
  plugins: [{ name: 'contract-verification', configureServer(server) { server.middlewares.use(devApi({ sceneFile })) } }],
})

try {
  await server.listen()
  const url = `http://127.0.0.1:${server.httpServer.address().port}/`
  await withBrowser(async ({ page, send, evaluate }) => {
    const samples = []
    const cases = [
      { name: 'dark', color: [0.5, 0, 0], rgb: [0.125, 0.125, 0.125] },
      { name: 'light', color: [0.8, 0, 0], rgb: [0.512, 0.512, 0.512] },
      { name: 'green', color: [0.65, -0.08, 0.12], rgb: [0.20740409, 0.33698417, 0.02126010] },
    ]
    for (const preset of cases) {
      const scene = makeScene('representative', [32, 32, 32])
      scene.palette[4] = { ...scene.palette[4], tint: 'fixed', tintColor: preset.color }
      const blocks = Buffer.alloc(4096 * 2), sources = Buffer.alloc(4096 * 4)
      blocks.writeUInt16LE(1, 4095 * 2)
      sources.writeUInt32LE(1, 4095 * 4)
      scene.chunks.push({ at: [16, 16, 16], blocks: blocks.toString('base64'), sources: sources.toString('base64') })
      await writeFile(sceneFile, gzipSync(Buffer.from(JSON.stringify(scene))))
      await page.goto(url)
      await waitReady(evaluate)
      await page.evaluate(async () => {
        const v = window.viewer
        v.camera.position.set(10.5, 4, -2)
        v.controls.target.set(10.5, 1.5, 3.5)
        v.controls.update()
        await v.renderFrame()
      })
      const result = await page.evaluate(() => {
        const v = window.viewer
        const colors = []
        v.meshes.group.traverse(object => {
          if (!object.isMesh) return
          const owners = object.geometry.getAttribute('blockPosition'), color = object.geometry.getAttribute('color')
          for (let i = 0; i < owners.count; i++) {
            if (owners.getX(i) === 10 && owners.getY(i) === 1 && owners.getZ(i) === 3) colors.push([color.getX(i), color.getY(i), color.getZ(i)])
          }
        })
        const gl = v.renderer.getContext()
        v.renderer.render(v.meshes.group.parent, v.camera)
        const pixels = new Uint8Array(20 * 20 * 4)
        gl.readPixels(Math.floor(gl.drawingBufferWidth / 2) - 10, Math.floor(gl.drawingBufferHeight / 2) - 10, 20, 20, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
        let green = 0
        for (let i = 1; i < pixels.length; i += 4) green += pixels[i]
        return { colors, green, error: gl.getError() }
      })
      assert.equal(result.error, 0)
      assert.ok(result.colors.length > 0)
      for (const color of result.colors) color.forEach((channel, i) => assert.ok(Math.abs(channel - preset.rgb[i]) < 1e-6))
      samples.push(result.green)
      await captureCanvas({ evaluate, send }, join(output, `fixed-leaves-${preset.name}.png`))
    }
    assert.ok(samples[1] > samples[0], `固定着色の葉の画素に明るさの差がありません: ${samples}`)
    console.log(`固定着色の葉: tintColorの頂点反映と実描画の差を確認（緑成分合計 ${samples.join(' → ')}）`)

    let saved
    await page.route('**/api/edits', async route => {
      saved = route.request().postDataJSON()
      await route.continue()
    })
    const select = async () => {
      await page.locator('#pick').click()
      for (const at of [[31, 31, 31], [0, 0, 0]]) {
        const point = await page.evaluate(async at => {
          const v = window.viewer
          v.controls.target.set(at[0] + 0.5, at[1] + 0.5, at[2] + 0.5)
          v.camera.position.copy(v.controls.target).setY(at[1] + 6)
          v.controls.update()
          await v.renderFrame()
          const r = v.renderer.domElement.getBoundingClientRect()
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
        }, at)
        await page.mouse.click(point.x, point.y)
        assert.match(await page.locator('#block-info').textContent(), new RegExp(`^${at.join(', ')}`))
      }
    }
    await page.locator('#kind').selectOption('delete')
    await select()
    await page.locator('#add').click()
    assert.equal(await page.locator('#edit-list li').count(), 1)
    await page.locator('#save').click()
    await page.locator('#edit-status').filter({ hasText: 'edits を保存しました。' }).waitFor()
    assert.deepEqual(saved.edits, [{ kind: 'delete', region: [[0, 0, 0], [31, 31, 31]], id: 'e1' }])
    const bytes = Buffer.byteLength(JSON.stringify(saved))
    assert.ok(bytes < 1024 * 1024)

    await page.locator('#edit-list button').getByText('編集', { exact: true }).click()
    await select()
    await page.locator('#add').click()
    assert.equal(await page.locator('#edit-list li').count(), 1)
    await page.locator('#save').click()
    await page.locator('#edit-status').filter({ hasText: 'edits を保存しました。' }).waitFor()
    assert.deepEqual(saved.edits, [{ kind: 'delete', region: [[0, 0, 0], [31, 31, 31]], id: 'e1' }])
    console.log(`範囲削除: DOMで32³を逆順に選択し、delete.region 1件（${bytes} bytes）の保存と再編集を確認`)
  })
  console.log(`固定sceneと画像: ${output}`)
} finally {
  await server.close()
}
