import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { frameStill, stillOptions } from '../src/render/still'

describe('静止画', () => {
  it('通常表示と静止画の指定を分け、不正な視点・プリセットを拒否する', () => {
    expect(stillOptions(new URLSearchParams())).toBeUndefined()
    expect(stillOptions(new URLSearchParams('still=iso'))).toEqual({ view: 'iso', preset: 'vanilla' })
    expect(stillOptions(new URLSearchParams('still=top&preset=soft'))).toEqual({ view: 'top', preset: 'soft' })
    expect(() => stillOptions(new URLSearchParams('still='))).toThrow()
    expect(() => stillOptions(new URLSearchParams('still=iso&preset=unknown'))).toThrow()
  })
  it.each(['iso', 'front', 'top'])('%sで縦長・横長の出力とも全体が画角内に入る', view => {
    const size = new Vector3(256, 128, 256)
    for (const aspect of [0.5, 16 / 9]) {
      const camera = new PerspectiveCamera(50, aspect, 0.1, 5000)
      const target = new Vector3()
      frameStill(camera, { target, update: () => { camera.lookAt(target); return true } }, size, view)
      camera.updateMatrixWorld()
      for (const x of [0, size.x]) for (const y of [0, size.y]) for (const z of [0, size.z]) {
        const point = new Vector3(x, y, z).project(camera)
        expect(Math.abs(point.x)).toBeLessThan(1)
        expect(Math.abs(point.y)).toBeLessThan(1)
        expect(Math.abs(point.z)).toBeLessThan(1)
      }
      expect(target.toArray()).toEqual([128, 64, 128])
      if (view === 'front') expect(camera.position.z).toBeLessThan(0)
      if (view === 'top') expect(camera.up.toArray()).toEqual([0, 0, -1])
    }
  })
})
