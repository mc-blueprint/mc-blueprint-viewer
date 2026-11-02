import { MeshLambertMaterial } from 'three'
import type { DataTexture, MeshLambertMaterialParameters } from 'three'

/** アトラスの色・アルファは標準マテリアルへ任せ、光属性と太陽の影だけを合成する。 */
export function lightMaterial(parameters: MeshLambertMaterialParameters, texture: DataTexture, ao = { value: 1 }): MeshLambertMaterial {
  const material = new MeshLambertMaterial(parameters)
  material.onBeforeCompile = shader => {
    shader.uniforms.voxelLightMap = { value: texture }
    shader.uniforms.voxelAO = ao
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute vec3 light;
varying vec3 vVoxelLight;
varying float vFaceShade;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vVoxelLight = light;
vec3 n = normalize(mat3(modelMatrix) * normal);
vFaceShade = dot(n * n, vec3(0.6, n.y > 0.0 ? 1.0 : 0.5, 0.8));`)
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D voxelLightMap;
uniform float voxelAO;
varying vec3 vVoxelLight;
varying float vFaceShade;`).replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>')
      .replace('#include <lights_lambert_fragment>', '').replace('#include <lights_fragment_begin>', '')
      .replace('#include <lights_fragment_maps>', '').replace('#include <lights_fragment_end>', '')
      .replace('vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;', `
vec2 levels = clamp(vVoxelLight.xy, 0.0, 15.0);
levels.x *= mix(0.55, 1.0, getShadowMask());
vec3 illumination = texture2D(voxelLightMap, (levels + 0.5) / 16.0).rgb;
vec3 outgoingLight = diffuseColor.rgb * illumination * mix(1.0, vVoxelLight.z, voxelAO) * vFaceShade;`)
  }
  material.customProgramCacheKey = () => 'voxel-light-v1'
  return material
}
