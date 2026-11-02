import { describe, expect, it, vi } from 'vitest'
import { BufferGeometry, Float32BufferAttribute, ShaderLib } from 'three'
import { propagateLight } from '../src/light/propagation'
import { lightVertices } from '../src/light/vertices'
import { lightMap, shadowResolution, sunAt } from '../src/light/environment'
import { loadLight } from '../src/light/load'
import { lightMaterial } from '../src/light/material'
import { BlockAccess, buildChunk } from '../src/mesh/chunk'
import { modelFaces, shapeOf } from '../src/mesh/models'
import type { LightInput } from '../src/light/propagation'
import type { LoadedScene, SceneDocument, Vec3 } from '../src/scene/types'

const palette = [{ opacity: 0, emission: 0 }, { opacity: 15, emission: 0 }, { opacity: 0, emission: 15 }, { opacity: 2, emission: 0 }, { opacity: 15, emission: 15 }]
function input(size: Vec3, points: [number, number, number, number][] = []): LightInput {
  const chunks: LightInput['chunks'] = []
  for (let y = 0; y < size[1]; y += 16) for (let z = 0; z < size[2]; z += 16) for (let x = 0; x < size[0]; x += 16) {
    const extent = [x, y, z].map((v, i) => Math.min(16, size[i] - v)) as Vec3
    const blocks = new Uint16Array(extent[0] * extent[1] * extent[2])
    points.forEach(([px, py, pz, id]) => {
      if (px >= x && px < x + extent[0] && py >= y && py < y + extent[1] && pz >= z && pz < z + extent[2]) blocks[((py - y) * extent[2] + pz - z) * extent[0] + px - x] = id
    })
    chunks.push({ at: [x, y, z], size: extent, blocks })
  }
  return { size, chunks, palette }
}

describe('光の伝播', () => {
  it('上空15から透明な列を減衰なしに照らし、不透明な屋根で遮る', () => {
    expect([...propagateLight(input([1, 4, 1])).sky]).toEqual([15, 15, 15, 15])
    expect([...propagateLight(input([1, 4, 1], [[0, 2, 0, 1]])).sky]).toEqual([0, 0, 0, 15])
    expect([...propagateLight(input([1, 4, 1], [[0, 2, 0, 3]])).sky]).toEqual([11, 12, 13, 15])
  })
  it('屋根の開口から横へ回り込み、BFSの光は進むごとに減衰する', () => {
    const result = propagateLight(input([4, 2, 1], [[1, 1, 0, 1], [2, 1, 0, 1], [3, 1, 0, 1]]))
    expect([...result.sky].slice(0, 4)).toEqual([15, 14, 13, 12])
  })
  it('光源から6方向へ広がり、不透明壁・部分不透明度・距離で減衰する', () => {
    expect([...propagateLight(input([6, 1, 1], [[0, 0, 0, 2], [2, 0, 0, 3], [4, 0, 0, 1]])).block]).toEqual([15, 14, 12, 11, 0, 0])
    const result = propagateLight(input([3, 3, 3], [[1, 1, 1, 2]]))
    for (const index of [4, 10, 12, 14, 16, 22]) expect(result.block[index]).toBe(14)
    expect(result.block[0]).toBe(12)
  })
  it('不透明な発光体も外へ照らし、チャンク境界・省略チャンク・端の実寸を扱う', () => {
    const data = input([33, 1, 1], [[15, 0, 0, 4], [32, 0, 0, 2]])
    data.chunks.splice(1, 1)
    const before = [...data.chunks[0].blocks]
    const result = propagateLight(data)
    expect(result.block[16]).toBe(14)
    expect(result.block[29]).toBe(12)
    expect(result.block[32]).toBe(15)
    expect([...data.chunks[0].blocks]).toEqual(before)
    expect(result.sky[32]).toBe(15)
  })
  it('横端で行を跨がず、下端・外周から光を流入させない', () => {
    const result = propagateLight(input([3, 1, 2], [[0, 0, 1, 2], [1, 0, 0, 1], [1, 0, 1, 1]]))
    expect(result.block[2]).toBe(0)
    expect(result.block[3]).toBe(15)
    expect([...propagateLight(input([1, 1, 1], [[0, 0, 0, 1]])).sky]).toEqual([0])
  })
})

function vertex(position: Vec3, owner: Vec3 = [1, 0, 1], normal: Vec3 = [0, 1, 0]) {
  const geometry = new BufferGeometry()
  for (const [name, value] of Object.entries({ position, blockPosition: owner, normal, light: [15, 0, 1] })) geometry.setAttribute(name, new Float32BufferAttribute(value, 3))
  return geometry
}
describe('頂点のスムースライティングとAO', () => {
  it('面の4近傍を補間し、非表示のAO遮蔽物を除く', () => {
    const volume = propagateLight(input([3, 3, 3], [[0, 1, 1, 1], [1, 1, 0, 1], [0, 1, 0, 1]]))
    const geometry = vertex([1, 1, 1])
    lightVertices(geometry, volume, { minY: 0, maxY: 2 })
    const light = geometry.getAttribute('light')
    expect(light.getX(0)).toBeCloseTo(15 / 4)
    expect(light.getZ(0)).toBeCloseTo(0.4)
    lightVertices(geometry, volume, { minY: 0, maxY: 0 })
    expect(light.getZ(0)).toBe(1)
    expect((light as Float32BufferAttribute).version).toBe(2)
  })
  it('部分モデルの面は所有ブロックの外を読み、発光体自身の光を保つ', () => {
    const volume = propagateLight(input([3, 3, 3], [[1, 0, 1, 4]]))
    const geometry = vertex([1.5, 0.5, 1.5])
    lightVertices(geometry, volume, { minY: 0, maxY: 2 })
    expect(geometry.getAttribute('light').getX(0)).toBe(15)
    expect(geometry.getAttribute('light').getY(0)).toBe(15)
    const top = vertex([1.5, 3, 1.5], [1, 2, 1])
    lightVertices(top, volume, { minY: 0, maxY: 2 })
    expect(top.getAttribute('light').getX(0)).toBe(15)
  })
})

