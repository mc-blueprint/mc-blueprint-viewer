import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { expect, it } from 'vitest'

it('自作ZIPから対象だけを展開し、出所とSHA-1を記録し、異なるjarで上書きしない', async () => {
  const root = await mkdtemp(join(tmpdir(), 'viewer-assets-'))
  try {
    const jar = join(root, 'synthetic.jar')
    const bytes = zipSync({
      'assets/minecraft/blockstates/synthetic.json': strToU8('{"synthetic":true}'),
      'assets/minecraft/textures/entity/chest/synthetic.png': Uint8Array.of(1, 2),
      'assets/minecraft/sounds/synthetic.ogg': Uint8Array.of(3),
    })
    await writeFile(jar, bytes)
    const run = () => execFileSync(process.execPath, [resolve('scripts/extract-assets.mjs'), 'synthetic', jar], { env: { ...process.env, LOCALAPPDATA: root }, encoding: 'utf8', stdio: 'pipe' })
    expect(run()).toContain('2 ファイル')
    const out = join(root, 'mc-blueprint/cache/assets/synthetic')
    expect(JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'))).toMatchObject({ source: jar, sha1: createHash('sha1').update(bytes).digest('hex') })
    await expect(access(join(out, 'assets/minecraft/sounds/synthetic.ogg'))).rejects.toThrow()
    expect(run()).toContain('展開済み')
    await writeFile(jar, zipSync({ 'different.txt': strToU8('other') }))
    expect(() => run()).toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
