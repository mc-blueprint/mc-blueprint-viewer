import { describe, expect, it, vi } from 'vitest'
import type { Direction } from 'deepslate/core'
import { CanvasTexture, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { chooseWeighted, directions, loadModels, lockUV, modelFaces, selectModels, shapeOf, variantRotation } from '../src/mesh/models'
import type { ModelShape } from '../src/mesh/models'
import { BlockAccess, blockFromIntersection, buildChunk } from '../src/mesh/chunk'
import { MeshWorld } from '../src/mesh/world'
import type { Atlas } from '../src/mesh/atlas'
import type { LoadedScene, PaletteEntry, Vec3 } from '../src/scene/types'

const cube = { textures: { all: 'minecraft:block/test' }, elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: Object.fromEntries(directions.map(side => [side, { texture: '#all', cullface: side as Direction }])) }] }
const shape = shapeOf(modelFaces(cube, { model: 'test' }))
const atlas = { tiles: new Map([['minecraft:block/test', { u: 0, v: 0, width: 1, height: 1, layer: 'opaque' as const }]]) }
const palette: PaletteEntry[] = [
  { state: 'minecraft:air', render: 'invisible', opacity: 0, emission: 0, tint: 'none' },
  { state: 'minecraft:test', render: 'model', opacity: 15, emission: 0, tint: 'none' },
]
function scene(size: Vec3, points: Vec3[]): LoadedScene {
  const chunks = new Map<string, LoadedScene['chunks'][number]>()
  for (const point of points) {
    const at = point.map(v => Math.floor(v / 16) * 16) as Vec3
    const key = at.join(',')
    if (!chunks.has(key)) {
      const extent = at.map((v, i) => Math.min(16, size[i] - v)) as Vec3
      chunks.set(key, { at, size: extent, blocks: new Uint16Array(extent[0] * extent[1] * extent[2]), sources: new Uint32Array(extent[0] * extent[1] * extent[2]) })
    }
    const chunk = chunks.get(key)!
    chunk.blocks[((point[1] - at[1]) * chunk.size[2] + point[2] - at[2]) * chunk.size[0] + point[0] - at[0]] = 1
  }
  return { document: { size, palette, environment: { biome: 'plains' }, preview: { quality: 'low' } }, chunks: [...chunks.values()], sha256: '' } as LoadedScene
}
function build(loaded: LoadedScene, minY = 0, maxY = Infinity, models: ModelShape = shape) {
  return loaded.chunks.map(chunk => buildChunk(chunk, new BlockAccess(loaded), [undefined, () => models], atlas, { minY, maxY })!)
}

describe('モデル・回転', () => {
  it('空の variant と multipart の AND/OR・値ORを deepslate で解決する', () => {
    expect(selectModels({ variants: { '': { model: 'cube' } } }, {}, [0, 0, 0])).toEqual([{ model: 'cube' }])
    const data = { multipart: [
      { apply: { model: 'post' } },
      { when: { AND: [{ east: 'true' }, { OR: [{ north: 'true|maybe' }, { west: 'true' }] }] }, apply: { model: 'arm', y: 90 } },
    ] }
    expect(selectModels(data, { east: 'true', north: 'maybe' }, [0, 0, 0]).map(v => v.model)).toEqual(['post', 'arm'])
    expect(selectModels(data, { east: 'false' }, [0, 0, 0]).map(v => v.model)).toEqual(['post'])
  })
  it('重み付き選択は決定的で、位置と重みを反映する', () => {
    const choices = [{ model: 'a', weight: 1 }, { model: 'b', weight: 3 }]
    const values = Array.from({ length: 1000 }, (_, x) => chooseWeighted(choices, [x, 2, 3]).model)
    expect(chooseWeighted(choices, [23, 2, 3])).toEqual(chooseWeighted(choices, [23, 2, 3]))
    expect(values.filter(v => v === 'b').length).toBeGreaterThan(650)
    expect(values.filter(v => v === 'b').length).toBeLessThan(850)
  })
  it('モデルの Y 回転で北面が東へ、X 回転で上面が北へ移る', () => {
    const north = { ...cube, elements: [{ ...cube.elements[0], faces: { north: cube.elements[0].faces.north } }] }
    const rotated = modelFaces(north, { model: 'cube', y: 90 })[0]
    expect(rotated.cull).toBe('east')
    expect(rotated.positions.every(p => Math.abs(p[0] - 1) < 1e-6)).toBe(true)
    const up = { ...cube, elements: [{ ...cube.elements[0], faces: { up: cube.elements[0].faces.up } }] }
    expect(modelFaces(up, { model: 'cube', x: 90 })[0].cull).toBe('north')
  })
  it('uvlock は切り出した UV もタイル中心の周りで補正する', () => {
    expect(lockUV([0.25, 0], 'up', variantRotation({ model: '', y: 90 }))[0]).toBeCloseTo(1)
    expect(lockUV([0.25, 0], 'up', variantRotation({ model: '', y: 90 }))[1]).toBeCloseTo(0.25)
    expect(lockUV([0.25, 0.75], 'north', variantRotation({ model: '', y: 90 }))).toEqual([0.25, 0.75])
    const model = { ...cube, elements: [{ ...cube.elements[0], faces: { up: { texture: '#all', uv: [0, 0, 4, 8] as [number, number, number, number] } } }] }
    const face = modelFaces(model, { model: '', y: 90, uvlock: true })[0]
    face.uv.flat().forEach((value, i) => expect(value).toBeCloseTo([0.5, 0, 0.5, 0.25, 1, 0.25, 1, 0][i]))
  })
  it('非同期の親モデル継承とテクスチャ上書きを解決し、特殊描画のアセットを取得しない', async () => {
    const resources: Record<string, unknown> = {
      '/api/assets/test/assets/test/blockstates/block.json': { variants: { '': [{ model: 'test:child' }, { model: 'test:child', y: 90, uvlock: true }] } },
      '/api/assets/test/assets/test/models/child.json': { parent: 'test:root', textures: { all: 'minecraft:block/child' } },
      '/api/assets/test/assets/test/models/root.json': cube,
    }
    const fetch = vi.fn(async (url: string) => Response.json(resources[url] ?? {}, { status: resources[url] ? 200 : 404 }))
    vi.stubGlobal('location', { hash: '' })
    vi.stubGlobal('fetch', fetch)
    try {
      const loaded = await loadModels([palette[0], { ...palette[1], state: 'test:block' }, { ...palette[1], render: 'fluid' }], 'test')
      expect(loaded.entries[0]).toBeUndefined()
      expect(loaded.entries[2]).toBeUndefined()
      const selected = loaded.entries[1]!([4, 5, 6])
      expect(loaded.entries[1]!([4, 5, 6])).toBe(selected)
      expect(selected.faces).toHaveLength(6)
      expect(loaded.textures).toEqual(['minecraft:block/child'])
      expect(fetch).toHaveBeenCalledTimes(3)
    } finally { vi.unstubAllGlobals() }
  })
})

