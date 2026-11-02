import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { createServer } from 'vite'
import { scenarios } from './generate-scenes.mjs'

const server = await createServer({ server: { middlewareMode: true } })
try {
  const { loadScene } = await server.ssrLoadModule('/src/scene/load.ts')
  for (const name of scenarios) {
    const gzip = await readFile(`.dev-scenes/${name}.scene.json.gz`)
    const start = performance.now()
    const loaded = await loadScene(gzip)
    console.log(JSON.stringify({ name, size: loaded.document.size, chunks: loaded.chunks.length, gzipBytes: gzip.length,
      gzipSha256: createHash('sha256').update(gzip).digest('hex'), jsonSha256: loaded.sha256,
      loadMs: Math.round(performance.now() - start), processPeakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024) }))
  }
} finally {
  await server.close()
}
