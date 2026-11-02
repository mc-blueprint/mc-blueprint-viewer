import { ACESFilmicToneMapping, Color, Fog, LinearToneMapping, NoToneMapping, Vector2 } from 'three'
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import type { RenderQuality } from './quality'

/** vanilla は直接描画。後処理は必要なプリセットだけ確保し、切替時にGPU資源を解放する。 */
export class RenderPipeline {
  private composer?: EffectComposer
  private width = 1
  private height = 1
  constructor(private renderer: WebGLRenderer, private world: Scene, private camera: PerspectiveCamera, private extent: number) {}

  configure(quality: RenderQuality) {
    this.dispose()
    const cinematic = quality.shader === 'cinematic'
    this.renderer.toneMapping = cinematic ? ACESFilmicToneMapping : quality.shader === 'soft' ? LinearToneMapping : NoToneMapping
    this.world.fog = cinematic ? new Fog((this.world.background as Color).clone(), this.extent * 2, this.extent * 6) : null
    if (quality.shader === 'vanilla') return
    const composer = new EffectComposer(this.renderer)
    composer.addPass(new RenderPass(this.world, this.camera))
    if (cinematic && quality.ao) {
      const ssao = new SSAOPass(this.world, this.camera, 1, 1, 16)
      ssao.kernelRadius = 4
      ssao.minDistance = 0.001
      ssao.maxDistance = 0.03
      composer.addPass(ssao)
    }
    composer.addPass(new UnrealBloomPass(new Vector2(1, 1), cinematic ? 0.4 : 0.15, cinematic ? 0.4 : 0.2, 0.65))
    composer.addPass(new OutputPass())
    this.composer = composer
    this.setSize(this.width, this.height)
  }

  setSize(width: number, height: number) {
    this.width = width
    this.height = height
    this.composer?.setSize(width, height)
  }

  render() {
    if (this.composer) this.composer.render()
    else this.renderer.render(this.world, this.camera)
  }

  dispose() {
    this.composer?.passes.forEach(pass => {
      pass.dispose()
      if (pass instanceof SSAOPass) {
        // r187のdisposeではこの2つが解放されない。
        pass.ssaoMaterial.dispose()
        pass.noiseTexture.dispose()
      }
    })
    this.composer?.dispose()
    this.composer = undefined
  }
}
