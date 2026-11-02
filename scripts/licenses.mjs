import { readFile, writeFile } from 'node:fs/promises'

const packages = ['three', 'deepslate', 'ajv', 'fast-deep-equal', 'fast-uri', 'json-schema-traverse', 'require-from-string', 'gl-matrix', 'md5', 'charenc', 'crypt', 'is-buffer', 'pako']
const notices = []
for (const name of packages) {
  const pkg = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8'))
  const candidates = ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'LICENSE.mkd', 'LICENSE-MIT', 'LICENSE-MIT.txt', 'LICENSE-ZLIB']
  const texts = []
  for (const file of candidates) {
    try { texts.push(await readFile(`node_modules/${name}/${file}`, 'utf8')) } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  if (!texts.length) throw new Error(`ライセンス本文が見つかりません: ${name}`)
  if (name === 'pako') texts.push(await readFile('node_modules/pako/lib/zlib/README', 'utf8'))
  notices.push(`${name} ${pkg.version} (${pkg.license})\n${texts.join('\n')}`)
}
await writeFile('dist/THIRD_PARTY_LICENSES.txt', notices.join('\n\n----------------------------------------\n\n'))
