import { describe, expect, it } from 'vitest'
import { CanvasTexture, Mesh, Vector3 } from 'three'
import { makeScene } from '../scripts/generate-scenes.mjs'
import type { LoadedScene } from '../src/scene/types'
import { bedUV, chestSides, chestTexture, fluidHeight, SpecialWorld, specialTextures, unsupportedEntityIds, visibleFluidSides } from '../src/special/world'
import type { Atlas } from '../src/mesh/atlas'
import { propagateLight } from '../src/light/propagation'
import { lightMap } from '../src/light/environment'

function loadedFixture(): LoadedScene {
  const document = makeScene()
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
  it('facingごとにUVの向きを回し、headとfootで上面の領域を分ける', () => {
    const directions = ['north', 'east', 'south', 'west']
    expect(new Set(directions.map(facing => JSON.stringify(bedUV('up', facing, 'head')))).size).toBe(4)
    expect(bedUV('up', 'north', 'head')).not.toEqual(bedUV('up', 'north', 'foot'))
  })
})

describe('特殊描画のアセットと未対応一覧', () => {
  it('流体とエンティティも描画距離で除外し、距離を戻すと復元する', () => {
    const loaded = loadedFixture()
    const atlas: Atlas = { texture: new CanvasTexture({} as HTMLCanvasElement), bytes: 4,
      tiles: new Map(specialTextures(loaded).map(id => [id, { u: 0, v: 0, width: 1, height: 1, layer: 'opaque' as const }])) }
    const light = propagateLight({ ...loaded.document, chunks: loaded.chunks })
    const texture = lightMap(0.5, 1, true)
    const world = new SpecialWorld(loaded, atlas, light, texture)
    const slice = { minY: 0, maxY: 15 }
    const count = () => (world.group.children[0] as Mesh).geometry.getAttribute('blockPosition').count
    world.update(slice)
    const all = count()
    const camera = new Vector3(16, 1, 3)
    world.update(slice, camera, 3)
    expect(count()).toBeGreaterThan(0)
    expect(count()).toBeLessThan(all)
    const owners = (world.group.children[0] as Mesh).geometry.getAttribute('blockPosition')
    for (let i = 0; i < owners.count; i++) expect(camera.distanceTo(new Vector3().fromBufferAttribute(owners, i))).toBeLessThanOrEqual(3)
    world.update(slice)
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
