import * as THREE from 'three';

/**
 * Névoa de guerra e camada do chão (decal) dentro dos shaders do three.js.
 *  - `uFogTex`: 1 texel por hexágono (0 = inexplorado, 128 = explorado, 255 = visível),
 *    consultado com a mesma conversão pixel → hexágono de rules/hex.ts (odd-r, pointy-top).
 *  - Inexplorado: o terreno achata em y = 0 e pinta da cor de fundo (não revela montanhas);
 *    objetos (árvores, rios, casas) afundam. Explorado e não visível: escurecido.
 *  - `uDecal`: canvas desenhado pelo renderizador 2D (estradas, fronteiras, alcance…),
 *    projetado de cima no terreno e na água, depois da luz (fica nítido e legível).
 */

export interface SharedUniforms {
  uFogTex: { value: THREE.DataTexture };
  uFogMap: { value: THREE.Vector4 };
  uFogBg: { value: THREE.Vector3 };
  uDecal: { value: THREE.Texture | null };
  uDecalRect: { value: THREE.Vector4 };
}

const FOG_GLSL = /* glsl */ `
uniform sampler2D uFogTex;
uniform vec4 uFogMap; // largura, altura, raio do hexágono, volta (0/1)
float fogAt(vec2 p) {
  float S = uFogMap.z;
  vec2 o = vec2(p.x - S * 0.8660254, p.y - S);
  float q = (0.57735027 * o.x - o.y / 3.0) / S;
  float r = (0.66666667 * o.y) / S;
  float s = -q - r;
  float rq = floor(q + 0.5);
  float rr = floor(r + 0.5);
  float rs = floor(s + 0.5);
  float dq = abs(rq - q);
  float dr = abs(rr - r);
  float ds = abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  float row = rr;
  float col = rq + (rr - mod(rr, 2.0)) * 0.5;
  if (uFogMap.w > 0.5) col = mod(col, uFogMap.x);
  if (row < 0.0 || row >= uFogMap.y || col < 0.0 || col >= uFogMap.x) return 0.0;
  return texture2D(uFogTex, vec2((col + 0.5) / uFogMap.x, (row + 0.5) / uFogMap.y)).r;
}
`;

export type FogMode = 'terrain' | 'sink' | 'water';

/** Instala névoa (e opcionalmente o decal) num material do three.js. */
export function patchMaterial<M extends THREE.Material>(mat: M, u: SharedUniforms, mode: FogMode, decal: boolean): M {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FOG_GLSL}\nvarying vec2 vFogWorld;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 fogW = vec4(transformed, 1.0);
        vec4 fogO = vec4(0.0, 0.0, 0.0, 1.0);
        #ifdef USE_INSTANCING
          fogW = instanceMatrix * fogW;
          fogO = instanceMatrix * fogO;
        #endif
        fogW = modelMatrix * fogW;
        fogO = modelMatrix * fogO;
        vFogWorld = fogW.xz;
        ${
          mode === 'terrain'
            ? 'if (fogAt(fogW.xz) < 0.25) transformed.y = 0.0;'
            : mode === 'sink'
              ? `#ifdef USE_INSTANCING
                   if (fogAt(fogO.xz) < 0.25) transformed.y -= 400.0;
                 #else
                   if (fogAt(fogW.xz) < 0.25) transformed.y -= 400.0;
                 #endif`
              : ''
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\n${FOG_GLSL}\nvarying vec2 vFogWorld;\nuniform vec3 uFogBg;${decal ? '\nuniform sampler2D uDecal;\nuniform vec4 uDecalRect;' : ''}`,
      )
      .replace(
        '#include <dithering_fragment>',
        `float fogF = fogAt(vFogWorld);
        if (fogF < 0.25) {
          gl_FragColor = vec4(uFogBg, 1.0);
        } else {
          if (fogF < 0.75) {
            float l = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
            gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(l), 0.35) * 0.55;
          }
          ${
            decal
              ? `vec2 duv = (vFogWorld - uDecalRect.xy) / uDecalRect.zw;
                 if (duv.x >= 0.0 && duv.y >= 0.0 && duv.x <= 1.0 && duv.y <= 1.0) {
                   vec4 d = texture2D(uDecal, duv);
                   gl_FragColor.rgb = mix(gl_FragColor.rgb, d.rgb, d.a);
                   gl_FragColor.a = max(gl_FragColor.a, d.a);
                 }`
              : ''
          }
        }
        #include <dithering_fragment>`,
      );
  };
  // chaves diferentes por variação (o three reaproveita programas pelo código-fonte)
  mat.customProgramCacheKey = () => `rep6civ-${mode}-${decal ? 1 : 0}`;
  return mat;
}

export function createSharedUniforms(): SharedUniforms {
  const tex = new THREE.DataTexture(new Uint8Array(4), 2, 2, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return {
    uFogTex: { value: tex },
    uFogMap: { value: new THREE.Vector4(1, 1, 32, 0) },
    // cor de fundo já em sRGB (aplicada depois da conversão de espaço de cor)
    uFogBg: { value: new THREE.Vector3(11 / 255, 15 / 255, 20 / 255) },
    uDecal: { value: null },
    uDecalRect: { value: new THREE.Vector4(0, 0, 1, 1) },
  };
}
