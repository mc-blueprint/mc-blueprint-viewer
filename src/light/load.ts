import type { LoadedScene } from '../scene/types'
import type { LightVolume } from './propagation'

/** Worker の完了後に解決し、成功・失敗とも Worker を終了する。scene の元配列は転送せず保持する。 */
export function loadLight(scene: LoadedScene): Promise<LightVolume> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<LightVolume>) => { worker.terminate(); resolve(event.data) }
    worker.onerror = event => { worker.terminate(); reject(new Error(`光の計算に失敗しました: ${event.message}`)) }
    worker.onmessageerror = () => { worker.terminate(); reject(new Error('光の計算結果を受信できませんでした')) }
    const { size, palette } = scene.document
    worker.postMessage({ size, palette: palette.map(({ emission, opacity }) => ({ emission, opacity })),
      chunks: scene.chunks.map(({ at, size, blocks }) => ({ at, size, blocks })) })
  })
}
