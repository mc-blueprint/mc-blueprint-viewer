import type { DecodedChunk, PaletteEntry, Vec3 } from '../scene/types'

export interface LightInput {
  size: Vec3
  palette: Pick<PaletteEntry, 'emission' | 'opacity'>[]
  chunks: Pick<DecodedChunk, 'at' | 'size' | 'blocks'>[]
}
export interface LightVolume {
  size: Vec3
  sky: Uint8Array
  block: Uint8Array
  opacity: Uint8Array
}

/** scene 全体を計算する。省略チャンクは空気、外周からの流入は上空だけとする。入力配列は変更しない。 */
export function propagateLight(input: LightInput): LightVolume {
  const [width, height, depth] = input.size
  const plane = width * depth
  const count = plane * height
  const sky = new Uint8Array(count)
  const block = new Uint8Array(count)
  const opacity = new Uint8Array(count)
  for (const chunk of input.chunks) {
    let source = 0
    for (let y = 0; y < chunk.size[1]; y++) for (let z = 0; z < chunk.size[2]; z++) for (let x = 0; x < chunk.size[0]; x++) {
      const index = ((y + chunk.at[1]) * depth + z + chunk.at[2]) * width + x + chunk.at[0]
      const entry = input.palette[chunk.blocks[source++]]
      opacity[index] = entry.opacity
      block[index] = entry.emission
    }
  }
  for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) {
    let value = 15
    for (let y = height - 1; y >= 0; y--) {
      const index = (y * depth + z) * width + x
      value = Math.max(0, value - (value === 15 && opacity[index] === 0 ? 0 : Math.max(1, opacity[index])))
      sky[index] = value
    }
  }
  // リングと在列フラグを共用し、再伝播でも待ち行列を体積以下に保つ。
  const queue = new Uint32Array(count + 1)
  const queued = new Uint8Array(count)
  for (const values of [sky, block]) {
    let head = 0, tail = 0
    const enqueue = (index: number) => {
      if (queued[index]) return
      queued[index] = 1
      queue[tail] = index
      tail = (tail + 1) % queue.length
    }
    for (let i = 0; i < count; i++) if (values[i] > 1) enqueue(i)
    const spread = (from: number, to: number) => {
      const value = values[from] - Math.max(1, opacity[to])
      if (value <= values[to]) return
      values[to] = value
      enqueue(to)
    }
    while (head !== tail) {
      const i = queue[head]
      head = (head + 1) % queue.length
      queued[i] = 0
      const x = i % width, z = Math.floor(i / width) % depth
      if (x > 0) spread(i, i - 1)
      if (x + 1 < width) spread(i, i + 1)
      if (z > 0) spread(i, i - width)
      if (z + 1 < depth) spread(i, i + width)
      if (i >= plane) spread(i, i - plane)
      if (i + plane < count) spread(i, i + plane)
    }
  }
  return { size: input.size, sky, block, opacity }
}
