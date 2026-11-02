import { describe, expect, it } from 'vitest'
import { emptySample, initialQuality, lowerQuality, sampleFrame } from '../src/render/quality'
import type { FrameSample, RenderQuality } from '../src/render/quality'
import type { SceneDocument } from '../src/scene/types'

const preview = { shader: 'cinematic', shadows: true, quality: 'auto' } as SceneDocument['preview']

function windowAt(state: FrameSample, fps: number) {
  let result = sampleFrame(state, 1000 / fps)
  while (result.fps === undefined) result = sampleFrame(result.sample, 1000 / fps)
  return result
}

describe('自動品質', () => {
  it('シェーダー2段→影→AO→描画距離の順で下げ、下限で停止する', () => {
    let state = initialQuality(preview)
    const states: RenderQuality[] = []
    for (let i = 0; i < 7; i++) { state = lowerQuality(state); states.push(state) }
    expect(states).toEqual([
      { shader: 'soft', shadows: true, ao: true, distance: 1 },
      { shader: 'vanilla', shadows: true, ao: true, distance: 1 },
      { shader: 'vanilla', shadows: false, ao: true, distance: 1 },
      { shader: 'vanilla', shadows: false, ao: false, distance: 1 },
      { shader: 'vanilla', shadows: false, ao: false, distance: 0.75 },
      { shader: 'vanilla', shadows: false, ao: false, distance: 0.5 },
      { shader: 'vanilla', shadows: false, ao: false, distance: 0.25 },
    ])
    expect(lowerQuality(state)).toBe(state)
    expect(preview.shader).toBe('cinematic')
  })
  it('sceneのプリセットとlow・影無効を尊重し、不要な段階を飛ばす', () => {
    const state = initialQuality({ ...preview, shader: 'vanilla', quality: 'low' })
    expect(state.shadows).toBe(false)
    expect(lowerQuality(state)).toEqual({ ...state, ao: false })
    expect(initialQuality({ ...preview, shadows: false }).shadows).toBe(false)
  })
  it('3秒未満では判定せず、fpsを総フレーム数と総時間から計算する', () => {
    const result = sampleFrame({ elapsed: 2950, frames: 59, slowWindows: 0 }, 50)
    expect(result.fps).toBe(20)
    expect(result.lower).toBe(false)
    expect(sampleFrame(emptySample(), 100).fps).toBeUndefined()
  })
  it('一時的な低下では下げず、2窓連続の低下だけを判定して窓をリセットする', () => {
    const slow = windowAt(emptySample(), 20)
    expect(slow.lower).toBe(false)
    const recovered = windowAt(slow.sample, 60)
    expect(recovered.sample.slowWindows).toBe(0)
    const again = windowAt(recovered.sample, 20)
    const sustained = windowAt(again.sample, 20)
    expect(sustained.lower).toBe(true)
    expect(sustained.sample).toEqual(emptySample())
    expect(windowAt(emptySample(), 30).lower).toBe(false)
  })
})
