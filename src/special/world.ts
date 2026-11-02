import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshLambertMaterial } from 'three'
import type { DataTexture } from 'three'
import type { DecodedChunk, LoadedScene, SceneDocument, Vec3 } from '../scene/types'
import type { Atlas } from '../mesh/atlas'
import { BlockAccess, tintColor, type Slice } from '../mesh/chunk'
import type { ResidentChunk } from '../mesh/world'
import { lightMaterial } from '../light/material'
import { lightVertices } from '../light/vertices'
import { usesBlockModel } from '../mesh/models'
import type { LightVolume } from '../light/propagation'

const water = 'minecraft:block/water_still'
const lava = 'minecraft:block/lava_still'
const bedTexture = (color: string) => `minecraft:entity/bed/${color}`
const fluidSides = ['up', 'north', 'south', 'west', 'east'] as const
type FluidSide = typeof fluidSides[number]
const faces = [
  { side: 'up', points: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { side: 'down', points: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]] },
  { side: 'north', points: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
  { side: 'south', points: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { side: 'west', points: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { side: 'east', points: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
] as const

function geometry(quads: { at: Vec3; points: number[][]; tile: string; uv?: number[][]; color?: Vec3 }[], atlas: Atlas) {
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [], owners: number[] = [], indices: number[] = []
  for (const quad of quads) {
    const tile = atlas.tiles.get(quad.tile)
    if (!tile) continue
    const start = positions.length / 3
    quad.points.forEach((point, i) => {
      positions.push(...point.map((v, axis) => v + quad.at[axis]))
      const uv = quad.uv?.[i] ?? [[0, 0], [0, 1], [1, 1], [1, 0]][i]
      uvs.push(tile.u + uv[0] * tile.width, tile.v + uv[1] * tile.height)
      colors.push(...(quad.color ?? [1, 1, 1]))
      owners.push(...quad.at)
    })
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3)
  }
  const result = new BufferGeometry()
  result.setAttribute('position', new Float32BufferAttribute(positions, 3))
  result.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  result.setAttribute('color', new Float32BufferAttribute(colors, 3))
  result.setAttribute('blockPosition', new Float32BufferAttribute(owners, 3))
  result.setAttribute('light', new Float32BufferAttribute(Array(positions.length / 3).fill([15, 0, 1]).flat(), 3))
  result.setIndex(indices)
  result.computeVertexNormals()
  return result
}

function textureRegion(x: number, y: number, width: number, height: number) {
  return [[x / 64, y / 64], [x / 64, (y + height) / 64], [(x + width) / 64, (y + height) / 64], [(x + width) / 64, y / 64]]
}

function entityBox(at: Vec3, from: Vec3, to: Vec3, tile: string, regions: Record<string, number[][]>, facing: string) {
  const turns = ['north', 'east', 'south', 'west'].indexOf(facing)
  return faces.map(face => ({ at, tile, uv: regions[face.side], points: face.points.map(point => {
    const p = point.map((v, axis) => from[axis] + v * (to[axis] - from[axis]))
    let [x, z] = [p[0], p[2]]
    for (let i = 0; i < turns; i++) [x, z] = [1 - z, x]
    return [x, p[1], z]
  }) }))
}

function boxUV(u: number, v: number, width: number, height: number, depth: number) {
  const side = (x: number, w: number) => {
    const uv = textureRegion(x, v + depth, w, height)
    return [uv[1], uv[2], uv[3], uv[0]]
  }
  return { up: textureRegion(u + depth, v, width, depth), down: textureRegion(u + depth + width, v, width, depth),
    north: side(u + depth, width), south: side(u + depth * 2 + width, width), east: side(u, depth), west: side(u + depth + width, depth) }
}

function boxGeometry(at: Vec3, owner: Vec3) {
  const positions = faces.flatMap(face => face.points.flatMap(point => point.map((v, axis) => at[axis] + v * 0.8)))
  const owners = faces.flatMap(face => face.points.flatMap(() => owner))
  const indices = faces.flatMap((_, face) => {
    const start = face * 4
    return [start, start + 1, start + 2, start, start + 2, start + 3]
  })
  const result = new BufferGeometry()
  result.setAttribute('position', new Float32BufferAttribute(positions, 3))
  result.setAttribute('blockPosition', new Float32BufferAttribute(owners, 3))
  result.setAttribute('light', new Float32BufferAttribute(Array(positions.length / 3).fill([15, 0, 1]).flat(), 3))
  result.setIndex(indices)
  result.computeVertexNormals()
  return result
}

function state(entry: string) {
  return Object.fromEntries((entry.match(/\[([^\]]*)\]/)?.[1] ?? '').split(',').filter(Boolean).map(part => part.split('=')))
}

export function fluidHeight(level: number, sameFluidAbove: boolean) {
  if (level === 0) return sameFluidAbove ? 1 : 8 / 9
  if (level >= 8) return 1
  return (8 - level) / 8
}

export function visibleFluidSides(sameFluidNeighbors: ReadonlySet<FluidSide>) {
  return fluidSides.filter(side => !sameFluidNeighbors.has(side))
}

export function chestTexture(blockEntityId: string, blockState: string) {
  const name = blockState.split('[')[0].split(':').at(-1) ?? ''
  const entity = blockEntityId.split(':').at(-1) ?? ''
  if (name === 'ender_chest' || entity === 'ender_chest') return 'minecraft:entity/chest/ender'
  const kind = name === 'trapped_chest' || entity === 'trapped_chest' ? 'trapped' : 'normal'
  const type = state(blockState).type
  const half = type === 'left' || type === 'right' ? `_${type}` : ''
  return `minecraft:entity/chest/${kind}${half}`
}

export function chestSides(facing: string) {
  const sides: Record<string, string[]> = {
    north: ['north', 'east', 'south', 'west'], east: ['east', 'south', 'west', 'north'],
    south: ['south', 'west', 'north', 'east'], west: ['west', 'north', 'east', 'south'],
  }
  return sides[facing] ?? sides.north
}

export function bedUV(side: string, facing: string, part: string) {
  const turn = ({ north: 0, east: 1, south: 2, west: 3 } as Record<string, number>)[facing] ?? 0
  const top = side === 'up'
  const baseY = part === 'head' ? 0 : 22
  let region = top ? textureRegion(6, baseY + 6, 16, 16) : side === 'down' ? textureRegion(28, baseY + 6, 16, 16) :
    side === 'east' || side === 'west' ? textureRegion(side === 'east' ? 0 : 22, baseY + 6, 6, 16) : textureRegion(6, baseY, 16, 6)
  if (side === 'west') region = [region[3], region[2], region[1], region[0]]
  else if (side === 'east') region = [region[2], region[3], region[0], region[1]]
  else if (!top && side !== 'down') region = [region[1], region[2], region[3], region[0]]
  return region.map((_, index) => region[(index + turn) % region.length])
}

function isChestEntity(id: string) {
  return [':chest', ':trapped_chest', ':ender_chest'].some(suffix => id.endsWith(suffix))
}

function isBedEntity(id: string) {
  return id.endsWith(':bed') || id.endsWith('_bed')
}

export function unsupportedEntityIds(ids: string[]) {
  return [...new Set(ids.filter(id => !isChestEntity(id) && !isBedEntity(id)))].sort()
}

/** Fluid・ブロックエンティティのチャンクを構築する。常駐資源は MeshWorld が所有する。 */
export class SpecialWorld {
  private access: BlockAccess
  private material: MeshLambertMaterial[]
  private unknownMaterial: MeshLambertMaterial
  private entities = new Map<string, SceneDocument['blockEntities']>()

  constructor(private loaded: LoadedScene, private atlas: Atlas, private light: LightVolume, lightTexture: DataTexture, ao = { value: 1 }) {
    this.access = new BlockAccess(loaded)
    this.material = ['opaque', 'cutout', 'translucent'].map(layer => lightMaterial({ map: atlas.texture, vertexColors: true,
      transparent: layer === 'translucent', alphaTest: layer === 'cutout' ? 0.5 : 0.01, depthWrite: layer !== 'translucent', side: 2 }, lightTexture, ao))
    this.unknownMaterial = lightMaterial({ color: 0xc080b0 }, lightTexture, ao)
    for (const entity of loaded.document.blockEntities) {
      const key = entity.at.map(v => Math.floor(v / 16) * 16).join(',')
      if (!this.entities.has(key)) this.entities.set(key, [])
      this.entities.get(key)!.push(entity)
    }
  }

  get unsupportedEntities() { return unsupportedEntityIds(this.loaded.document.blockEntities.map(item => item.id)) }

  /** slice は両端を含む。面数超過は配列構築中に検出し、GPU 資源を作らず返す。 */
  buildChunk(chunk: DecodedChunk, slice: Slice, limit: number): ResidentChunk | undefined {
    const { palette, environment } = this.loaded.document
    const tint = environment.tints?.water
    const waterColor = (tint ? tintColor(tint.l, tint.a, tint.b) : [1, 1, 1]) as Vec3
    const quads: { at: Vec3; points: number[][]; tile: string; uv?: number[][]; color?: Vec3 }[] = []
    const unknownBoxes: { at: Vec3; owner: Vec3 }[] = []
    for (let y = Math.max(slice.minY, chunk.at[1]); y <= Math.min(slice.maxY, chunk.at[1] + chunk.size[1] - 1); y++) {
      for (let z = chunk.at[2]; z < chunk.at[2] + chunk.size[2]; z++) for (let x = chunk.at[0]; x < chunk.at[0] + chunk.size[0]; x++) {
        const id = this.access.block(x, y, z), entry = palette[id]
        if (entry.render !== 'fluid') continue
        const idName = entry.state.split('[')[0]
        const isLava = idName.endsWith(':lava')
        const tile = isLava ? lava : water
        const color: Vec3 = isLava ? [1, 0.45, 0.08] : waterColor
        const props = state(entry.state)
        const level = Number(props.level ?? 0)
        const at: Vec3 = [x, y, z]
        const sameFluid = (other: number) => palette[other]?.render === 'fluid' && palette[other].state.split('[')[0] === idName
        const aboveInSlice = y < slice.maxY && sameFluid(this.access.block(x, y + 1, z))
        const height = fluidHeight(level, aboveInSlice)
        const hidden = new Set<FluidSide>()
        if (aboveInSlice) hidden.add('up')
        for (const side of fluidSides.slice(1)) {
          const delta: Record<string, Vec3> = { up: [0, 1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] }
          const next = delta[side].map((v, i) => v + at[i]) as Vec3
          if (sameFluid(this.access.block(...next))) hidden.add(side)
        }
        for (const side of visibleFluidSides(hidden)) {
          const face = faces.find(candidate => candidate.side === side)!
          const points = face.points.map(p => p.map((v, axis) => axis === 1 ? v * height : v))
          quads.push({ at, points, tile, color })
          if (quads.length > limit) return undefined
        }
      }
    }
    for (const blockEntity of this.entities.get(chunk.at.join(',')) ?? []) {
      const [x, y, z] = blockEntity.at
      if (y < slice.minY || y > slice.maxY) continue
      const id = blockEntity.id
      const entryId = this.access.block(x, y, z)
      if (usesBlockModel(palette[entryId], this.loaded.document.minecraftVersion)) continue
      const blockState = palette[entryId]?.state ?? ''
      if (isChestEntity(id)) {
        const props = state(blockState)
        const facing = props.facing ?? 'north'
        const texture = chestTexture(id, blockState)
        const double = props.type === 'left' || props.type === 'right'
        const minX = props.type === 'right' ? 0 : 1 / 16
        const maxX = props.type === 'left' ? 1 : 15 / 16
        const width = double ? 15 : 14
        const at: Vec3 = [x, y, z]
        quads.push(...entityBox(at, [minX, 0, 1 / 16], [maxX, 10 / 16, 15 / 16], texture, boxUV(0, 19, width, 10, 14), facing))
        quads.push(...entityBox(at, [minX, 10 / 16, 1 / 16], [maxX, 14 / 16, 15 / 16], texture, boxUV(0, 0, width, 5, 14), facing))
        const lockX = !double ? 7 : props.type === 'left' ? 15 : 0
        const lockWidth = double ? 1 : 2
        quads.push(...entityBox(at, [lockX / 16, 7 / 16, 0], [(lockX + lockWidth) / 16, 11 / 16, 2 / 16], texture, boxUV(0, 0, lockWidth, 4, 1), facing))
      } else if (isBedEntity(id)) {
        const blockId = blockState.split('[')[0].split(':').at(-1) ?? ''
        const color = blockId.endsWith('_bed') ? blockId.slice(0, -4) : 'red'
        const bedState = state(blockState)
        const part = bedState.part ?? 'foot'
        const facing = bedState.facing ?? 'north'
        const regions = Object.fromEntries(faces.map(face => [face.side, bedUV(face.side, 'north', part)]))
        quads.push(...entityBox([x, y, z], [0, 3 / 16, 0], [1, 9 / 16, 1], bedTexture(color), regions, facing))
        const z0 = part === 'head' ? 0 : 13 / 16
        for (const x0 of [0, 13 / 16]) quads.push(...entityBox([x, y, z], [x0, 0, z0], [x0 + 3 / 16, 3 / 16, z0 + 3 / 16], bedTexture(color), boxUV(50, 0, 3, 3, 3), facing))
      } else {
        unknownBoxes.push({ at: [x + 0.1, y + 0.1, z + 0.1], owner: [x, y, z] })
      }
      if (quads.length + unknownBoxes.length * 6 > limit) return undefined
    }
    const group = new Group()
    const geometries: BufferGeometry[] = []
    for (const [index, layer] of ['opaque', 'cutout', 'translucent'].entries()) {
      const layerQuads = quads.filter(quad => this.atlas.tiles.get(quad.tile)!.layer === layer)
      if (!layerQuads.length) continue
      const specialGeometry = geometry(layerQuads, this.atlas)
      lightVertices(specialGeometry, this.light, slice)
      const mesh = new Mesh(specialGeometry, this.material[index])
      mesh.castShadow = layer !== 'translucent'
      mesh.receiveShadow = true
      group.add(mesh)
      geometries.push(specialGeometry)
    }
    for (const { at, owner } of unknownBoxes) {
      const box = boxGeometry(at, owner)
      lightVertices(box, this.light, slice)
      const unknown = new Mesh(box, this.unknownMaterial)
      unknown.castShadow = true
      unknown.receiveShadow = true
      group.add(unknown)
      geometries.push(box)
    }
    const bytes = geometries.reduce((sum, item) => sum + Object.values(item.attributes).reduce((n, attr) => n + attr.array.byteLength, 0) + item.index!.array.byteLength, 0)
    return { group, geometries, faces: quads.length + unknownBoxes.length * 6, bytes }
  }

  dispose() {
    this.material.forEach(material => material.dispose())
    this.unknownMaterial.dispose()
  }
}

/** render 属性と block entity ID から必要な entity テクスチャを返す。 */
export function specialTextures(loaded: LoadedScene) {
  const textures = new Set<string>()
  const access = new BlockAccess(loaded)
  if (loaded.document.palette.some(entry => entry.render === 'fluid')) {
    textures.add(water); textures.add(lava)
  }
  for (const item of loaded.document.blockEntities) {
    if (usesBlockModel(loaded.document.palette[access.block(...item.at)], loaded.document.minecraftVersion)) continue
    const stateId = loaded.document.palette[access.block(...item.at)]?.state ?? ''
    if (isChestEntity(item.id)) textures.add(chestTexture(item.id, stateId))
    if (isBedEntity(item.id)) {
      const blockId = stateId.split('[')[0].split(':').at(-1) ?? 'red_bed'
      textures.add(bedTexture(blockId.endsWith('_bed') ? blockId.slice(0, -4) : 'red'))
    }
  }
  return [...textures]
}
