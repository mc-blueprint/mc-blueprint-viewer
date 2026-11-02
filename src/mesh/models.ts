import { BlockDefinition, BlockModel } from 'deepslate/render'
import type { BlockModelElement, TextureAtlasProvider } from 'deepslate/render'
import { Matrix4, Vector3 } from 'three'
import { fetchAsset } from '../scene/api'
import type { PaletteEntry, Vec3 } from '../scene/types'

export const directions = ['up', 'down', 'south', 'north', 'east', 'west'] as const
export type Side = typeof directions[number]
export const offsets: Record<Side, Vec3> = {
  up: [0, 1, 0], down: [0, -1, 0], south: [0, 0, 1], north: [0, 0, -1], east: [1, 0, 0], west: [-1, 0, 0],
}
const bases: Record<Side, [Vec3, Vec3]> = {
  up: [[1, 0, 0], [0, 0, 1]], down: [[1, 0, 0], [0, 0, -1]],
  south: [[1, 0, 0], [0, -1, 0]], north: [[-1, 0, 0], [0, -1, 0]],
  east: [[0, 0, -1], [0, -1, 0]], west: [[0, 0, 1], [0, -1, 0]],
}
export interface Variant { model: string; x?: number; y?: number; uvlock?: boolean; weight?: number }
type Choice = Variant | Variant[]
interface Definition {
  variants?: Record<string, Choice>
  multipart?: { when?: Record<string, unknown>; apply: Choice }[]
}
interface ModelJson {
  parent?: string
  textures?: Record<string, string | { sprite: string }>
  elements?: BlockModelElement[]
}
export interface ModelFace {
  positions: number[][]
  uv: number[][]
  texture: string
  tint: boolean
  normal: Vec3
  cull?: Side
  boundary?: Side
}
export interface ModelShape { faces: ModelFace[]; solid: Set<Side> }

export function assetPath(id: string, kind: 'models' | 'textures' | 'blockstates', extension = 'json') {
  const [namespace, path] = id.includes(':') ? id.split(':') : ['minecraft', id]
  return `assets/${namespace}/${kind}/${path}.${extension}`
}

/** 同じ位置・候補群では毎回同じ選択になる。salt で multipart の候補群を分ける。 */
export function chooseWeighted(choices: Choice, at: Vec3, salt = 0): Variant {
  if (!Array.isArray(choices)) return choices
  let hash = (Math.imul(at[0], 73428767) ^ Math.imul(at[1], 912931) ^ Math.imul(at[2], 438289) ^ Math.imul(salt + 1, 19349663)) >>> 0
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0
  const total = choices.reduce((sum, v) => sum + (v.weight ?? 1), 0)
  let value = hash % total
  return choices.find(v => (value -= v.weight ?? 1) < 0)!
}

function matchingChoices(data: Definition, props: Record<string, string>) {
  const choices: Choice[] = []
  const marker = (choice: Choice) => ({ model: String(choices.push(choice) - 1) })
  const definition = BlockDefinition.fromJson({
    variants: data.variants && Object.fromEntries(Object.entries(data.variants).map(([key, choice]) => [key || '__default=true', marker(choice)])),
    multipart: data.multipart?.map(part => ({ ...part, apply: marker(part.apply) })),
  })
  return definition.getModelVariants({ ...props, __default: 'true' }).map(v => ({ choice: choices[Number(v.model)], salt: Number(v.model) }))
}

export function selectModels(data: Definition, props: Record<string, string>, at: Vec3): Variant[] {
  return matchingChoices(data, props).map(({ choice, salt }) => chooseWeighted(choice, at, salt))
}

export function variantRotation(variant: Variant) {
  return new Matrix4().makeRotationY(-(variant.y ?? 0) * Math.PI / 180)
    .multiply(new Matrix4().makeRotationX(-(variant.x ?? 0) * Math.PI / 180))
}

function rotatedSide(side: Side, rotation: Matrix4): Side {
  const normal = new Vector3(...offsets[side]).transformDirection(rotation)
  return directions.find(s => normal.dot(new Vector3(...offsets[s])) > 0.999)!
}

/** UV はタイル内の 0..1。blockstate の回転後も世界の各面にテクスチャ方向を固定する。 */
export function lockUV(uv: number[], side: Side, rotation: Matrix4): number[] {
  const target = rotatedSide(side, rotation)
  const u = new Vector3(...bases[side][0]).transformDirection(rotation)
  const v = new Vector3(...bases[side][1]).transformDirection(rotation)
  return bases[target].map(axis => {
    const basis = new Vector3(...axis)
    return 0.5 + (uv[0] - 0.5) * u.dot(basis) + (uv[1] - 0.5) * v.dot(basis)
  })
}

