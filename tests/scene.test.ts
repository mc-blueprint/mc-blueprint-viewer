import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { BlockDefinition } from 'deepslate'
import { decodeScene, loadScene } from '../src/scene/load'
import { makeScene, scenarios } from '../scripts/generate-scenes.mjs'
import example from './data/upstream-scene.json'
import { BlockAccess } from '../src/mesh/chunk'

describe('scene 読み込み', () => {
  it('正本の見本を gzip 展開し、元のバイト列から SHA-256 を計算する', async () => {
    const bytes = await readFile(new URL('./data/upstream-scene.json', import.meta.url))
    const result = await loadScene(gzipSync(bytes))
    expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect([...result.chunks[0].blocks]).toEqual([0, 1, 1, 0])
    expect([...result.chunks[0].sources]).toEqual([7, 7, 7, 7])
    expect((await loadScene(bytes)).sha256).toBe(result.sha256)
  })
  it('16未満の端チャンクを x 最速の実寸で復号する', () => {
    const scene = makeScene('terrain', [18, 3, 19])
    const result = decodeScene(scene)
    const edge = result.chunks.find(chunk => chunk.at.join() === '16,0,16')!
    expect(edge.size).toEqual([2, 3, 3])
    expect(edge.blocks.length).toBe(18)
  })
  it('32 bit の palette 添字と uint32 の生成元をリトルエンディアンで保持する', () => {
    const scene = structuredClone(example)
    scene.size = [1, 1, 1]
    scene.indexWidth = 32
    scene.palette = Array.from({ length: 65537 }, () => example.palette[1])
    scene.palette[0] = example.palette[0]
    scene.sources = [{ id: 4294967295, element: 'large' }]
    scene.chunks = [{ at: [0, 0, 0], blocks: 'AAABAA==', sources: '/////w==' }]
    const result = decodeScene(scene)
    expect(result.chunks[0].blocks[0]).toBe(65536)
    expect(result.chunks[0].sources[0]).toBe(4294967295)
  })
  it.each([
    ['版', (s: typeof example) => { s.formatVersion = 2 }],
    ['base64', (s: typeof example) => { s.chunks[0].blocks = '!!!!' }],
    ['配列長', (s: typeof example) => { s.chunks[0].blocks = 'AAA=' }],
    ['palette 参照', (s: typeof example) => { s.chunks[0].blocks = 'AAADAAEAAAA=' }],
    ['palette 0 の状態', (s: typeof example) => { s.palette[0].state = 'minecraft:stone' }],
    ['palette 0 の描画', (s: typeof example) => { s.palette[0].render = 'model' }],
    ['fixed の色なし', (s: typeof example) => { delete s.palette[2].tintColor }],
    ['fixed の色の成分数', (s: typeof example) => { s.palette[2].tintColor = [0.5, 0] }],
    ['fixed 以外の色', (s: typeof example) => { s.palette[2].tint = 'foliage' }],
    ['生成元参照', (s: typeof example) => { s.sources = [] }],
    ['チャンク重複', (s: typeof example) => { s.chunks.push(s.chunks[0]) }],
    ['チャンク境界', (s: typeof example) => { s.chunks[0].at = [1, 0, 0] }],
    ['ビット幅', (s: typeof example) => { s.indexWidth = 32 }],
    ['未知の属性', (s: typeof example) => { Object.assign(s, { unknown: true }) }],
  ])('%s の不正を拒否する', (_, mutate) => {
    const scene = structuredClone(example)
    mutate(scene)
    expect(() => decodeScene(scene)).toThrow()
  })
  it('破損 gzip と不正な UTF-8 を拒否する', async () => {
    await expect(loadScene(Uint8Array.of(0x1f, 0x8b))).rejects.toThrow()
    await expect(loadScene(Uint8Array.of(0xff))).rejects.toThrow()
  })
})

describe('固定 scene', () => {
  it.each(scenarios)('%s を生成・gzip 読み込み・検証できる', async name => {
    const scene = makeScene(name, name === 'representative' ? undefined : [32, 32, 32])
    const loaded = await loadScene(gzipSync(JSON.stringify(scene)))
    expect(loaded.chunks.length).toBeGreaterThan(0)
    expect(loaded.document.size).toEqual(scene.size)
    expect(loaded.document.palette[0]).toEqual({ state: 'minecraft:air', render: 'invisible', opacity: 0, emission: 0, tint: 'none' })
    if (name === 'representative') {
      const used = new Set(loaded.chunks.flatMap(chunk => [...chunk.blocks]))
      for (const id of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18]) expect(used.has(id)).toBe(true)
      expect(loaded.document.blockEntities).toHaveLength(5)
    }
  })
  it('最大サイズ 256×128×256 の城を読み込める', async () => {
    const loaded = await loadScene(gzipSync(JSON.stringify(makeScene('castle'))))
    expect(loaded.document.size).toEqual([256, 128, 256])
    expect(loaded.chunks.length).toBeGreaterThan(100)
  }, 30000)
  it('同じ条件で同じ scene を生成する', () => {
    expect(makeScene('representative')).toEqual(makeScene('representative'))
  })
})

it('範囲外と省略チャンクをpalette 0の空気として扱う', () => {
  const scene = makeScene('terrain', [33, 1, 1])
  scene.chunks = scene.chunks.filter(chunk => chunk.at[0] !== 16)
  const loaded = { ...decodeScene(scene), sha256: '' }
  const access = new BlockAccess(loaded)
  expect(access.block(0, 0, 0)).not.toBe(0)
  expect(access.block(32, 0, 0)).not.toBe(0)
  for (const at of [[16, 0, 0], [-1, 0, 0], [33, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]] as [number, number, number][]) {
    expect(access.block(...at)).toBe(0)
    expect(loaded.document.palette[access.block(...at)].state).toBe('minecraft:air')
  }
})

it('deepslate のモデル解決を既定リソースパックなしで利用できる', () => {
  const definition = BlockDefinition.fromJson({ multipart: [
    { apply: { model: 'example:base' } },
    { when: { OR: [{ north: 'true' }, { east: 'true' }] }, apply: { model: 'example:side', y: 90, uvlock: true } },
  ] })
  expect(definition.getModelVariants({ north: 'true' })).toHaveLength(2)
  expect(definition.getModelVariants({ north: 'true' })[1]).toMatchObject({ uvlock: true, y: 90 })
})
