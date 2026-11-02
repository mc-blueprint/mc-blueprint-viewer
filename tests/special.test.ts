import { describe, expect, it, vi } from 'vitest'
import { BufferGeometry, CanvasTexture, Mesh, Vector3 } from 'three'
import { makeScene } from '../scripts/generate-scenes.mjs'
import type { LoadedScene, Vec3 } from '../src/scene/types'
import { bedUV, chestSides, chestTexture, fluidHeight, SpecialWorld, specialTextures, unsupportedEntityIds, visibleFluidSides } from '../src/special/world'
import type { Atlas } from '../src/mesh/atlas'
import { propagateLight } from '../src/light/propagation'
import { lightMap } from '../src/light/environment'
import { usesBlockModel } from '../src/mesh/models'
import { MeshWorld } from '../src/mesh/world'
import { faceLimits, tintColor } from '../src/mesh/chunk'

function loadedFixture(): LoadedScene {
  const document = structuredClone(makeScene())
  const chunks = document.chunks.map(chunk => {
    const size = [0, 1, 2].map(axis => Math.min(16, document.size[axis] - chunk.at[axis])) as [number, number, number]
    const blockBytes = Buffer.from(chunk.blocks, 'base64')
    const blocks = Uint16Array.from({ length: blockBytes.length / 2 }, (_, index) => blockBytes.readUInt16LE(index * 2))
    const sourceBytes = Buffer.from(chunk.sources, 'base64')
    const sources = Uint32Array.from({ length: sourceBytes.length / 4 }, (_, index) => sourceBytes.readUInt32LE(index * 4))
    return { at: chunk.at as [number, number, number], size, blocks, sources }
  })
  return { document, chunks, sha256: '' } as unknown as LoadedScene
}

describe('流体の特殊描画', () => {
  it('水源の上面高さは上の同種流体の有無で変わる', () => {
    expect(fluidHeight(0, false)).toBeCloseTo(8 / 9)
    expect(fluidHeight(0, true)).toBe(1)
  })

  it('流れの高さをlevelから求める', () => {
    expect(fluidHeight(1, false)).toBe(7 / 8)
    expect(fluidHeight(7, false)).toBe(1 / 8)
  })

  it('同じ流体に接した上面と側面を省く', () => {
    expect(visibleFluidSides(new Set(['up', 'east']))).toEqual(['north', 'south', 'west'])
  })
})

describe('チェストのassetと向き', () => {
  it('単体・左右の通常チェストとtrapped chestの画像を選ぶ', () => {
    expect(chestTexture('minecraft:chest', 'minecraft:chest[type=single]')).toBe('minecraft:entity/chest/normal')
    expect(chestTexture('minecraft:chest', 'minecraft:chest[type=left]')).toBe('minecraft:entity/chest/normal_left')
    expect(chestTexture('minecraft:chest', 'minecraft:chest[type=right]')).toBe('minecraft:entity/chest/normal_right')
    expect(chestTexture('minecraft:chest', 'minecraft:trapped_chest[type=left]')).toBe('minecraft:entity/chest/trapped_left')
    expect(chestTexture('minecraft:trapped_chest', 'minecraft:trapped_chest[type=right]')).toBe('minecraft:entity/chest/trapped_right')
  })

  it('ender chestは2連画像を使わず単体画像を選ぶ', () => {
    expect(chestTexture('minecraft:ender_chest', 'minecraft:ender_chest[type=single]')).toBe('minecraft:entity/chest/ender')
    expect(chestTexture('minecraft:ender_chest', 'minecraft:ender_chest[type=left]')).toBe('minecraft:entity/chest/ender')
  })

  it('向きごとに前面を向ける面順を返す', () => {
    expect(['north', 'east', 'south', 'west'].map(facing => chestSides(facing)[0])).toEqual(['north', 'east', 'south', 'west'])
  })
})

