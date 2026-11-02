import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial } from 'three'
import type { LoadedScene, Vec3 } from '../scene/types'
import type { Atlas } from '../mesh/atlas'
import { BlockAccess, type Slice } from '../mesh/chunk'

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
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [], indices: number[] = []
  for (const quad of quads) {
    const tile = atlas.tiles.get(quad.tile)
    if (!tile) continue
    const start = positions.length / 3
    quad.points.forEach((point, i) => {
      positions.push(...point.map((v, axis) => v + quad.at[axis]))
      const uv = quad.uv?.[i] ?? [[0, 0], [0, 1], [1, 1], [1, 0]][i]
      uvs.push(tile.u + uv[0] * tile.width, tile.v + uv[1] * tile.height)
      colors.push(...(quad.color ?? [1, 1, 1]))
    })
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3)
  }
  const result = new BufferGeometry()
  result.setAttribute('position', new Float32BufferAttribute(positions, 3))
  result.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  result.setAttribute('color', new Float32BufferAttribute(colors, 3))
  result.setIndex(indices)
  result.computeVertexNormals()
  return result
}

function textureRegion(x: number, y: number, width: number, height: number) {
  return [[x / 64, y / 64], [x / 64, (y + height) / 64], [(x + width) / 64, (y + height) / 64], [(x + width) / 64, y / 64]]
}

function boxGeometry(at: Vec3) {
  const positions = faces.flatMap(face => face.points.flatMap(point => point.map((v, axis) => at[axis] + v * 0.8)))
  const indices = faces.flatMap((_, face) => {
    const start = face * 4
    return [start, start + 1, start + 2, start, start + 2, start + 3]
  })
  const result = new BufferGeometry()
  result.setAttribute('position', new Float32BufferAttribute(positions, 3))
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

function isChestEntity(id: string) {
  return [':chest', ':trapped_chest', ':ender_chest'].some(suffix => id.endsWith(suffix))
}

function isBedEntity(id: string) {
  return id.endsWith(':bed') || id.endsWith('_bed')
}

export function unsupportedEntityIds(ids: string[]) {
  return [...new Set(ids.filter(id => !isChestEntity(id) && !isBedEntity(id)))].sort()
}

/** Fluid・ブロックエンティティを通常メッシュから分離して描画する。slice は両端を含む。 */
export class SpecialWorld {
  readonly group = new Group()
  private access: BlockAccess
  private material: MeshBasicMaterial
  private unknownMaterial = new MeshBasicMaterial({ color: 0xc080b0 })
  private mesh?: Mesh
  private unknownMeshes: Mesh[] = []
  private unsupported = new Set<string>()

  constructor(private loaded: LoadedScene, private atlas: Atlas) {
    this.access = new BlockAccess(loaded)
    this.material = new MeshBasicMaterial({ map: atlas.texture, vertexColors: true, transparent: true, alphaTest: 0.01, side: 2 })
  }

  get unsupportedEntities() { return [...this.unsupported].sort() }

  update(slice: Slice) {
    if (this.mesh) {
      this.group.remove(this.mesh)
      this.mesh.geometry.dispose()
    }
    for (const unknown of this.unknownMeshes) {
      this.group.remove(unknown)
      unknown.geometry.dispose()
    }
    this.unknownMeshes = []
    const { palette, size } = this.loaded.document
    const quads: { at: Vec3; points: number[][]; tile: string; uv?: number[][]; color?: Vec3 }[] = []
    const unknownBoxes: Vec3[] = []
    for (let y = slice.minY; y <= Math.min(slice.maxY, size[1] - 1); y++) {
      for (let z = 0; z < size[2]; z++) for (let x = 0; x < size[0]; x++) {
        const id = this.access.block(x, y, z), entry = palette[id]
        if (entry.render !== 'fluid') continue
        const idName = entry.state.split('[')[0]
        const isLava = idName.endsWith(':lava')
        const tile = isLava ? lava : water
        const color: Vec3 = isLava ? [1, 0.45, 0.08] : [0.25, 0.48, 0.95]
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
        }
      }
    }
    for (const blockEntity of this.loaded.document.blockEntities) {
      const [x, y, z] = blockEntity.at
      if (y < slice.minY || y > slice.maxY) continue
      const id = blockEntity.id
      const entryId = this.access.block(x, y, z)
      const blockState = palette[entryId]?.state ?? ''
      if (isChestEntity(id)) {
        const sideIndex = chestSides(state(blockState).facing ?? 'north')
        const texture = chestTexture(id, blockState)
        const points = faces.map(face => ({ at: [x + 1 / 16, y, z + 1 / 16] as Vec3,
          points: face.points.map(p => [1 / 16 + p[0] * 14 / 16, p[1] * 14 / 16, 1 / 16 + p[2] * 14 / 16]), tile: texture,
          uv: face.side === 'up' ? textureRegion(14, 0, 14, 14) : face.side === 'down' ? textureRegion(14, 28, 14, 14) :
            textureRegion([14, 0, 42, 28][sideIndex.indexOf(face.side)], 14, 14, 10) }))
        quads.push(...points)
      } else if (isBedEntity(id)) {
        const blockId = blockState.split('[')[0].split(':').at(-1) ?? ''
        const color = blockId.endsWith('_bed') ? blockId.slice(0, -4) : 'red'
        quads.push(...faces.map(face => ({ at: [x, y, z] as Vec3,
          points: face.points.map(p => [p[0], p[1] * 9 / 16, p[2]]), tile: bedTexture(color),
          uv: textureRegion(0, face.side === 'up' || face.side === 'down' ? 0 : 16, 16, face.side === 'up' || face.side === 'down' ? 16 : 4) })))
      } else {
        unknownBoxes.push([x + 0.1, y + 0.1, z + 0.1])
      }
    }
    this.unsupported = new Set(unsupportedEntityIds(this.loaded.document.blockEntities.map(item => item.id)))
    this.mesh = new Mesh(geometry(quads, this.atlas), this.material)
    this.group.add(this.mesh)
    for (const at of unknownBoxes) {
      const box = boxGeometry(at)
      const unknown = new Mesh(box, this.unknownMaterial)
      this.unknownMeshes.push(unknown)
      this.group.add(unknown)
    }
  }

  dispose() {
    if (this.mesh) this.mesh.geometry.dispose()
    this.material.dispose()
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
    const stateId = loaded.document.palette[access.block(...item.at)]?.state ?? ''
    if (isChestEntity(item.id)) textures.add(chestTexture(item.id, stateId))
    if (isBedEntity(item.id)) {
      const blockId = loaded.document.palette.find(entry => entry.state.includes('_bed'))?.state.split('[')[0].split(':').at(-1) ?? 'red_bed'
      textures.add(bedTexture(blockId.slice(0, -4)))
    }
  }
  return [...textures]
}