describe('チャンクメッシュ・後続の境界', () => {
  it('描画距離外の常駐チャンクを解放し、距離を戻すと再構築する', async () => {
    const loaded = scene([65, 1, 1], [[0, 0, 0], [64, 0, 0]])
    const world = new MeshWorld(loaded, [undefined, () => shape], { ...atlas, texture: new CanvasTexture({} as HTMLCanvasElement), bytes: 4 } as Atlas)
    const camera = new Vector3(0, 0, 0)
    await world.update(camera)
    expect(world.stats.chunks).toBe(2)
    const far = (world.group.children[1].children[0] as Mesh).geometry
    const dispose = vi.spyOn(far, 'dispose')
    await world.update(camera, undefined, 16)
    expect(world.stats.chunks).toBe(1)
    expect(dispose).toHaveBeenCalledOnce()
    await world.update(camera)
    expect(world.stats.chunks).toBe(2)
    world.dispose()
  })
  it('チャンク境界の隣接不透明面を両側で省く', () => {
    const loaded = scene([17, 1, 1], [[15, 0, 0], [16, 0, 0]])
    expect(build(loaded).map(c => c.faces)).toEqual([5, 5])
    expect(new BlockAccess(loaded).block(16, 0, 0)).toBe(1)
  })
  it('断面と単一階で上下面を復元する', () => {
    const loaded = scene([1, 2, 1], [[0, 0, 0], [0, 1, 0]])
    expect(build(loaded)[0].faces).toBe(10)
    expect(build(loaded, 0, 0)[0].faces).toBe(6)
    expect(build(loaded, 1, 1)[0].faces).toBe(6)
  })
  it('境界を覆わないモデルを不透明度だけで遮蔽物と扱わない', () => {
    const partial = shapeOf(modelFaces({ ...cube, elements: [{ ...cube.elements[0], to: [8, 8, 8] }] }, { model: '' }))
    expect(partial.solid.size).toBe(0)
    expect(build(scene([2, 1, 1], [[0, 0, 0], [1, 0, 0]]), 0, 0, partial)[0].faces).toBe(12)
  })
  it('特殊描画を通常モデルに含めず、光属性とレイの所有座標を公開する', () => {
    const loaded = scene([1, 1, 1], [[0, 0, 0]])
    const result = build(loaded)[0]
    const geometry = result.geometries.get('opaque')!
    expect(geometry.getAttribute('light').count).toBe(24)
    expect(Array.from(geometry.getAttribute('light').array).slice(0, 3)).toEqual([15, 0, 1])
    const mesh = new Mesh(geometry, new MeshBasicMaterial())
    mesh.updateMatrixWorld()
    const hit = new Raycaster(new Vector3(0.5, 0.5, 3), new Vector3(0, 0, -1)).intersectObject(mesh)[0]
    expect(blockFromIntersection(hit)).toEqual([0, 0, 0])
    const empty = buildChunk(loaded.chunks[0], new BlockAccess(loaded), [undefined, undefined], atlas, { minY: 0, maxY: 0 })!
    expect(empty.faces).toBe(0)
  })
  it('上限で遠方を捨て、カメラ移動時に近い側へ入れ替えて dispose する', async () => {
    const loaded = scene([33, 1, 1], [[0, 0, 0], [32, 0, 0]])
    const world = new MeshWorld(loaded, [undefined, () => shape], { ...atlas, texture: new CanvasTexture({} as HTMLCanvasElement), bytes: 4 } as Atlas, 6)
    await world.update(new Vector3(0, 0, 0))
    expect(world.stats.faces).toBe(6)
    expect(world.group.children.length).toBe(1)
    const geometry = (world.group.children[0].children[0] as Mesh).geometry
    const dispose = vi.spyOn(geometry, 'dispose')
    await world.update(new Vector3(33, 0, 0))
    expect(dispose).toHaveBeenCalledOnce()
    expect((world.group.children[0].children[0] as Mesh).geometry.getAttribute('blockPosition').getX(0)).toBe(32)
    world.dispose()
    expect(world.stats.faces).toBe(0)
  })
})