describe('ベッドの状態と向き', () => {
  it.each(['26.2', '26.3'])('%sのベッドは通常モデルを使い、旧テクスチャや特殊描画を重複させない', async version => {
    const loaded = loadedFixture()
    loaded.document.minecraftVersion = version
    const bed = loaded.document.palette.find(p => p.state.includes('red_bed'))!
    expect(usesBlockModel(bed, version)).toBe(true)
    expect(usesBlockModel(bed, '1.21.11')).toBe(false)
    expect(usesBlockModel(bed, '26.1.2')).toBe(false)
    expect(specialTextures(loaded)).not.toContain('minecraft:entity/bed/red')
    const atlas: Atlas = { texture: new CanvasTexture({} as HTMLCanvasElement), bytes: 4,
      tiles: new Map(specialTextures(loaded).map(id => [id, { u: 0, v: 0, width: 1, height: 1, layer: 'opaque' as const }])) }
    const light = propagateLight({ ...loaded.document, chunks: loaded.chunks })
    const texture = lightMap(0.5, 1, true)
    const special = new SpecialWorld(loaded, atlas, light, texture)
    const world = new MeshWorld(loaded, [], atlas, undefined, undefined, special)
    await world.update(new Vector3(), { minY: 0, maxY: 15 })
    world.group.traverse(object => {
      if (!(object instanceof Mesh)) return
      const owners = object.geometry.getAttribute('blockPosition')
      for (let i = 0; i < owners.count; i++) expect(owners.getX(i)).not.toBe(22)
    })
    world.dispose(); texture.dispose(); atlas.texture.dispose()
  })
  it('facingごとにUVの向きを回し、headとfootで上面の領域を分ける', () => {
    const directions = ['north', 'east', 'south', 'west']
    expect(new Set(directions.map(facing => JSON.stringify(bedUV('up', facing, 'head')))).size).toBe(4)
    expect(bedUV('up', 'north', 'head')).not.toEqual(bedUV('up', 'north', 'foot'))
  })
})

