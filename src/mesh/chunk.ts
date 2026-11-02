import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from 'three'
import type { Intersection } from 'three'
import type { DecodedChunk, LoadedScene, Vec3 } from '../scene/types'
import type { Atlas, Layer } from './atlas'
import { offsets } from './models'
import type { ModelShape, Side } from './models'

export interface Slice { minY: number; maxY: number }
export type Shapes = (((at: Vec3) => ModelShape) | undefined)[]
const opposite: Record<Side, Side> = { up: 'down', down: 'up', north: 'south', south: 'north', east: 'west', west: 'east' }
export const faceLimits = { low: 2_000_000, medium: 5_000_000, high: 10_000_000 }

/** scene ローカル座標で検索する。省略チャンク・範囲外は空気 (palette 0) とする。 */
export class BlockAccess {
  private chunks: Map<number, DecodedChunk>
  private width: number
  private depth: number
  constructor(readonly scene: LoadedScene) {
    this.width = Math.ceil(scene.document.size[0] / 16)
    this.depth = Math.ceil(scene.document.size[2] / 16)
    this.chunks = new Map(scene.chunks.map(c => [((c.at[1] / 16) * this.depth + c.at[2] / 16) * this.width + c.at[0] / 16, c]))
  }
  block(x: number, y: number, z: number): number {
    const size = this.scene.document.size
    if (x < 0 || y < 0 || z < 0 || x >= size[0] || y >= size[1] || z >= size[2]) return 0
    const chunk = this.chunks.get(((y >> 4) * this.depth + (z >> 4)) * this.width + (x >> 4))
    return chunk ? chunk.blocks[((y - chunk.at[1]) * chunk.size[2] + z - chunk.at[2]) * chunk.size[0] + x - chunk.at[0]] : 0
  }
}

function tintColor(l: number, a: number, b: number): number[] {
  const c = [l + 0.3963377774 * a + 0.2158037573 * b, l - 0.1055613458 * a - 0.0638541728 * b, l - 0.0894841775 * a - 1.291485548 * b].map(v => v ** 3)
  return [4.0767416621 * c[0] - 3.3077115913 * c[1] + 0.2309699292 * c[2], -1.2684380046 * c[0] + 2.6097574011 * c[1] - 0.3413193965 * c[2], -0.0041960863 * c[0] - 0.7034186147 * c[1] + 1.707614701 * c[2]].map(v => Math.max(0, Math.min(1, v)))
}

interface Buffers { position: number[]; normal: number[]; uv: number[]; color: number[]; blockPosition: number[]; index: number[] }
export interface ChunkMesh { geometries: Map<Layer, BufferGeometry>; faces: number; bytes: number }

/** y は両端を含む。上限を超えるチャンクは途中バッファを捨てて undefined を返す。GPU 資源は作らない。 */
export function buildChunk(chunk: DecodedChunk, access: BlockAccess, shapes: Shapes, atlas: Pick<Atlas, 'tiles'>, slice: Slice, limit = Infinity): ChunkMesh | undefined {
  const buffers = new Map<Layer, Buffers>()
  const { palette, environment } = access.scene.document
  const tints = palette.map(entry => {
    const value = entry.tint === 'none' || entry.tint === 'fixed' ? undefined : environment.tints?.[entry.tint]
    return value ? tintColor(value.l, value.a, value.b) : [1, 1, 1]
  })
  let faces = 0
  for (let y = 0; y < chunk.size[1]; y++) {
    const worldY = chunk.at[1] + y
    if (worldY < slice.minY || worldY > slice.maxY) continue
    for (let z = 0; z < chunk.size[2]; z++) for (let x = 0; x < chunk.size[0]; x++) {
      const id = chunk.blocks[(y * chunk.size[2] + z) * chunk.size[0] + x]
      const at: Vec3 = [chunk.at[0] + x, worldY, chunk.at[2] + z]
      const shape = shapes[id]?.(at)
      if (!shape) continue
      const hidden = new Set<Side>()
      for (const side of Object.keys(offsets) as Side[]) {
        const next = at.map((v, i) => v + offsets[side][i]) as Vec3
        if (next[1] < slice.minY || next[1] > slice.maxY) continue
        const neighbor = access.block(...next)
        if (palette[neighbor].render === 'model' && palette[neighbor].opacity === 15 && shapes[neighbor]?.(next).solid.has(opposite[side])) hidden.add(side)
      }
      for (const face of shape.faces) {
        if (face.cull && hidden.has(face.cull)) continue
        if (++faces > limit) return undefined
        const tile = atlas.tiles.get(face.texture)!
        if (!buffers.has(tile.layer)) buffers.set(tile.layer, { position: [], normal: [], uv: [], color: [], blockPosition: [], index: [] })
        const out = buffers.get(tile.layer)!
        const start = out.position.length / 3
        for (let v = 0; v < 4; v++) {
          out.position.push(...face.positions[v].map((p, i) => p + at[i]))
          out.normal.push(...face.normal)
          out.uv.push(tile.u + face.uv[v][0] * tile.width, tile.v + face.uv[v][1] * tile.height)
          out.color.push(...(face.tint ? tints[id] : [1, 1, 1]))
          out.blockPosition.push(...at)
        }
        out.index.push(start, start + 1, start + 2, start, start + 2, start + 3)
      }
    }
  }
  const geometries = new Map<Layer, BufferGeometry>()
  let bytes = 0
  for (const [layer, data] of buffers) {
    const geometry = new BufferGeometry()
    for (const name of ['position', 'normal', 'uv', 'color', 'blockPosition'] as const) {
      geometry.setAttribute(name, new Float32BufferAttribute(data[name], name === 'uv' ? 2 : 3))
    }
    // sky / block / AO。#3 が計算後に書き換え、シェーダーへ接続する。
    geometry.setAttribute('light', new Float32BufferAttribute(Array(data.position.length / 3).fill([15, 0, 1]).flat(), 3))
    geometry.setIndex(new Uint32BufferAttribute(data.index, 1))
    geometry.computeBoundingSphere()
    bytes += Object.values(geometry.attributes).reduce((sum, attr) => sum + attr.array.byteLength, 0) + geometry.index!.array.byteLength
    geometries.set(layer, geometry)
  }
  return { geometries, faces, bytes }
}

/** Raycaster の通常メッシュへの命中を、面を所有するブロックの整数座標へ戻す。 */
export function blockFromIntersection(hit: Intersection): Vec3 | undefined {
  if (!hit.face || !('geometry' in hit.object)) return undefined
  const geometry = hit.object.geometry as BufferGeometry
  const positions = geometry.getAttribute('blockPosition')
  return positions ? [positions.getX(hit.face.a), positions.getY(hit.face.a), positions.getZ(hit.face.a)] : undefined
}
