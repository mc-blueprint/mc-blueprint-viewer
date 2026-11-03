import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { withBrowser } from './browser.mjs'

/* global document, window, ReadableStream, Response, TextEncoder */

// 描画アセットに依存せず、実メッシュ・Raycaster・DOMを接続して確認する。
const server = await createServer({
  server: { host: '127.0.0.1', port: 0, open: false },
  plugins: [{ name: 'selection-test', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url !== '/selection-test') return next()
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end('<!doctype html><main><canvas width="400" height="400" style="width:400px;height:400px"></canvas></main>')
    })
  } }],
})
try {
  await server.listen()
  const url = `http://127.0.0.1:${server.httpServer.address().port}/selection-test`
  await withBrowser(async ({ page }) => {
    for (const state of ['water[level=0]', 'chest[facing=north,type=single]', 'red_bed[part=foot,facing=north]']) {
      await page.goto(url)
      await page.evaluate(async state => {
        const { CanvasTexture, Mesh, PerspectiveCamera, Vector3 } = await import('/node_modules/.vite/deps/three.js')
        const { MeshWorld } = await import('/src/mesh/world.ts')
        const { modelFaces, shapeOf } = await import('/src/mesh/models.ts')
        const { SpecialWorld, specialTextures } = await import('/src/special/world.ts')
        const { mountSelectionUI } = await import('/src/ui/viewer.ts')
        const { lightMap } = await import('/src/light/environment.ts')
        const { propagateLight } = await import('/src/light/propagation.ts')
        const entry = (state, render) => ({ state: `minecraft:${state}`, render, opacity: render === 'model' ? 15 : 0, emission: 0, tint: 'none' })
        const blocks = new Uint16Array([1, 2])
        const loaded = { sha256: 'a'.repeat(64), document: {
          size: [1, 2, 1], minecraftVersion: '1.21.11', palette: [entry('air', 'invisible'), entry('stone', 'model'), entry(state, state.startsWith('water') ? 'fluid' : 'entity')],
          blockEntities: state.startsWith('water') ? [] : [{ at: [0, 1, 0], id: state.startsWith('chest') ? 'minecraft:chest' : 'minecraft:bed' }],
          source: { kind: 'spec' }, sources: [{ id: 1, element: 'test#1', label: '特殊ブロック' }],
          environment: { biome: 'plains' }, preview: { quality: 'low' },
        }, chunks: [{ at: [0, 0, 0], size: [1, 2, 1], blocks, sources: new Uint32Array([0, 1]) }] }
        const textures = ['minecraft:block/stone', ...specialTextures(loaded)]
        const atlas = { texture: new CanvasTexture(document.createElement('canvas')), bytes: 4, tiles: new Map(textures.map(id => [id, { u: 0, v: 0, width: 1, height: 1, layer: id.includes('water') ? 'translucent' : 'opaque' }])) }
        const texture = lightMap(0.5, 1, true)
        const special = new SpecialWorld(loaded, atlas, propagateLight({ ...loaded.document, chunks: loaded.chunks }), texture)
        const directions = ['up', 'down', 'north', 'south', 'east', 'west']
        const shape = shapeOf(modelFaces({ elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: Object.fromEntries(directions.map(side => [side, { texture: 'minecraft:block/stone' }])) }] }, { model: '' }))
        const meshes = new MeshWorld(loaded, [undefined, () => shape], atlas, undefined, undefined, special)
        await meshes.update(new Vector3(0.5, 5, 0.5))
        meshes.group.updateMatrixWorld(true)
        const camera = new PerspectiveCamera(50, 1, 0.1, 100)
        camera.position.set(0.5, 5, 0.5)
        camera.lookAt(0.5, 0, 0.5)
        camera.updateMatrixWorld(true)
        window.requests = []
        window.fetch = async (url, options) => {
          if (url === '/api/events') return new Response(new ReadableStream({ start(controller) { window.events = controller } }))
          window.requests.push(url)
          if (url === '/api/edits') window.saved = JSON.parse(options.body)
          return new Response(null, { status: 204 })
        }
        window.cleanup = mountSelectionUI(loaded, meshes, camera, document.querySelector('canvas'))
        window.meshCount = 0
        meshes.group.traverse(object => { if (object instanceof Mesh) window.meshCount++ })
      }, state)
      assert.ok(await page.evaluate(() => window.meshCount) >= 2)
      const canvas = page.locator('canvas')
      await canvas.click({ position: { x: 200, y: 200 } })
      await page.locator('#block-info').filter({ hasText: `0, 1, 0 / minecraft:${state}` }).waitFor()
      assert.match(await page.locator('#block-info').textContent(), /生成元: 特殊ブロック/)
      const select = async () => {
        await page.locator('#pick').click()
        await canvas.click({ position: { x: 200, y: 200 } })
        await canvas.click({ position: { x: 200, y: 200 } })
      }
      await select()
      await page.locator('#add').click()
      await page.locator('#edit-list button').getByText('編集', { exact: true }).click()
      await page.locator('#kind').selectOption('delete')
      await select()
      await page.locator('#add').click()
      assert.equal(await page.locator('#edit-list li').count(), 1)
      assert.deepEqual(JSON.parse(await page.locator('#edit-list span').textContent()), { kind: 'delete', region: [[0, 1, 0], [0, 1, 0]], id: 'e1' })
      await page.locator('#kind').selectOption('replace')
      await select()
      await page.locator('#add').click()
      assert.equal(await page.locator('#edit-list li').count(), 2)
      await page.locator('#save').click()
      await page.locator('#edit-status').filter({ hasText: 'edits を保存しました。' }).waitFor()
      assert.equal((await page.evaluate(() => window.saved.edits)).length, 2)
      await page.locator('#regenerate').click()
      await page.locator('#edit-status').filter({ hasText: '再生成が完了しました。' }).waitFor()
      assert.deepEqual(await page.evaluate(() => window.requests.slice(-2)), ['/api/edits', '/api/regenerate'])
      console.log(`${state}: 特殊ブロック選択・生成元表示・replace→delete編集・編集後の追加・保存を確認`)
      await page.evaluate(() => { window.cleanup(); window.events.close() })
    }

    await page.goto(`${url}?editMode=blocks`)
    await page.evaluate(async () => {
      const { mountSelectionUI } = await import('/src/ui/viewer.ts')
      const loaded = { sha256: 'b'.repeat(64), document: { size: [1, 1, 1], source: { kind: 'scene' }, sources: [] }, chunks: [] }
      window.requests = []
      window.fetch = async path => {
        if (path === '/api/events') return new Response(new ReadableStream({ start(controller) { window.events = controller } }))
        window.requests.push(path)
        if (path === '/api/edits') return new Promise(resolve => { window.resolveSave = () => resolve(new Response(null, { status: 204 })) })
        if (path === '/api/regenerate') return new Response(JSON.stringify({ code: 3, diagnostics: ['評価不合格'] }), { status: 200 })
        throw new Error(`unexpected request: ${path}`)
      }
      mountSelectionUI(loaded, { group: {} }, {}, document.createElement('canvas'))
    })
    assert.equal(await page.locator('#kind option[value="note"]').evaluate(option => option.hidden), true)
    assert.equal(await page.locator('#kind option[value="param"]').evaluate(option => option.hidden), true)
    await page.locator('#regenerate').click()
    await page.waitForFunction(() => document.querySelector('#regenerate').disabled)
    await page.evaluate(() => document.querySelector('#regenerate').click())
    assert.deepEqual(await page.evaluate(() => window.requests), ['/api/edits'])
    await page.evaluate(() => window.resolveSave())
    await page.locator('#edit-status').filter({ hasText: 'code=3' }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.requests), ['/api/edits', '/api/regenerate'])
    assert.match(await page.locator('#edit-status').textContent(), /評価不合格/)
    console.log('editMode=blocks の操作制限と評価 code=3 の表示を確認')

    await page.evaluate(() => {
      window.requests = []
      window.fetch = async path => path === '/api/events'
        ? new Response(new ReadableStream({ start(controller) { window.events = controller } }))
        : (window.requests.push(path), path === '/api/edits'
          ? new Response(JSON.stringify({ error: '保存対象が古いsceneです' }), { status: 409 })
          : new Response(null, { status: 200 }))
    })
    await page.locator('#regenerate').click()
    await page.locator('#edit-status').filter({ hasText: '保存対象が古いsceneです' }).waitFor()
    assert.match(await page.locator('#edit-status').textContent(), /^409:/)
    assert.deepEqual(await page.evaluate(() => window.requests), ['/api/edits'])
    console.log('保存失敗時にサーバーのJSONエラーを表示')

    await page.evaluate(() => {
      window.requests = []
      window.fetch = async path => path === '/api/events'
        ? new Response(new ReadableStream({ start(controller) { window.events = controller } }))
        : (window.requests.push(path), path === '/api/edits'
          ? new Response(null, { status: 204 })
          : new Response(JSON.stringify({ message: '入力を再確認してください' }), { status: 422 }))
    })
    await page.locator('#regenerate').click()
    await page.locator('#edit-status').filter({ hasText: '入力を再確認してください' }).waitFor()
    assert.match(await page.locator('#edit-status').textContent(), /^422:/)
    assert.deepEqual(await page.evaluate(() => window.requests), ['/api/edits', '/api/regenerate'])

    await page.evaluate(() => {
      window.fetch = async path => path === '/api/events'
        ? new Response(new ReadableStream({ start(controller) { window.events = controller } }))
        : path === '/api/edits'
          ? new Response(null, { status: 204 })
          : new Response(JSON.stringify({ error: '再生成に失敗しました' }), { status: 500 })
    })
    await page.locator('#regenerate').click()
    await page.locator('#edit-status').filter({ hasText: '再生成に失敗しました' }).waitFor()
    assert.match(await page.locator('#edit-status').textContent(), /^500:/)
    console.log('再生成APIの422/500 JSONエラーとstatus表示を確認')

    // CRLFがネットワークの読み取り境界で分割されてもイベントを完了する。
    await page.goto(url)
    for (const separator of ['\n', '\r\n']) {
      await page.reload()
      await page.evaluate(async () => {
        const { mountSelectionUI } = await import('/src/ui/viewer.ts')
        const loaded = { sha256: 'a'.repeat(64), document: { size: [1, 1, 1], palette: [], source: { kind: 'spec' }, sources: [] }, chunks: [] }
        window.fetch = async () => new Response(new ReadableStream({ start(controller) { window.events = controller } }))
        mountSelectionUI(loaded, {}, {}, document.querySelector('canvas'))
      })
      await page.evaluate(separator => window.events.enqueue(new TextEncoder().encode(`event: scene-updated${separator}data: {}${separator[0]}`)), separator)
      const navigation = page.waitForEvent('framenavigated')
      await page.evaluate(separator => window.events.enqueue(new TextEncoder().encode(separator.slice(1) + separator)), separator)
      await navigation
      console.log(`${JSON.stringify(separator)}: 分割されたSSE更新通知による再読み込みを確認`)
    }
  })
} finally {
  await server.close()
}
