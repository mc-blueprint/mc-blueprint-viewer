import { CanvasTexture, NearestFilter, SRGBColorSpace } from 'three'
import { fetchAsset } from '../scene/api'
import { assetPath } from './models'

export type Layer = 'opaque' | 'cutout' | 'translucent'
export interface Tile { u: number; v: number; width: number; height: number; layer: Layer }
export interface Atlas { texture: CanvasTexture; tiles: Map<string, Tile>; bytes: number }

/** PNG の先頭フレームを使う。1px の縁を複製し、隣のタイルの混入を防ぐ。 */
export async function createAtlas(ids: string[], version: string, maxSize: number): Promise<Atlas> {
  const images = await Promise.all(ids.map(async id => createImageBitmap(await (await fetchAsset(version, assetPath(id, 'textures', 'png'))).blob())))
  try {
    const cell = Math.max(1, ...images.map(image => image.width)) + 2
    const columns = Math.max(1, Math.ceil(Math.sqrt(ids.length)))
    const width = columns * cell, height = Math.max(1, Math.ceil(ids.length / columns)) * cell
    if (width > maxSize || height > maxSize) throw new Error(`テクスチャアトラスが GPU の上限 (${maxSize}px) を超えています`)
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    const tiles = new Map<string, Tile>()
    for (const [i, image] of images.entries()) {
      const x = (i % columns) * cell + 1, y = Math.floor(i / columns) * cell + 1
      const size = image.width
      context.drawImage(image, 0, 0, size, Math.min(size, image.height), x, y, size, size)
      const pixels = context.getImageData(x, y, size, size).data
      let layer: Layer = 'opaque'
      for (let p = 3; p < pixels.length; p += 4) {
        if (pixels[p] > 0 && pixels[p] < 255) { layer = 'translucent'; break }
        if (pixels[p] === 0) layer = 'cutout'
      }
      context.drawImage(canvas, x, y, size, 1, x, y - 1, size, 1)
      context.drawImage(canvas, x, y + size - 1, size, 1, x, y + size, size, 1)
      context.drawImage(canvas, x, y - 1, 1, size + 2, x - 1, y - 1, 1, size + 2)
      context.drawImage(canvas, x + size - 1, y - 1, 1, size + 2, x + size, y - 1, 1, size + 2)
      tiles.set(ids[i], { u: x / width, v: y / height, width: size / width, height: size / height, layer })
    }
    const texture = new CanvasTexture(canvas)
    texture.flipY = false
    texture.colorSpace = SRGBColorSpace
    texture.magFilter = NearestFilter; texture.minFilter = NearestFilter; texture.generateMipmaps = false
    return { texture, tiles, bytes: width * height * 4 }
  } finally {
    images.forEach(image => image.close())
  }
}
