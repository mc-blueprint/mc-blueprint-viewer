import { MathUtils, Vector3 } from 'three'
import type { PerspectiveCamera } from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { ShaderPreset } from './quality'

/** 静止画URLを検証する。未指定時は通常表示、不正な指定は起動エラーとする。 */
export function stillOptions(params: URLSearchParams) {
  const view = params.get('still')
  if (view === null) return undefined
  if (view !== 'iso' && view !== 'front' && view !== 'top') throw new Error(`不明な静止画視点: ${view}`)
  const preset = params.get('preset') ?? 'vanilla'
  if (preset !== 'vanilla' && preset !== 'soft' && preset !== 'cinematic') throw new Error(`不明なプリセット: ${preset}`)
  return { view, preset: preset as ShaderPreset }
}

/** scene全体の外接球を画角内に収める。frontは北側（-Z）、topは北を画面上に固定する。 */
export function frameStill(camera: PerspectiveCamera, controls: Pick<OrbitControls, 'target' | 'update'>, size: Vector3, view: string) {
  controls.target.copy(size).multiplyScalar(0.5)
  const direction = view === 'iso' ? new Vector3(1, 0.8, -1) : view === 'front' ? new Vector3(0, 0, -1) : new Vector3(0, 1, 0)
  const halfFov = Math.atan(Math.tan(MathUtils.degToRad(camera.fov / 2)) * Math.min(1, camera.aspect))
  camera.up.set(0, view === 'top' ? 0 : 1, view === 'top' ? -1 : 0)
  camera.position.copy(controls.target).addScaledVector(direction.normalize(), size.length() / 2 / Math.sin(halfFov) * 1.05)
  controls.update()
}
