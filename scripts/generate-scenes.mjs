import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

export const scenarios = ['representative', 'castle', 'town', 'terrain', 'underground', 'vegetation']

function entry(state, render = 'model', opacity = 15, tint = 'none', emission = 0) {
  return { state: `minecraft:${state}`, render, opacity, tint, emission }
}

const palette = [
  entry('air', 'invisible', 0), entry('stone_bricks'), entry('grass_block', 'model', 15, 'grass'),
  entry('oak_log[axis=x]'), entry('oak_leaves[persistent=true,distance=1,waterlogged=false]', 'model', 1, 'foliage'),
  entry('water[level=0]', 'fluid', 1, 'water'),
  entry('oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]'),
  entry('oak_fence[east=true,north=false,south=false,west=true,waterlogged=false]'),
  entry('glass_pane[east=true,north=false,south=false,west=true,waterlogged=false]', 'model', 0),
  entry('oak_door[facing=north,half=lower,hinge=left,open=false,powered=false]', 'model', 0),
  entry('oak_door[facing=north,half=upper,hinge=left,open=false,powered=false]', 'model', 0),
  entry('stone'), entry('chest[facing=north,type=single,waterlogged=false]', 'entity'),
  entry('red_bed[facing=north,part=foot,occupied=false]', 'entity', 0),
  entry('red_bed[facing=north,part=head,occupied=false]', 'entity', 0),
  entry('torch', 'model', 0, 'none', 14),
  entry('chorus_plant[down=false,east=true,north=false,south=false,up=false,west=true]', 'model', 0),
  entry('chest[facing=north,type=left,waterlogged=false]', 'entity'),
  entry('chest[facing=north,type=right,waterlogged=false]', 'entity'),
  entry('lava[level=0]', 'fluid', 0, 'none', 15),
]

/** Mojang のモデル・画像を含まない、決定的な性能測定用sceneを作る。 */
export function makeScene(name = 'representative', size = name === 'representative' ? [32, 16, 16] : [256, 128, 256], version = '1.21.11') {
  if (!scenarios.includes(name)) throw new Error(`不明な scene: ${name}`)
  if (size.some(v => !Number.isInteger(v) || v < 1)) throw new Error('scene の寸法が不正です')
  const entities = []
  const chunks = []
  function block(x, y, z) {
    if (name === 'representative') {
      if (y === 0) return 1
      if (x === 19 && z === 3 && y === 1) return 11
      if (z === 3 && x >= 2 && x <= 22 && x % 2 === 0) {
        const exhibits = [6, 7, 8, 9, 4, 5, 3, 7, 12, 17, 13]
        const id = exhibits[(x - 2) / 2]
        if (y === 1) return id
        if (y === 2 && id === 9) return 10
      }
      if (x === 21 && z === 3 && y === 1) return 18
      if (x === 22 && z === 2 && y === 1) return 14
      if (x === 24 && z === 3 && y === 1) return 15
      if (x === 26 && z === 3 && y === 1) return 16
      if (x === 28 && z === 3 && y === 1) return 19
      return 0
    }
    const height = 12 + Math.floor(6 * Math.sin(x / 19) * Math.cos(z / 23))
    if (name === 'terrain') return y < height - 1 ? 11 : y === height - 1 ? 2 : y < 12 ? 5 : 0
    if (name === 'underground') return y < 48 && !(y > 5 && y < 40 && ((x % 32 > 5 && x % 32 < 26) || (z % 32 > 5 && z % 32 < 26))) ? 11 : 0
    if (y === 0) return 2
    if (name === 'vegetation') {
      if (y < 8 && x % 8 === 4 && z % 8 === 4) return 3
      return y >= 6 && y < 11 && x % 8 >= 2 && x % 8 <= 6 && z % 8 >= 2 && z % 8 <= 6 ? 4 : 0
    }
    if (name === 'town') {
      const a = x % 24, b = z % 24
      if (a > 2 && a < 20 && b > 2 && b < 20) {
        if (y === 16) return 3
        if (y < 16 && (a === 3 || a === 19 || b === 3 || b === 19)) return y % 4 === 0 ? 3 : 1
      }
      return 0
    }
    const wall = x < 5 || z < 5 || x >= size[0] - 5 || z >= size[2] - 5
    const tower = (x < 24 || x >= size[0] - 24) && (z < 24 || z >= size[2] - 24)
    const keep = Math.abs(x - size[0] / 2) < 28 && Math.abs(z - size[2] / 2) < 28
    return ((wall && y < 36) || (tower && y < 72) || (keep && y < 64)) && (x % 16 < 3 || z % 16 < 3 || y % 12 === 0) ? 1 : 0
  }
  for (let cy = 0; cy < size[1]; cy += 16) for (let cz = 0; cz < size[2]; cz += 16) for (let cx = 0; cx < size[0]; cx += 16) {
    const extent = [cx, cy, cz].map((v, axis) => Math.min(16, size[axis] - v))
    const count = extent[0] * extent[1] * extent[2]
    const blocks = Buffer.alloc(count * 2), sources = Buffer.alloc(count * 4)
    let index = 0, occupied = false
    for (let y = 0; y < extent[1]; y++) for (let z = 0; z < extent[2]; z++) for (let x = 0; x < extent[0]; x++) {
      const id = block(cx + x, cy + y, cz + z)
      blocks.writeUInt16LE(id, index * 2)
      sources.writeUInt32LE(id ? 1 : 0, index * 4)
      index++
      occupied ||= id !== 0
      if (palette[id].render === 'entity') {
        const block = palette[id].state.split('[')[0].split(':').at(-1)
        entities.push({ at: [cx + x, cy + y, cz + z], id: block.endsWith('_bed') ? 'minecraft:bed' : 'minecraft:chest' })
      }
    }
    if (occupied) chunks.push({ at: [cx, cy, cz], blocks: blocks.toString('base64'), sources: sources.toString('base64') })
  }
  return {
    formatVersion: 1, minecraftVersion: version, engine: { version: 'fixture-v1', commit: 'viewer-issue-1' },
    source: { kind: 'spec', path: `fixtures/${name}`, sha256: createHash('sha256').update(JSON.stringify({ name, size, version })).digest('hex') },
    size, origin: [0, 0, 0], palette, chunks, indexWidth: 16,
    sources: [{ id: 1, element: `${name}#1`, label: name }], blockEntities: entities,
    environment: { biome: 'plains', tints: { grass: { l: 0.7, a: -0.1, b: 0.12 }, foliage: { l: 0.65, a: -0.1, b: 0.1 }, water: { l: 0.5, a: 0, b: -0.15 } } },
    preview: { enabled: true, shader: 'vanilla', shadows: false, brightness: 0.5, timeOfDay: 6000, blockLight: true, quality: 'low' },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const out = resolve('.dev-scenes')
  await mkdir(out, { recursive: true })
  const version = process.argv[2] ?? '1.21.11'
  for (const name of scenarios) {
    const bytes = Buffer.from(JSON.stringify(makeScene(name, undefined, version)))
    await writeFile(resolve(out, `${name}.scene.json.gz`), gzipSync(bytes))
    console.log(`${name}: ${bytes.length} bytes (JSON)`)
  }
}
