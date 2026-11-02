import { validateScene } from '../schema/validate'
import type { LoadedScene, Vec3 } from './types'

function decode(data: string, count: number, width: 16 | 32) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    throw new Error('チャンクの base64 が不正です')
  }
  const raw = Uint8Array.from(atob(data), c => c.charCodeAt(0))
  if (raw.byteLength !== count * width / 8) throw new Error('チャンクの配列長が実寸と一致しません')
  const view = new DataView(raw.buffer)
  const values = width === 16 ? new Uint16Array(count) : new Uint32Array(count)
  for (let i = 0; i < count; i++) values[i] = width === 16 ? view.getUint16(i * 2, true) : view.getUint32(i * 4, true)
  return values
}

/** スキーマとチャンクの意味制約を検証し、実寸・リトルエンディアンの配列に展開する。不正な入力は例外。 */
export function decodeScene(input: unknown) {
  if (!validateScene(input)) throw new Error(`scene のスキーマ違反: ${JSON.stringify(validateScene.errors)}`)
  const document = input
  if (document.indexWidth !== (document.palette.length > 65536 ? 32 : 16)) throw new Error('palette と indexWidth が一致しません')
  const ids = new Set(document.sources.map(source => source.id))
  if (ids.size !== document.sources.length) throw new Error('生成元 ID が重複しています')
  ids.add(0)
  const positions = new Set<string>()
  const chunks = document.chunks.map(chunk => {
    if (chunk.at.some((v, axis) => v < 0 || v >= document.size[axis] || v % 16 !== 0)) throw new Error('チャンク座標が範囲外または16の倍数ではありません')
    const key = chunk.at.join(',')
    if (positions.has(key)) throw new Error('チャンク座標が重複しています')
    positions.add(key)
    const size = chunk.at.map((v, axis) => Math.min(16, document.size[axis] - v)) as Vec3
    const count = size[0] * size[1] * size[2]
    const blocks = decode(chunk.blocks, count, document.indexWidth)
    const sources = decode(chunk.sources, count, 32) as Uint32Array
    if (blocks.some(id => id >= document.palette.length)) throw new Error('palette 添字が範囲外です')
    if (sources.some(id => !ids.has(id))) throw new Error('未定義の生成元 ID です')
    return { at: chunk.at, size, blocks, sources }
  })
  for (const entity of document.blockEntities) {
    if (entity.at.some((v, axis) => v < 0 || v >= document.size[axis])) throw new Error('blockEntity の座標が範囲外です')
  }
  return { document, chunks }
}

/** gzip または展開済み UTF-8 JSON を読む。HTTP が Content-Encoding で展開した入力にも対応する。 */
export async function loadScene(bytes: Uint8Array): Promise<LoadedScene> {
  const buffer = Uint8Array.from(bytes).buffer
  const json = bytes[0] === 0x1f && bytes[1] === 0x8b
    ? await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    : buffer
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', json)), b => b.toString(16).padStart(2, '0')).join('')
  const input: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json))
  return { ...decodeScene(input), sha256 }
}
