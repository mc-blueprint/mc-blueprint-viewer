import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { unzipSync } from 'fflate'
import { cacheRoot } from './dev-api.mjs'

const version = process.argv[2] ?? '1.21.11'
if (!/^[a-zA-Z0-9][\w.-]*$/.test(version) || version.includes('..')) throw new Error('版が不正です')
const cache = cacheRoot()
const local = process.argv[3] === '--official' ? undefined : process.argv[3] ?? (version === '1.21.11' ? join(process.env.APPDATA, '.minecraft', 'versions', version, `${version}.jar`) : undefined)
let jar, source, expected
async function readOptional(path) {
  try { return await readFile(path) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return undefined
  }
}
async function officialJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`公式データの取得に失敗しました: ${response.status}`)
  return response.json()
}
if (local) {
  source = resolve(local)
  jar = await readFile(source)
} else {
  const manifest = await officialJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')
  const found = manifest.versions.find(item => item.id === version)
  if (!found) throw new Error(`公式 manifest にない版です: ${version}`)
  const metadata = await officialJson(found.url)
  const client = metadata.downloads.client
  source = client.url
  expected = client.sha1
  const jars = join(cache, 'jars')
  await mkdir(jars, { recursive: true })
  const target = join(jars, `${version}.jar`)
  jar = await readOptional(target)
  if (!jar) {
    const response = await fetch(source)
    if (!response.ok) throw new Error(`jar の取得に失敗しました: ${response.status}`)
    jar = Buffer.from(await response.arrayBuffer())
  }
  if (createHash('sha1').update(jar).digest('hex') !== expected) throw new Error('jar の SHA-1 が公式値と一致しません')
  await writeFile(target, jar)
}
const sha1 = createHash('sha1').update(jar).digest('hex')
const out = join(cache, 'assets', version)
const previousBytes = await readOptional(join(out, 'manifest.json'))
if (previousBytes) {
  const previous = JSON.parse(previousBytes.toString('utf8'))
  if (previous.sha1 !== sha1) throw new Error('既存キャッシュと jar が異なります。別の版またはキャッシュを指定してください')
  console.log(`展開済み: ${out}`)
} else {
  const staging = `${out}.tmp-${process.pid}`
  await mkdir(staging, { recursive: true })
  const selected = name => /^assets\/minecraft\/(blockstates\/[^/]+\.json|models\/.+\.json|textures\/(block\/.+|entity\/(chest|bed)\/.+|colormap\/[^/]+)\.png)$/.test(name)
  const files = unzipSync(jar, { filter: file => selected(file.name) })
  let count = 0
  for (const [name, bytes] of Object.entries(files)) {
    if (name.split('/').some(part => part === '..' || part.includes('\\') || part.includes(':'))) throw new Error('jar 内のパスが不正です')
    const file = join(staging, name)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, bytes)
    count++
  }
  if (!count) throw new Error('アセットが見つかりません')
  await writeFile(join(staging, 'manifest.json'), JSON.stringify({ source, sha1, extractedAt: new Date().toISOString() }, null, 2))
  await rename(staging, out)
  console.log(`${count} ファイルを展開: ${out}`)
}
