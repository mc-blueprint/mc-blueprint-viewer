import { propagateLight } from './propagation'
import type { LightInput } from './propagation'

self.onmessage = (event: MessageEvent<LightInput>) => {
  const result = propagateLight(event.data)
  self.postMessage(result, { transfer: [result.sky.buffer, result.block.buffer, result.opacity.buffer] })
}
