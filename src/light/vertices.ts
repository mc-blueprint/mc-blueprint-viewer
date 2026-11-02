import type { BufferGeometry } from 'three'
import type { Slice } from '../mesh/chunk'
import type { LightVolume } from './propagation'

/** 新規 geometry の light=[sky,block,ao] を更新する。断面は照明を再計算せず元の建物の光を保つ。 */
export function lightVertices(geometry: BufferGeometry, volume: LightVolume, slice: Slice): void {
  const positions = geometry.getAttribute('position')
  const normals = geometry.getAttribute('normal')
  const owners = geometry.getAttribute('blockPosition')
  const light = geometry.getAttribute('light')
  const [width, height, depth] = volume.size
  const index = (p: number[]) => (p[1] * depth + Math.max(0, Math.min(depth - 1, p[2]))) * width + Math.max(0, Math.min(width - 1, p[0]))
  const sample = (values: Uint8Array, p: number[]) => p[1] >= height ? (values === volume.sky ? 15 : 0) : p[1] < 0 ? 0 : values[index(p)]
  const solid = (p: number[]) => p[0] >= 0 && p[0] < width && p[2] >= 0 && p[2] < depth && p[1] >= Math.max(0, slice.minY) && p[1] <= Math.min(height - 1, slice.maxY) && volume.opacity[index(p)] === 15
  for (let i = 0; i < positions.count; i++) {
    const p = [positions.getX(i), positions.getY(i), positions.getZ(i)]
    const normal = [normals.getX(i), normals.getY(i), normals.getZ(i)]
    const owner = [owners.getX(i), owners.getY(i), owners.getZ(i)]
    const axis = Math.abs(normal[0]) > Math.abs(normal[1]) ? (Math.abs(normal[0]) > Math.abs(normal[2]) ? 0 : 2) : (Math.abs(normal[1]) > Math.abs(normal[2]) ? 1 : 2)
    const tangent = [0, 1, 2].filter(a => a !== axis)
    const base = [...owner]
    base[axis] += Math.sign(normal[axis])
    const low = tangent.map(a => Math.floor(p[a] - 0.5))
    const fraction = tangent.map((a, j) => p[a] - 0.5 - low[j])
    let sky = 0, block = 0
    for (let u = 0; u < 2; u++) for (let v = 0; v < 2; v++) {
      const at = [...base]
      at[tangent[0]] = low[0] + u
      at[tangent[1]] = low[1] + v
      const weight = (u ? fraction[0] : 1 - fraction[0]) * (v ? fraction[1] : 1 - fraction[1])
      sky += sample(volume.sky, at) * weight
      block += sample(volume.block, at) * weight
    }
    const side1 = [...base], side2 = [...base], corner = [...base]
    tangent.forEach((a, j) => { corner[a] += p[a] < owner[a] + 0.5 ? -1 : 1; (j === 0 ? side1 : side2)[a] = corner[a] })
    const a = Number(solid(side1)), b = Number(solid(side2)), c = Number(solid(corner))
    const ao = 1 - 0.2 * (a && b ? 3 : a + b + c)
    light.setXYZ(i, sky, Math.max(block, sample(volume.block, owner)), ao)
  }
  light.needsUpdate = true
}