describe('特殊描画のアセットと未対応一覧', () => {
  it.each([
    ['minecraft:chest', 12, 18], ['minecraft:bed', 13, 18], ['minecraft:sign', 12, 6],
  ] as const)('%sの面も予算に含め、境界ちょうどだけを構築する', (id, paletteId, faces) => {
    const loaded = loadedFixture()
    loaded.chunks.forEach(chunk => chunk.blocks.fill(0))
    loaded.chunks[0].blocks[0] = paletteId
    loaded.document.blockEntities = [{ at: [0, 0, 0], id }]
    const atlas: Atlas = { texture: new CanvasTexture({} as HTMLCanvasElement), bytes: 4,
      tiles: new Map(specialTextures(loaded).map(id => [id, { u: 0, v: 0, width: 1, height: 1, layer: 'opaque' as const }])) }
    const texture = lightMap(0.5, 1, true)
    const special = new SpecialWorld(loaded, atlas, propagateLight({ ...loaded.document, chunks: loaded.chunks }), texture)
    const slice = { minY: 0, maxY: 15 }
    expect(special.buildChunk(loaded.chunks[0], slice, faces - 1)).toBeUndefined()
    const built = special.buildChunk(loaded.chunks[0], slice, faces)!
    expect(built.faces).toBe(faces)
    built.group.traverse(object => {
      if (object instanceof Mesh) {
        expect(object.castShadow).toBe(true)
        expect(object.receiveShadow).toBe(true)
      }
    })
    built.geometries.forEach(geometry => geometry.dispose())
    special.dispose(); texture.dispose(); atlas.texture.dispose()
  })

  it.each(['1.21.11', '26.1.2'])('%sで赤・青のベッドを同時に構築し影を有効にする', version => {
    const loaded = loadedFixture()
    loaded.document.minecraftVersion = version
    const blue = loaded.document.palette.findIndex(entry => entry.state.includes('part=head') && entry.state.includes('red_bed'))
    loaded.document.palette[blue] = { ...loaded.document.palette[blue], state: 'minecraft:blue_bed[part=head,facing=north]' }
    const textures = specialTextures(loaded)
    expect(textures).toEqual(expect.arrayContaining(['minecraft:entity/bed/red', 'minecraft:entity/bed/blue']))
    const atlas: Atlas = { texture: new CanvasTexture({} as HTMLCanvasElement), bytes: 4,
      tiles: new Map(textures.map(id => [id, { u: 0, v: 0, width: 1, height: 1, layer: 'opaque' as const }])) }
    const texture = lightMap(0.5, 1, true)
    const special = new SpecialWorld(loaded, atlas, propagateLight({ ...loaded.document, chunks: loaded.chunks }), texture)
    const built = loaded.chunks.map(chunk => special.buildChunk(chunk, { minY: 0, maxY: 15 }, Infinity)!)
    expect(built.reduce((n, chunk) => n + chunk.faces, 0)).toBeGreaterThan(0)
    for (const chunk of built) {
      chunk.group.traverse(object => {
        if (object instanceof Mesh) {
          expect(object.castShadow).toBe(true)
          expect(object.receiveShadow).toBe(true)
        }
      })
      chunk.geometries.forEach(geometry => geometry.dispose())
    }
    special.dispose(); texture.dispose(); atlas.texture.dispose()
  })

  it('水の頂点色へsceneのOklab乗算色を反映し、半透明の影設定を通常描画に合わせる', () => {
    const loaded = loadedFixture()
    const atlas: Atlas = { texture: new CanvasTexture({} as HTMLCanvasElement), bytes: 4,
      tiles: new Map(specialTextures(loaded).map(id => [id, { u: 0, v: 0, width: 1, height: 1,
        layer: id.includes('water') ? 'translucent' as const : 'opaque' as const }])) }
    const texture = lightMap(0.5, 1, true)
    const special = new SpecialWorld(loaded, atlas, propagateLight({ ...loaded.document, chunks: loaded.chunks }), texture)
    const colors = []
    for (const tint of [{ l: 0.5, a: 0, b: -0.15 }, { l: 0.8, a: 0, b: 0 }]) {
      loaded.document.environment.tints!.water = tint
      const built = special.buildChunk(loaded.chunks[0], { minY: 0, maxY: 15 }, Infinity)!
      const water = built.group.children.find(object => object instanceof Mesh && (object.material as import('three').Material).transparent) as Mesh
      expect(water.castShadow).toBe(false)
      expect(water.receiveShadow).toBe(true)
      const color = Array.from(water.geometry.getAttribute('color').array).slice(0, 3)
      tintColor(tint.l, tint.a, tint.b).forEach((value, i) => expect(color[i]).toBeCloseTo(value))
      colors.push(color)
      built.geometries.forEach(geometry => geometry.dispose())
    }
    expect(colors[0]).not.toEqual(colors[1])
    special.dispose(); texture.dispose(); atlas.texture.dispose()
  })

  it('256×128×256の市松状の水を既定lowの面数上限内に収める', async () => {
    const loaded = loadedFixture()
    loaded.document.size = [256, 128, 256]
    loaded.document.blockEntities = []
    const waterId = loaded.document.palette.findIndex(entry => entry.state.startsWith('minecraft:water'))
    loaded.chunks = []
    for (let y = 0; y < 128; y += 16) for (let z = 0; z < 256; z += 16) for (let x = 0; x < 256; x += 16) {
      const blocks = Uint16Array.from({ length: 4096 }, (_, i) => ((i % 16 + Math.floor(i / 16) % 16 + Math.floor(i / 256)) % 2 === 0 ? waterId : 0))
      loaded.chunks.push({ at: [x, y, z], size: [16, 16, 16], blocks, sources: new Uint32Array(4096) })
    }
    const atlas: Atlas = { texture: new CanvasTexture({} as HTMLCanvasElement), bytes: 4,
      tiles: new Map(specialTextures(loaded).map(id => [id, { u: 0, v: 0, width: 1, height: 1, layer: 'translucent' as const }])) }
    const size = loaded.document.size
    const count = size[0] * size[1] * size[2]
    const texture = lightMap(0.5, 1, true)
    const special = new SpecialWorld(loaded, atlas, { size, sky: new Uint8Array(count).fill(15), block: new Uint8Array(count), opacity: new Uint8Array(count) }, texture)
    const world = new MeshWorld(loaded, [], atlas, undefined, undefined, special)
    try {
      await world.update(new Vector3(8, 8, 8))
      expect(world.limit).toBe(faceLimits.low)
      expect(world.stats.faces).toBe(1_996_800)
      expect(world.stats.faces).toBeLessThanOrEqual(world.limit)
      expect(world.stats.chunks).toBe(195)
      expect(world.stats.meshBytes).toBeGreaterThan(0)
      const first = world.group.children[0].children[0].children[0] as Mesh
      const disposed = vi.spyOn(first.geometry, 'dispose')
      await world.update(new Vector3(248, 120, 248), undefined, 0)
      expect(disposed).toHaveBeenCalledOnce()
      expect(world.stats.chunks).toBe(1)
      expect(world.stats.faces).toBe(10240)
      await world.update(new Vector3(248, 120, 248), { minY: 120, maxY: 127 }, 0)
      expect(world.stats.faces).toBe(5120)
      world.group.traverse(object => {
        if (!(object instanceof Mesh)) return
        const owners = object.geometry.getAttribute('blockPosition')
        for (let i = 0; i < owners.count; i++) expect(owners.getY(i)).toBeGreaterThanOrEqual(120)
      })
    } finally { world.dispose(); texture.dispose() }
  }, 120000)

  it('通常面と特殊面の合計で予算を判定し、拒否した通常面の資源も解放する', async () => {
    const loaded = loadedFixture()
    loaded.document.size = [32, 16, 16]
    const atlas: Atlas = { texture: new CanvasTexture({} as HTMLCanvasElement), bytes: 4,
      tiles: new Map(specialTextures(loaded).map(id => [id, { u: 0, v: 0, width: 1, height: 1, layer: 'opaque' as const }])) }
    const texture = lightMap(0.5, 1, true)
    // 通常モデル1面と流体5面を同じチャンクに配置する。
    loaded.chunks[0].blocks.fill(0)
    loaded.chunks[0].blocks[0] = 1
    loaded.chunks[0].blocks[1] = 5
    loaded.document.blockEntities = []
    const special = new SpecialWorld(loaded, atlas, propagateLight({ ...loaded.document, chunks: loaded.chunks }), texture)
    const shapes = [undefined, () => ({ solid: new Set<never>(), faces: [{ texture: 'minecraft:block/water_still', tint: false,
      positions: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] as Vec3[], normal: [0, 0, -1] as Vec3, uv: [[0, 0], [0, 1], [1, 1], [1, 0]] as [number, number][] }] })]
    const world = new MeshWorld(loaded, shapes, atlas, 5, undefined, special)
    const dispose = vi.spyOn(BufferGeometry.prototype, 'dispose')
    try {
      await world.update(new Vector3())
      expect(world.stats.faces).toBe(0)
      expect(world.stats.chunks).toBe(0)
      expect(dispose).toHaveBeenCalledOnce()
    } finally { dispose.mockRestore(); world.dispose(); texture.dispose() }
  })

  it('流体とエンティティもチャンクの描画距離で解放し、距離を戻すと復元する', async () => {
    const loaded = loadedFixture()
    const atlas: Atlas = { texture: new CanvasTexture({} as HTMLCanvasElement), bytes: 4,
      tiles: new Map(specialTextures(loaded).map(id => [id, { u: 0, v: 0, width: 1, height: 1, layer: 'opaque' as const }])) }
    const light = propagateLight({ ...loaded.document, chunks: loaded.chunks })
    const texture = lightMap(0.5, 1, true)
    const special = new SpecialWorld(loaded, atlas, light, texture)
    const world = new MeshWorld(loaded, [], atlas, undefined, undefined, special)
    const slice = { minY: 0, maxY: 15 }
    const count = () => world.stats.faces
    await world.update(new Vector3(), slice)
    const all = count()
    const disposed = vi.fn()
    world.group.traverse(object => {
      if (!(object instanceof Mesh)) return
      object.geometry.addEventListener('dispose', disposed)
      expect(object.receiveShadow).toBe(true)
      expect(object.castShadow).toBe(true)
    })
    const camera = new Vector3(8, 8, 8)
    await world.update(camera, slice, 0)
    expect(count()).toBeGreaterThan(0)
    expect(count()).toBeLessThan(all)
    expect(disposed).toHaveBeenCalled()
    await world.update(camera, slice)
    expect(count()).toBe(all)
    world.dispose()
    texture.dispose()
    atlas.texture.dispose()
  })
  it('fixtureのfluid・単体/2連チェスト・bed向けテクスチャを選ぶ', () => {
    const loaded = loadedFixture()
    expect(specialTextures(loaded)).toEqual(expect.arrayContaining([
      'minecraft:block/water_still', 'minecraft:block/lava_still', 'minecraft:entity/bed/red',
      'minecraft:entity/chest/normal', 'minecraft:entity/chest/normal_left', 'minecraft:entity/chest/normal_right',
    ]))
  })

  it('未対応IDを重複なく整列して表示用に返す', () => {
    expect(unsupportedEntityIds(['minecraft:sign', 'minecraft:sign', 'minecraft:chest', 'minecraft:bed']))
      .toEqual(['minecraft:sign'])
  })
})
