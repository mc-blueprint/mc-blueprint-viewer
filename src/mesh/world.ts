import { Group, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import type { LoadedScene } from '../scene/types'
import type { Atlas, Layer } from './atlas'
import { BlockAccess, buildChunk, faceLimits } from './chunk'
import type { ChunkMesh, Shapes, Slice } from './chunk'

/** カメラ距離順の連続したチャンク集合を保持する。予算外の遠方チャンクは CPU/GPU 両方から解放する。 */
export class MeshWorld {
  readonly group = new Group()
  readonly access: BlockAccess
  private resident = new Map<string, ChunkMesh & { group: Group }>()
  private materials: Map<Layer, MeshBasicMaterial>
  private revision = 0
  private slice: Slice = { minY: 0, maxY: Infinity }
  readonly limit: number
  constructor(readonly loaded: LoadedScene, private shapes: Shapes, private atlas: Atlas, limit?: number) {
    this.access = new BlockAccess(loaded)
    const quality = loaded.document.preview.quality
    this.limit = limit ?? faceLimits[quality === 'auto' ? 'low' : quality]
    this.materials = new Map((['opaque', 'cutout', 'translucent'] as const).map(layer => [layer, new MeshBasicMaterial({
      map: atlas.texture, vertexColors: true, transparent: layer === 'translucent',
      alphaTest: layer === 'opaque' ? 0 : layer === 'cutout' ? 0.5 : 0.01,
      depthWrite: layer !== 'translucent',
    })]))
  }
  get stats() {
    return { faces: [...this.resident.values()].reduce((n, c) => n + c.faces, 0),
      meshBytes: [...this.resident.values()].reduce((n, c) => n + c.bytes, 0),
      atlasBytes: this.atlas.bytes, chunks: this.resident.size }
  }
  private remove(key: string) {
    const mesh = this.resident.get(key)!
    mesh.geometries.forEach(g => g.dispose())
    this.group.remove(mesh.group)
    this.resident.delete(key)
  }
  async update(camera: Vector3, slice = this.slice): Promise<boolean> {
    const revision = ++this.revision
    if (slice.minY !== this.slice.minY || slice.maxY !== this.slice.maxY) {
      for (const key of this.resident.keys()) this.remove(key)
      this.slice = { ...slice }
    }
    const distance = (at: number[]) => camera.distanceToSquared(new Vector3(...at).addScalar(8))
    const sorted = this.loaded.chunks.filter(c => c.at[1] <= slice.maxY && c.at[1] + c.size[1] > slice.minY)
      .sort((a, b) => distance(a.at) - distance(b.at))
    const wanted = new Set(sorted.map(c => c.at.join(',')))
    for (const key of this.resident.keys()) if (!wanted.has(key)) this.remove(key)
    let faces = 0
    let yielded = performance.now()
    const kept = new Set<string>()
    for (const chunk of sorted) {
      if (revision !== this.revision) return false
      const key = chunk.at.join(',')
      let mesh = this.resident.get(key)
      if (!mesh) {
        for (const old of [...this.resident.keys()]) if (!kept.has(old)) this.remove(old)
        const built = buildChunk(chunk, this.access, this.shapes, this.atlas, slice, this.limit - faces)
        if (!built) break
        const group = new Group()
        built.geometries.forEach((geometry, layer) => group.add(new Mesh(geometry, this.materials.get(layer)!)))
        mesh = { ...built, group }
        this.resident.set(key, mesh)
        this.group.add(group)
      }
      if (faces + mesh.faces > this.limit) break
      faces += mesh.faces
      kept.add(key)
      if (performance.now() - yielded > 8) {
        await new Promise(resolve => setTimeout(resolve, 0))
        yielded = performance.now()
      }
    }
    if (revision !== this.revision) return false
    for (const key of this.resident.keys()) if (!kept.has(key)) this.remove(key)
    return true
  }
  dispose() {
    this.revision++
    for (const key of this.resident.keys()) this.remove(key)
    this.materials.forEach(m => m.dispose())
    this.atlas.texture.dispose()
  }
}
