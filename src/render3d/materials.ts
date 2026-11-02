import * as THREE from 'three';

/**
 * Névoa de guerra e camada do chão (decal) dentro dos shaders do three.js.
 *  - `uFogTex`: 1 texel por hexágono (0 = inexplorado, 128 = explorado, 255 = visível),
 *    consultado com a mesma conversão pixel → hexágono de rules/hex.ts (odd-r, pointy-top).
 *  - Inexplorado: o terreno achata em y = 0 e pinta da cor de fundo (não revela montanhas);
 *    objetos (árvores, rios, casas) afundam. Explorado e não visível: escurecido.
 *  - Inexplorado ganha nuvens animadas (`uTime`); a água ondula e faz espuma no raso.
 *  - Sombras: `depthMaterialFor` aplica o mesmo achatamento/afundamento no passe de sombra,
 *    para nada escondido projetar sombra na área conhecida.
 *  - `uDecal`: canvas desenhado pelo renderizador 2D (estradas, fronteiras, alcance…),
 *    projetado de cima no terreno e na água, depois da luz (fica nítido e legível).
 */

export interface SharedUniforms {
  uFogTex: { value: THREE.DataTexture };
  uFogMap: { value: THREE.Vector4 };
  uFogBg: { value: THREE.Vector3 };
  uDecal: { value: THREE.Texture | null };
  uDecalRect: { value: THREE.Vector4 };
  uTime: { value: number };
}

const FOG_GLSL = /* glsl */ `
uniform sampler2D uFogTex;
uniform vec4 uFogMap; // largura, altura, raio do hexágono, volta (0/1)
uniform float uTime;
float rep6Hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float rep6Noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = rep6Hash(i);
  float b = rep6Hash(i + vec2(1.0, 0.0));
  float c = rep6Hash(i + vec2(0.0, 1.0));
  float d = rep6Hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
/** Nuvens sobre o inexplorado (em sRGB). */
vec3 rep6Clouds(vec2 p, vec3 bg) {
  vec2 q = p * 0.0055 + vec2(uTime * 0.012, uTime * 0.005);
  float n = 0.55 * rep6Noise(q) + 0.3 * rep6Noise(q * 2.3 + 3.1) + 0.15 * rep6Noise(q * 5.1 - 1.7);
  return mix(bg, vec3(0.30, 0.35, 0.43), smoothstep(0.38, 0.9, n));
}
/** 0 no miolo do hexágono, 1 na aresta (para a grade discreta). */
float rep6HexEdge(vec2 p) {
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
  vec2 c = vec2(S * 1.7320508 * (rq + rr * 0.5) + S * 0.8660254, S * 1.5 * rr + S);
  vec2 d = p - c;
  float dist = max(abs(d.x), max(abs(0.5 * d.x + 0.8660254 * d.y), abs(-0.5 * d.x + 0.8660254 * d.y)));
  return smoothstep(0.9, 0.99, dist / (S * 0.8660254));
}
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
        '#include <color_fragment>',
        `#include <color_fragment>
        ${
          mode === 'terrain'
            ? `{
                 float d1 = rep6Noise(vFogWorld * 0.11);
                 float d2 = rep6Noise(vFogWorld * 0.43 + 7.0);
                 float d3 = rep6Noise(vFogWorld * 1.7 - 3.0);
                 diffuseColor.rgb *= 0.84 + 0.16 * d1 + 0.11 * d2 + 0.09 * d3;
                 diffuseColor.rgb *= 1.0 - 0.13 * rep6HexEdge(vFogWorld);
               }`
            : ''
        }`,
      )
      .replace(
        '#include <dithering_fragment>',
        `${
          mode === 'water'
            ? `float rw1 = sin(vFogWorld.x * 0.09 + uTime * 1.3) * sin(vFogWorld.y * 0.07 - uTime * 1.1);
               float rw2 = sin((vFogWorld.x + vFogWorld.y) * 0.045 - uTime * 0.8);
               gl_FragColor.rgb += vec3(0.05, 0.07, 0.08) * (rw1 * 0.6 + rw2 * 0.4);
               float rShallow = 1.0 - smoothstep(0.725, 0.765, gl_FragColor.a);
               gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.9, 0.95, 1.0), rShallow * (0.3 + 0.2 * sin(uTime * 2.0 + (vFogWorld.x - vFogWorld.y) * 0.12)));`
            : ''
        }
        float fogF = fogAt(vFogWorld);
        // borda irregular: as nuvens avançam um pouco sobre o conhecido (nunca o contrário)
        vec2 rJit = (vec2(rep6Noise(vFogWorld * 0.045 + uTime * 0.02), rep6Noise(vFogWorld * 0.045 + 9.0)) - 0.5) * 26.0;
        if (fogF >= 0.25 && fogAt(vFogWorld + rJit) < 0.25) fogF = 0.0;
        if (fogF < 0.25) {
          gl_FragColor = vec4(rep6Clouds(vFogWorld, uFogBg), 1.0);
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

/** Material do passe de sombra com o mesmo tratamento da névoa no vértice. */
export function depthMaterialFor(u: SharedUniforms, mode: 'terrain' | 'sink'): THREE.MeshDepthMaterial {
  return patchMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), u, mode, false);
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
    uTime: { value: 0 },
  };
}