describe('時刻・明るさ・プレビュー設定', () => {
  it('既存メッシュのtintを再利用し、線形RGBの着色と光属性を別に保つ', () => {
    const data = input([1, 1, 1], [[0, 0, 0, 1]])
    const loaded = { document: { size: data.size, palette: data.palette.map(entry => ({ ...entry, render: 'model', tint: 'grass' })),
      environment: { tints: { grass: { l: 0.7, a: -0.1, b: 0.12 } } } }, chunks: data.chunks } as unknown as LoadedScene
    const shape = shapeOf(modelFaces({ textures: { all: 'test' }, elements: [{ from: [0, 0, 0], to: [16, 16, 16],
      faces: { up: { texture: '#all', tintindex: 0 } } }] }, { model: 'test' }))
    const built = buildChunk(loaded.chunks[0], new BlockAccess(loaded), [undefined, () => shape], {
      tiles: new Map([['minecraft:test', { layer: 'opaque', u: 0, v: 0, width: 1, height: 1 }]]) }, { minY: 0, maxY: 0 })!
    const geometry = built.geometries.get('opaque')!
    const color = [...geometry.getAttribute('color').array]
    lightVertices(geometry, propagateLight(data), { minY: 0, maxY: 0 })
    expect([...geometry.getAttribute('color').array]).toEqual(color)
    expect(color[1]).toBeGreaterThan(color[0])
    expect(color[1]).toBeGreaterThan(color[2])
  })
  it('昼は太陽が上、夜は下になり、24000tickで循環する', () => {
    expect(sunAt(6000).daylight).toBe(1)
    expect(sunAt(18000).daylight).toBe(0)
    expect(sunAt(18000).direction.y).toBeLessThan(0)
    expect(sunAt(30000)).toEqual(sunAt(6000))
    expect(sunAt(6000).sky.getHex()).not.toBe(sunAt(18000).sky.getHex())
  })
  it('夜は暗く、brightnessで暗部を持ち上げ、blockLight=falseで発光を消す', () => {
    const day = lightMap(0.5, 1, true).image.data!
    const night = lightMap(0.5, 0, true).image.data!
    const bright = lightMap(1, 0, true).image.data!
    const disabled = lightMap(0.5, 0, false).image.data!
    expect(day[15 * 4]).toBeGreaterThan(night[15 * 4])
    expect(bright[0]).toBeGreaterThan(night[0])
    expect(night[(15 * 16) * 4]).toBeGreaterThan(night[0])
    expect(disabled[(15 * 16) * 4]).toBe(disabled[0])
  })
  it('lowとautoは影なし、mediumは2048、highは4096', () => {
    const preview = (quality: string, shadows = true) => ({ quality, shadows }) as SceneDocument['preview']
    expect(['low', 'auto', 'medium', 'high'].map(q => shadowResolution(preview(q)))).toEqual([0, 0, 2048, 4096])
    expect(shadowResolution(preview('high', false))).toBe(0)
  })
  it('固定版の標準シェーダーに光属性とshadow maskを接続する', () => {
    const shader = { vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader, uniforms: {} }
    const material = lightMaterial({}, lightMap(0.5, 1, true))
    material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], {} as Parameters<typeof material.onBeforeCompile>[1])
    expect(shader.vertexShader).toContain('vVoxelLight = light;')
    expect(shader.fragmentShader).toContain('getShadowMask()')
    expect(shader.fragmentShader).not.toContain('reflectedLight.directDiffuse +')
  })
})

describe('Workerの境界', () => {
  it('元のブロック配列を転送せず、結果受信でWorkerを終了する', async () => {
    const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null as unknown }
    vi.stubGlobal('Worker', class { constructor() { return worker } })
    try {
      const data = input([1, 1, 1])
      const promise = loadLight({ document: data, chunks: data.chunks } as unknown as LoadedScene)
      expect(worker.postMessage).toHaveBeenCalledWith(data)
      const result = propagateLight(data)
      ;(worker.onmessage as (event: { data: unknown }) => void)({ data: result })
      expect(await promise).toBe(result)
      expect(worker.terminate).toHaveBeenCalledOnce()
    } finally { vi.unstubAllGlobals() }
  })
  it('Worker失敗を呼び出し元へ返して終了する', async () => {
    const worker = { postMessage: vi.fn(), terminate: vi.fn(), onerror: null as unknown }
    vi.stubGlobal('Worker', class { constructor() { return worker } })
    try {
      const data = input([1, 1, 1])
      const promise = loadLight({ document: data, chunks: data.chunks } as unknown as LoadedScene)
      ;(worker.onerror as (event: { message: string }) => void)({ message: '計算エラー' })
      await expect(promise).rejects.toThrow('計算エラー')
      expect(worker.terminate).toHaveBeenCalledOnce()
    } finally { vi.unstubAllGlobals() }
  })
})
