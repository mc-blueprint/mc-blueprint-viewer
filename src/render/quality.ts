import type { SceneDocument } from '../scene/types'

export type ShaderPreset = SceneDocument['preview']['shader']
export interface RenderQuality {
  shader: ShaderPreset
  shadows: boolean
  ao: boolean
  distance: number
}

export function initialQuality(preview: SceneDocument['preview']): RenderQuality {
  return { shader: preview.shader, shadows: preview.shadows && preview.quality !== 'low', ao: true, distance: 1 }
}

/** 一段だけ下げる。距離は scene の対角長に対する割合で、最小1/4を保つ。 */
export function lowerQuality(state: RenderQuality): RenderQuality {
  if (state.shader === 'cinematic') return { ...state, shader: 'soft' }
  if (state.shader === 'soft') return { ...state, shader: 'vanilla' }
  if (state.shadows) return { ...state, shadows: false }
  if (state.ao) return { ...state, ao: false }
  if (state.distance > 0.25) return { ...state, distance: state.distance - 0.25 }
  return state
}

export interface FrameSample { elapsed: number; frames: number; slowWindows: number }
export const emptySample = (): FrameSample => ({ elapsed: 0, frames: 0, slowWindows: 0 })

/** 準備済み・表示中のフレーム間隔(ms)だけを渡す。3秒窓が2回連続で30fps未満なら一段下げる。 */
export function sampleFrame(state: FrameSample, milliseconds: number) {
  const elapsed = state.elapsed + milliseconds
  const frames = state.frames + 1
  if (elapsed < 3000) return { sample: { ...state, elapsed, frames }, fps: undefined, lower: false }
  const fps = frames * 1000 / elapsed
  const slowWindows = fps < 30 ? state.slowWindows + 1 : 0
  const lower = slowWindows >= 2
  return { sample: { elapsed: 0, frames: 0, slowWindows: lower ? 0 : slowWindows }, fps, lower }
}
