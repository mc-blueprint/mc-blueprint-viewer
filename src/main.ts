import { Box3, Box3Helper, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { fetchScene } from './scene/api'
import './style.css'

const status = document.querySelector<HTMLParagraphElement>('#status')!
const viewport = document.querySelector<HTMLDivElement>('#viewport')!

try {
  const loaded = await fetchScene()
  const { document: scene } = loaded
  status.textContent = `${scene.minecraftVersion} / ${scene.size.join(' × ')} / ${loaded.chunks.length} チャンク（scene 検証済み・メッシュ描画は #2）`
  const renderer = new WebGLRenderer({ antialias: true })
  viewport.append(renderer.domElement)
  const world = new Scene()
  const size = new Vector3(...scene.size)
  world.add(new Box3Helper(new Box3(new Vector3(), size), 0x8ac9ff))
  const camera = new PerspectiveCamera(50, 1, 0.1, size.length() * 10)
  camera.position.copy(size).multiplyScalar(1.8)
  camera.lookAt(size.clone().multiplyScalar(0.5))
  new ResizeObserver(() => {
    renderer.setSize(viewport.clientWidth, viewport.clientHeight)
    camera.aspect = viewport.clientWidth / viewport.clientHeight
    camera.updateProjectionMatrix()
    renderer.render(world, camera)
  }).observe(viewport)
} catch (error) {
  status.textContent = error instanceof Error ? error.message : String(error)
  status.setAttribute('role', 'alert')
}
