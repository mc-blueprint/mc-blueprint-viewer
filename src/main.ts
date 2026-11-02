import { PerspectiveCamera, Scene, Vector2, Vector3, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { fetchScene } from './scene/api'
import { loadModels } from './mesh/models'
import { createAtlas } from './mesh/atlas'
import { MeshWorld } from './mesh/world'
import { SpecialWorld, specialTextures } from './special/world'
import { loadLight } from './light/load'
import { lightVertices } from './light/vertices'
import { createLighting } from './light/environment'
import { lightMaterial } from './light/material'
import { mountSelectionUI } from './ui/viewer'
import { RenderPipeline } from './render/pipeline'
import { emptySample, initialQuality, lowerQuality, sampleFrame } from './render/quality'
import type { ShaderPreset } from './render/quality'
import { frameStill, stillOptions } from './render/still'
import './style.css'

const status = document.querySelector<HTMLParagraphElement>('#status')!
const viewport = document.querySelector<HTMLDivElement>('#viewport')!

try {
  const still = stillOptions(new URLSearchParams(location.search))
  if (still) document.body.classList.add('still')
  const loaded = await fetchScene()
  const { document: scene } = loaded
  const renderer = new WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  viewport.append(renderer.domElement)
  status.textContent = 'モデル・テクスチャ・光を読み込んでいます…'
  const [light, models] = await Promise.all([loadLight(loaded), loadModels(scene.palette, scene.minecraftVersion)])
  const atlas = await createAtlas([...new Set([...models.textures, ...specialTextures(loaded)])], scene.minecraftVersion, renderer.capabilities.maxTextureSize)
  const world = new Scene()
  const lighting = createLighting(world, renderer, scene)
  const specials = new SpecialWorld(loaded, atlas, light, lighting.texture, lighting.ao)
  const meshes = new MeshWorld(loaded, models.entries, atlas, undefined, {
    material: layer => lightMaterial({ map: atlas.texture, vertexColors: true,
      transparent: layer === 'translucent', alphaTest: layer === 'opaque' ? 0 : layer === 'cutout' ? 0.5 : 0.01,
      depthWrite: layer !== 'translucent' }, lighting.texture, lighting.ao),
    apply: (geometry, slice) => lightVertices(geometry, light, slice),
  }, specials)
  world.add(meshes.group)
  const size = new Vector3(...scene.size)
  const camera = new PerspectiveCamera(50, 1, 0.1, size.length() * 10)
  camera.position.copy(size).multiplyScalar(1.8)
  const controls = new OrbitControls(camera, renderer.domElement)
  if (!still) mountSelectionUI(loaded, meshes, camera, renderer.domElement)
  controls.enabled = !still
  controls.target.copy(size).multiplyScalar(0.5)
  controls.update()
  const pipeline = new RenderPipeline(renderer, world, camera, size.length())
  let quality = initialQuality(scene.preview)
  let sample = emptySample()
  const applyQuality = () => {
    pipeline.configure(quality)
    lighting.ao.value = quality.ao ? 1 : 0
    lighting.setShadows(quality.shadows, quality.shader !== 'vanilla')
    sample = emptySample()
  }
  applyQuality()
  const panel = document.createElement('div')
  panel.id = 'view-controls'
  panel.innerHTML = `<span>左ドラッグ: 回転 / 右ドラッグ: 移動 / ホイール: 拡大</span>
    <label>シェーダー <select id="shader"><option>vanilla</option><option>soft</option><option>cinematic</option></select></label>
    <label>断面上限 Y <input id="section" type="range" min="0" max="${scene.size[1] - 1}" value="${scene.size[1] - 1}"><output id="section-value">${scene.size[1] - 1}</output></label>
    <label>階（Y）<select id="floor"><option value="all">すべて</option>${Array.from({ length: scene.size[1] }, (_, y) => `<option value="${y}">${y}</option>`).join('')}</select></label>`
  viewport.before(panel)
  const unsupported = document.createElement('p')
  unsupported.id = 'unsupported-entities'
  unsupported.hidden = true
  panel.after(unsupported)
  const section = panel.querySelector<HTMLInputElement>('#section')!
  const floor = panel.querySelector<HTMLSelectElement>('#floor')!
  const shader = panel.querySelector<HTMLSelectElement>('#shader')!
  shader.value = quality.shader
  let ready = false
  let frames = 0
  let lastFrame: number | undefined
  const frameTimes: number[] = []
  document.addEventListener('visibilitychange', () => { lastFrame = undefined; sample = emptySample() })
  const refresh = async () => {
    ready = false
    lastFrame = undefined
    sample = emptySample()
    status.dataset.ready = 'false'
    const y = floor.value === 'all' ? undefined : Number(floor.value)
    const slice = { minY: y ?? 0, maxY: Math.min(y ?? Infinity, Number(section.value)) }
    const drawDistance = quality.distance === 1 ? Infinity : Math.max(16, camera.position.distanceTo(size.clone().multiplyScalar(0.5)) + size.length() * (quality.distance - 0.5))
    const done = await meshes.update(camera.position, slice, drawDistance)
    if (!done) return false
    unsupported.hidden = specials.unsupportedEntities.length === 0
    unsupported.textContent = unsupported.hidden ? '' : `簡易表示のブロックエンティティ: ${specials.unsupportedEntities.join('、')}`
    pipeline.render()
    ready = true
    status.setAttribute('role', 'status')
    const stats = meshes.stats
    status.textContent = `${scene.minecraftVersion} / ${scene.size.join(' × ')} / scene 検証済み / ${stats.chunks} チャンク / ${stats.faces.toLocaleString()} 面`
    status.dataset.ready = 'true'
    return true
  }
  const fail = (error: unknown) => {
    ready = false
    status.textContent = error instanceof Error ? error.message : String(error)
    status.setAttribute('role', 'alert')
    status.dataset.ready = 'false'
  }
  let timer: ReturnType<typeof setTimeout>
  /** 現在の視点・断面の構築と後処理を含む1フレームを完了する。同時更新で中断された場合はrejectする。 */
  const renderFrame = async () => {
    clearTimeout(timer)
    resize()
    if (!await refresh()) throw new Error('別の更新によって描画が中断されました')
    renderer.getContext().finish()
  }
  /** sceneは変更せず、指定プリセットから自動品質判定を再開する。描画失敗は呼出し元へ返す。 */
  const setPreset = async (preset: ShaderPreset) => {
    quality = initialQuality({ ...scene.preview, shader: preset })
    shader.value = preset
    applyQuality()
    await renderFrame()
  }
  shader.addEventListener('change', () => { void setPreset(shader.value as ShaderPreset).catch(fail) })
  controls.addEventListener('change', () => {
    ready = false
    status.dataset.ready = 'false'
    clearTimeout(timer)
    timer = setTimeout(() => { void refresh().catch(fail) }, 150)
  })
  section.addEventListener('input', () => {
    panel.querySelector('output')!.textContent = section.value
    void refresh().catch(fail)
  })
  floor.addEventListener('change', () => { void refresh().catch(fail) })
  const resize = () => {
    const width = viewport.clientWidth, height = viewport.clientHeight
    const current = renderer.getSize(new Vector2())
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    if (current.x === width && current.y === height) return
    renderer.setSize(width, height)
    pipeline.setSize(width, height)
  }
  new ResizeObserver(resize).observe(viewport)
  resize()
  renderer.setAnimationLoop(() => {
    const now = performance.now()
    if (ready && !document.hidden && lastFrame !== undefined) {
      const elapsed = now - lastFrame
      frameTimes.push(elapsed)
      if (frameTimes.length > 600) frameTimes.shift()
      frames++
      if (!still && scene.preview.quality === 'auto') {
        const measurement = sampleFrame(sample, elapsed)
        sample = measurement.sample
        if (measurement.lower) {
          const next = lowerQuality(quality)
          if (next !== quality) {
            quality = next
            shader.value = quality.shader
            applyQuality()
            void refresh().catch(fail)
          }
        }
      }
    } else {
      sample = emptySample()
    }
    lastFrame = ready && !document.hidden ? now : undefined
    try { pipeline.render() } catch (error) { renderer.setAnimationLoop(null); fail(error) }
  })
  Object.assign(window, { viewer: { loaded, meshes, specials, camera, controls, renderer, light,
    setPreset, renderFrame,
    get quality() { return { ...quality } },
    get ready() { return ready },
    get metrics() { return { ...meshes.stats, frames, fps: 1000 / (frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length) } },
  } })
  if (still) {
    frameStill(camera, controls, size, still.view)
    await setPreset(still.preset)
  } else await refresh()
} catch (error) {
  status.textContent = error instanceof Error ? error.message : String(error)
  status.setAttribute('role', 'alert')
}