/** 解決済みモデルの形状は deepslate に任せ、面省略用の境界情報と UV 固定だけを補う。 */
export function modelFaces(model: ModelJson, variant: Variant): ModelFace[] {
  const block = BlockModel.fromJson(model)
  const rotation = variantRotation(variant)
  const atlas = { getTextureUV: () => [0, 0, 1, 1] } as unknown as TextureAtlasProvider
  const texture = (ref: string): string => {
    while (ref.startsWith('#')) {
      const value = model.textures![ref.slice(1)]
      ref = typeof value === 'string' ? value : value.sprite
    }
    return ref.includes(':') ? ref : `minecraft:${ref}`
  }
  return (model.elements ?? []).flatMap(element => directions.flatMap(side => {
    const face = element.faces?.[side]
    if (!face) return []
    const mesh = block.getElementMesh({ ...element, faces: { [side]: face } }, atlas, {}, () => [1, 1, 1])
    return mesh.quads.map(quad => {
      const positions = quad.vertices().map(vertex => {
        const p = new Vector3(vertex.pos.x / 16 - 0.5, vertex.pos.y / 16 - 0.5, vertex.pos.z / 16 - 0.5).applyMatrix4(rotation).addScalar(0.5)
        return p.toArray()
      })
      const normal = new Vector3().subVectors(new Vector3(...positions[1]), new Vector3(...positions[0]))
        .cross(new Vector3().subVectors(new Vector3(...positions[2]), new Vector3(...positions[0]))).normalize().toArray() as Vec3
      const boundary = directions.find(s => {
        const axis = offsets[s].findIndex(v => v !== 0)
        return positions.every(p => Math.abs(p[axis] - (offsets[s][axis] > 0 ? 1 : 0)) < 1e-6)
      })
      return { positions, normal, texture: texture(face.texture), tint: (face.tintindex ?? -1) >= 0,
        uv: quad.vertices().map(vertex => variant.uvlock ? lockUV(vertex.texture!, side, rotation) : [...vertex.texture!]),
        cull: face.cullface ? rotatedSide(face.cullface, rotation) : undefined, boundary }
    })
  }))
}

export function shapeOf(faces: ModelFace[]): ModelShape {
  const solid = new Set<Side>()
  for (const face of faces) {
    if (!face.boundary) continue
    const axis = offsets[face.boundary].findIndex(v => v !== 0)
    const axes = [0, 1, 2].filter(i => i !== axis)
    if (face.positions.every(p => axes.every(i => Math.abs(p[i]) < 1e-6 || Math.abs(p[i] - 1) < 1e-6)) &&
      new Set(face.positions.map(p => axes.map(i => Math.round(p[i])).join(','))).size === 4) solid.add(face.boundary)
  }
  return { faces, solid }
}

/** render:model の palette だけを読む。取得・モデル解決の失敗は呼出し側へ返す。 */
export async function loadModels(palette: PaletteEntry[], version: string) {
  const models = new Map<string, Promise<ModelJson>>()
  const used = new Set<string>()
  const read = async (id: string): Promise<ModelJson> => {
    if (!models.has(id)) models.set(id, (async () => {
      const raw: ModelJson = await (await fetchAsset(version, assetPath(id, 'models'))).json()
      if (!raw.parent) return raw
      const parent = await read(raw.parent)
      return { textures: { ...parent.textures, ...raw.textures }, elements: raw.elements ?? parent.elements }
    })())
    return models.get(id)!
  }
  const entries = await Promise.all(palette.map(async entry => {
    if (entry.render !== 'model') return undefined
    const [name, properties] = entry.state.replace(']', '').split('[')
    const props = Object.fromEntries(properties ? properties.split(',').map(p => p.split('=')) : [])
    const data: Definition = await (await fetchAsset(version, assetPath(name, 'blockstates'))).json()
    const choices = [...Object.values(data.variants ?? {}), ...(data.multipart ?? []).map(p => p.apply)].flat()
    choices.forEach(v => used.add(v.model))
    await Promise.all(choices.map(v => read(v.model)))
    const cache = new Map<string, ModelShape>()
    const matching = matchingChoices(data, props)
    const weighted = matching.some(({ choice }) => Array.isArray(choice) && choice.length > 1)
    let fixed: ModelShape | undefined
    return (at: Vec3) => {
      if (fixed) return fixed
      const selected = matching.map(({ choice, salt }) => chooseWeighted(choice, at, salt))
      const key = JSON.stringify(selected)
      if (!cache.has(key)) cache.set(key, shapeOf(selected.flatMap(v => modelFaces(modelValues.get(v.model)!, v))))
      const shape = cache.get(key)!
      if (!weighted) fixed = shape
      return shape
    }
  }))
  const modelValues = new Map(await Promise.all([...models].map(async ([id, value]) => [id, await value] as const)))
  const textures = new Set<string>()
  for (const id of used) for (const face of modelFaces(modelValues.get(id)!, { model: '' })) textures.add(face.texture)
  return { entries, textures: [...textures] }
}
