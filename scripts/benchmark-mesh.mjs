import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { performance } from 'node:perf_hooks'
import { createServer } from 'vite'
import { devApi } from './dev-api.mjs'
import { scenarios } from './generate-scenes.mjs'
import { withBrowser, waitReady } from './browser.mjs'

const output = await mkdtemp(join(tmpdir(), 'viewer-measurement-'))
const selected = process.argv.find(arg => arg.startsWith('--scene='))?.slice('--scene='.length)
if (selected && !scenarios.includes(selected)) throw new Error(`不明な scene: ${selected}`)
const names = selected ? [selected] : process.argv.includes('--representative') ? ['representative'] : scenarios
const results = []
for (const name of names) {
  const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
    plugins: [{ name: 'measurement-api', configureServer(server) { server.middlewares.use(devApi({ sceneFile: `.dev-scenes/${name}.scene.json.gz` })) } }],
  })
  try {
    await server.listen()
    const url = `http://127.0.0.1:${server.httpServer.address().port}/`
    for (let repeat = 0; repeat < (name === 'representative' ? 1 : 3); repeat++) {
      await withBrowser(async ({ send, evaluate, profile }) => {
        const start = performance.now()
        await send('Page.navigate', { url })
        await waitReady(evaluate)
        const readyMs = Math.round(performance.now() - start)
        const browser = await send('Browser.getVersion')
        let peakRss = 0
        const memory = async () => {
          if (process.platform !== 'win32') return
          const escaped = profile.replaceAll("'", "''")
          const { stdout } = await promisify(execFile)('powershell', ['-NoProfile', '-Command',
            `$ids = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(msedge|chrome|chromium)(\\.exe)?$' -and $_.CommandLine -like '*${escaped}*' } | Select-Object -ExpandProperty ProcessId); if ($ids.Count) { (Get-Process -Id $ids -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum }`], { windowsHide: true })
          peakRss = Math.max(peakRss, Number(stdout.trim()))
        }
        const initialFrames = await evaluate('window.viewer.metrics.frames')
        const frameStart = performance.now()
        for (let i = 0; i < 10; i++) { await memory(); await delay(Math.max(0, frameStart + (i + 1) * 1000 - performance.now())) }
        const metrics = await evaluate('({...window.viewer.metrics, heapBytes: performance.memory.usedJSHeapSize, canvas: [window.viewer.renderer.domElement.width, window.viewer.renderer.domElement.height]})')
        metrics.fps = (metrics.frames - initialFrames) * 1000 / (performance.now() - frameStart)
        results.push({ name, repeat, readyMs, browser: browser.product, ...metrics, sampledPeakRssBytes: peakRss })
        console.log(JSON.stringify(results.at(-1)))
        if (name === 'representative') {
          const views = [
            { name: 'overview', position: [36, 22, 32], target: [16, 0, 5] },
            { name: 'stairs-fence-pane-door', position: [9, 5, -4], target: [6, 1.5, 3] },
            { name: 'log-multipart-weighted', position: [28, 5, -5], target: [21, 1.2, 3] },
          ]
          for (const view of views) {
            await evaluate(`window.viewer.camera.position.set(${view.position}); window.viewer.controls.target.set(${view.target}); window.viewer.controls.update()`)
            await delay(400)
            const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
            await writeFile(join(output, `${view.name}.png`), Buffer.from(screenshot.data, 'base64'))
          }
          await evaluate(`document.querySelector('#section').value = '0'; document.querySelector('#section').dispatchEvent(new Event('input'))`)
          await waitReady(evaluate)
          const sectionFaces = await evaluate('window.viewer.metrics.faces')
          await evaluate(`document.querySelector('#section').value = '15'; document.querySelector('#section').dispatchEvent(new Event('input')); document.querySelector('#floor').value = '1'; document.querySelector('#floor').dispatchEvent(new Event('change'))`)
          await waitReady(evaluate)
          const floorFaces = await evaluate('window.viewer.metrics.faces')
          if (sectionFaces !== 1120 || floorFaces !== 135) throw new Error(`断面・階表示の面数が不一致: ${sectionFaces}, ${floorFaces}`)
          console.log(JSON.stringify({ sectionFaces, floorFaces }))
        }
      })
    }
  } finally { await server.close() }
}
await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2))
console.log(`画像・測定結果: ${output}`)
