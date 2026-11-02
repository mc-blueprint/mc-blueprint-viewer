export type Vec3 = [number, number, number]
export interface PaletteEntry {
  state: string
  render: 'model' | 'fluid' | 'entity' | 'invisible'
  emission: number
  opacity: number
  tint: 'none' | 'grass' | 'foliage' | 'water' | 'fixed'
}
export interface SourceEntry {
  id: number
  element?: string
  spec?: string
  path?: string
  label?: string
  params?: string[]
}
export interface SceneDocument {
  formatVersion: 1
  minecraftVersion: string
  engine: { version: string; commit: string }
  source: { kind: 'spec' | 'blueprint' | 'schematic'; path: string; sha256: string }
  size: Vec3
  origin: Vec3
  palette: PaletteEntry[]
  chunks: { at: Vec3; blocks: string; sources: string }[]
  indexWidth: 16 | 32
  sources: SourceEntry[]
  blockEntities: { at: Vec3; id: string }[]
  environment: {
    biome: string
    tints?: Record<'grass' | 'foliage' | 'water', { l: number; a: number; b: number }>
  }
  preview: {
    enabled: boolean
    shader: 'vanilla' | 'soft' | 'cinematic'
    shadows: boolean
    brightness: number
    timeOfDay: number
    blockLight: boolean
    quality: 'auto' | 'low' | 'medium' | 'high'
  }
}
export interface DecodedChunk {
  at: Vec3
  size: Vec3
  blocks: Uint16Array | Uint32Array
  sources: Uint32Array
}
export interface LoadedScene {
  document: SceneDocument
  chunks: DecodedChunk[]
  /** gzip 展開後の元の JSON バイト列の SHA-256。edits.scene に使う。 */
  sha256: string
}
