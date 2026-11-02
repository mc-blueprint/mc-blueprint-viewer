import { Color, DataTexture, DirectionalLight, LinearFilter, PCFShadowMap, RGBAFormat, SRGBColorSpace, Vector3 } from 'three'
import type { Scene, WebGLRenderer } from 'three'
import type { SceneDocument } from '../scene/types'

/** 時刻は Minecraft の tick（0=朝、6000=昼、18000=夜）。太陽は夜に地平線の下へ回る。 */
export function sunAt(time: number) {
  const phase = ((time / 24000 - 0.25) % 1 + 1) % 1
  const angle = (phase + ((1 - (Math.cos(phase * Math.PI) + 1) / 2) - phase) / 3) * Math.PI * 2
  const direction = new Vector3(-Math.sin(angle), Math.cos(angle), 0.25).normalize()
  const daylight = Math.max(0, Math.min(1, direction.y * 1.5 + 0.2))
  return { direction, daylight, sky: new Color(0x070b20).lerp(new Color(0x93b9d2), daylight) }
}

/** ゲームの光レベルの非線形減衰と、明るさの四次補間を使う16×16の線形RGBライトマップ。 */
export function lightMap(brightness: number, daylight: number, blockLight: boolean): DataTexture {
  const bytes = new Uint8Array(16 * 16 * 4)
  const curve = (level: number) => (level / 15) / (4 - 3 * level / 15)
  const color = new Color()
  for (let block = 0; block < 16; block++) for (let sky = 0; sky < 16; sky++) {
    const s = curve(sky) * (0.04 + daylight * 0.96)
    const b = blockLight ? curve(block) : 0
    const rgb = [1, 0.8, 0.55].map((warmth, channel) => {
      const value = Math.min(1, 0.025 + Math.max(s * [0.9, 0.95, 1][channel], b * warmth))
      return value + ((1 - (1 - value) ** 4) - value) * brightness
    })
    color.setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace)
    const i = (block * 16 + sky) * 4
    bytes.set([Math.round(color.r * 255), Math.round(color.g * 255), Math.round(color.b * 255), 255], i)
  }
  const texture = new DataTexture(bytes, 16, 16, RGBAFormat)
  texture.minFilter = texture.magFilter = LinearFilter
  texture.needsUpdate = true
  return texture
}

export function shadowResolution(preview: SceneDocument['preview']): number {
  return !preview.shadows || preview.quality === 'low' ? 0 : preview.quality === 'high' ? 4096 : 2048
}

/** scene 全体を影のカメラに含める。auto は2048から開始し、実測によって影を切る。 */
export function createLighting(world: Scene, renderer: WebGLRenderer, document: SceneDocument) {
  const { preview } = document
  const sun = new DirectionalLight(0xffffff, 1)
  const center = new Vector3(...document.size).multiplyScalar(0.5)
  const radius = new Vector3(...document.size).length() / 2 + 2
  const resolution = shadowResolution(preview)
  renderer.shadowMap.enabled = resolution > 0
  renderer.shadowMap.type = PCFShadowMap
  sun.castShadow = resolution > 0
  sun.shadow.mapSize.set(resolution || 1, resolution || 1)
  Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 0.1, far: radius * 4 })
  sun.shadow.camera.updateProjectionMatrix()
  sun.shadow.bias = -0.0001
  sun.shadow.normalBias = 0.03
  sun.target.position.copy(center)
  world.add(sun, sun.target)
  const state = sunAt(preview.timeOfDay)
  sun.position.copy(center).addScaledVector(state.direction, radius * 2)
  sun.intensity = state.daylight
  sun.castShadow = resolution > 0 && state.direction.y > 0
  world.background = state.sky
  const texture = lightMap(preview.brightness, state.daylight, preview.blockLight)
  const ao = { value: 1 }
  return { texture, ao,
    setShadows(enabled: boolean, soft: boolean) {
      renderer.shadowMap.enabled = enabled && resolution > 0
      sun.castShadow = renderer.shadowMap.enabled && state.direction.y > 0
      sun.shadow.radius = soft ? 3 : 1
    },
    dispose() { texture.dispose(); sun.shadow.dispose(); world.remove(sun, sun.target) },
  }
}
