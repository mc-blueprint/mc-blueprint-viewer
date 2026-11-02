import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { fetchScene } from './scene/api'
import { loadModels } from './mesh/models'
import { createAtlas } from './mesh/atlas'
import { MeshWorld } from './mesh/world'
import { loadLight } from './light/load'
import { lightVertices } from './light/vertices'
import { createLighting } from './light/environment'
import { lightMaterial } from './light/material'
import { mountSelectionUI } from './ui/viewer'
import './style.css'

const status = document.querySelector<HTMLParagraphElement>('#status')!
const viewport = document.querySelector<HTMLDivElement>('#viewport')!

try {
  const loaded = await fetchScene()
  const { document: scene } = loaded
  const renderer = new WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  viewport.append(renderer.domElement)
  status.textContent = 'モデル・テクスチャ・光を読み込んでいます…'
  const [light, models] = await Promise.all([loadLight(loaded), loadModels(scene.palette, scene.minecraftVersion)])
  const atlas = await createAtlas(models.textures, scene.minecraftVersion, renderer.capabilities.maxTextureSize)
  const world = new Scene()
  const lighting = createLighting(world, renderer, scene)
  const meshes = new MeshWorld(loaded, models.entries, atlas, undefined, {
    material: layer => lightMaterial({ map: atlas.texture, vertexColors: true,
      transparent: layer === 'translucent', alphaTest: layer === 'opaque' ? 0 : layer === 'cutout' ? 0.5 : 0.01,
      depthWrite: layer !== 'translucent' }, lighting.texture),
    apply: (geometry, slice) => lightVertices(geometry, light, slice),
  })
  world.add(meshes.group)
  const size = new Vector3(...scene.size)
  const camera = new PerspectiveCamera(50, 1, 0.1, size.length() * 10)
  camera.position.copy(size).multiplyScalar(1.8)
  const controls = new OrbitControls(camera, renderer.domElement)
  mountSelectionUI(loaded, meshes, camera, renderer.domElement)
  controls.target.copy(size).multiplyScalar(0.5)
  controls.update()
  const panel = document.createElement('div')
  panel.id = 'view-controls'
  panel.innerHTML = `<span>左ドラッグ: 回転 / 右ドラッグ: 移動 / ホイール: 拡大</span>
    <label>断面上限 Y <input id="section" type="range" min="0" max="${scene.size[1] - 1}" value="${scene.size[1] - 1}"><output id="section-value">${scene.size[1] - 1}</output></label>
    <label>階（Y）<select id="floor"><option value="all">すべて</option>${Array.from({ length: scene.size[1] }, (_, y) => `<option value="${y}">${y}</option>`).join('')}</select></label>`
  viewport.before(panel)
  const section = panel.querySelector<HTMLInputElement>('#section')!
  const floor = panel.querySelector<HTMLSelectElement>('#floor')!
  let ready = false
  let frames = 0
  let lastFrame = performance.now()
  const frameTimes: number[] = []
  const refresh = async () => {
    ready = false
    status.dataset.ready = 'false'
    const y = floor.value === 'all' ? undefined : Number(floor.value)
    const done = await meshes.update(camera.position, { minY: y ?? 0, maxY: Math.min(y ?? Infinity, Number(section.value)) })
    if (!done) return
    ready = true
    status.setAttribute('role', 'status')
    const stats = meshes.stats
    status.textContent = `${scene.minecraftVersion} / ${scene.size.join(' × ')} / scene 検証済み / ${stats.chunks} チャンク / ${stats.faces.toLocaleString()} 面`
    status.dataset.ready = 'true'
  }
  const fail = (error: unknown) => {
    status.textContent = error instanceof Error ? error.message : String(error)
    status.setAttribute('role', 'alert')
    status.dataset.ready = 'false'
  }
  let timer: ReturnType<typeof setTimeout>
  controls.addEventListener('change', () => {
    clearTimeout(timer)
    timer = setTimeout(() => { void refresh().catch(fail) }, 150)
  })
  section.addEventListener('input', () => {
    panel.querySelector('output')!.textContent = section.value
    void refresh().catch(fail)
  })
  floor.addEventListener('change', () => { void refresh().catch(fail) })
  new ResizeObserver(() => {
    renderer.setSize(viewport.clientWidth, viewport.clientHeight)
    camera.aspect = viewport.clientWidth / viewport.clientHeight
    camera.updateProjectionMatrix()
  }).observe(viewport)
  renderer.setAnimationLoop(() => {
    const now = performance.now()
    if (ready) {
      frameTimes.push(now - lastFrame)
      if (frameTimes.length > 600) frameTimes.shift()
      frames++
    }
    lastFrame = now
    renderer.render(world, camera)
  })
  Object.assign(window, { viewer: { loaded, meshes, camera, controls, renderer, light,
    get ready() { return ready },
    get metrics() { return { ...meshes.stats, frames, fps: 1000 / (frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length) } },
  } })
  await refresh()
} catch (error) {
  status.textContent = error instanceof Error ? error.message : String(error)
  status.setAttribute('role', 'alert')
}
