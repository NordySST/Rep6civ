import * as THREE from 'three';
import type { Camera } from '../render/camera';
import { HEX_SIZE, nearCenter, type Overlay, type Renderer, worldPeriod } from '../render/renderer';
import type { MapView } from '../render/view';
import { SQRT3 } from '../rules/hex';
import type { GameState } from '../state/types';
import { createSharedUniforms, patchMaterial, type SharedUniforms } from './materials';
import { TerrainField, WATER_LEVEL } from './terrain';
import { buildCities, buildRivers, buildTerrain, buildTrees, buildWater, citySignature } from './world';

/**
 * Visão 3D do mapa (WebGL/three.js), carregada sob demanda. Mesma câmera lógica do 2D:
 * (x, y) = ponto do mundo no centro da tela e `zoom` = pixels por unidade no centro.
 * A câmera fica ao sul, inclinada (mais de cima quando afastada). Ícones, estandartes e
 * unidades são desenhados pelo renderizador 2D no canvas de cima (`sprites`), em pé sobre
 * os pontos projetados; fronteiras, estradas e realces vão numa textura projetada no chão.
 */

const FOV = 35;
const MAX_DECAL_PX = 2048;

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

/** Inclinação (graus acima do horizonte) conforme o zoom. */
function pitchFor(zoom: number): number {
  const t = Math.max(0, Math.min(1, (zoom - 0.25) / 1.25));
  return 64 - 16 * t;
}

export class Renderer3D implements MapView {
  readonly kind = '3d';
  vw = 0;
  vh = 0;
  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 4, 20000);
  private uniforms: SharedUniforms;
  private mats: { terrain: THREE.Material; water: THREE.Material; river: THREE.Material; trees: THREE.Material; city: THREE.Material };
  private world = new THREE.Group();
  private parts: { terrain?: THREE.Group; water?: THREE.Group; rivers?: THREE.Mesh | null; trees?: THREE.Group; cities?: THREE.Group } = {};
  private copies: THREE.Group[] = [];
  private field?: TerrainField;
  private terrainSig = -1;
  private citySig = '';
  private fogKey: unknown[] = [];
  private decalCanvas = document.createElement('canvas');
  private decalTex: THREE.CanvasTexture;
  private decalPainter: Renderer;
  private decalRegion?: { x: number; y: number; w: number; h: number; scale: number };
  private decalKey = '';
  private lastState?: GameState;
  private ray = new THREE.Raycaster();
  private v3 = new THREE.Vector3();

  constructor(
    glCanvas: HTMLCanvasElement,
    private sprites: Renderer,
    makePainter: (c: HTMLCanvasElement) => Renderer,
  ) {
    this.gl = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.setClearColor(0x0b0f14, 1);
    this.uniforms = createSharedUniforms();
    this.decalTex = new THREE.CanvasTexture(this.decalCanvas);
    this.decalTex.colorSpace = THREE.NoColorSpace;
    this.decalTex.flipY = false;
    this.decalTex.generateMipmaps = false;
    this.decalTex.minFilter = THREE.LinearFilter;
    this.uniforms.uDecal.value = this.decalTex;
    this.decalPainter = makePainter(this.decalCanvas);
    const u = this.uniforms;
    this.mats = {
      terrain: patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), u, 'terrain', true),
      water: patchMaterial(
        new THREE.MeshPhongMaterial({ vertexColors: true, transparent: true, shininess: 90, specular: 0x6f8fa8 }),
        u,
        'water',
        true,
      ),
      river: patchMaterial(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: 0x557799 }), u, 'sink', false),
      trees: patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), u, 'sink', false),
      city: patchMaterial(new THREE.MeshLambertMaterial({ flatShading: true }), u, 'sink', false),
    };
    // luz: céu suave + sol baixo a noroeste (sombras de relevo legíveis)
    this.scene.add(new THREE.HemisphereLight(0xeaf2ff, 0x4a3f2c, 1.5));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
    sun.position.set(-0.55, 1, -0.45);
    this.scene.add(sun);
    this.scene.fog = new THREE.Fog(0x22303e, 4000, 9000);
    this.scene.add(this.world);
  }

  resize(): void {
    this.sprites.resize();
    this.vw = this.sprites.vw;
    this.vh = this.sprites.vh;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(this.vw, this.vh, false);
    this.camera.aspect = this.vw / Math.max(1, this.vh);
  }

  dispose(): void {
    this.world.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
    });
    Object.values(this.mats).forEach((m) => m.dispose());
    this.decalTex.dispose();
    this.uniforms.uFogTex.value.dispose();
    this.gl.dispose();
  }

  // ------------------------------------------------------------------ câmera

  private placeCamera(cam: Camera): void {
    const pitch = (pitchFor(cam.zoom) * Math.PI) / 180;
    const dist = this.vh / 2 / (cam.zoom * Math.tan(((FOV / 2) * Math.PI) / 180));
    this.camera.aspect = this.vw / Math.max(1, this.vh);
    this.camera.near = Math.max(2, dist * 0.05);
    this.camera.far = dist * 6;
    this.camera.position.set(cam.x, dist * Math.sin(pitch), cam.y + dist * Math.cos(pitch));
    this.camera.lookAt(cam.x, 0, cam.y);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    const fog = this.scene.fog as THREE.Fog;
    fog.near = dist * 1.7;
    fog.far = dist * 5;
  }

  panScale(cam: Camera): { x: number; y: number } {
    const pitch = (pitchFor(cam.zoom) * Math.PI) / 180;
    return { x: 1 / cam.zoom, y: 1 / (cam.zoom * Math.sin(pitch)) };
  }

  /** Raio da câmera pelo ponto de tela até o relevo. */
  pick(cam: Camera, sx: number, sy: number): { x: number; y: number } {
    this.placeCamera(cam);
    this.ray.setFromCamera(new THREE.Vector2((sx / this.vw) * 2 - 1, -(sy / this.vh) * 2 + 1), this.camera);
    const { origin: o, direction: d } = this.ray.ray;
    if (d.y > -1e-4) return { x: cam.x, y: cam.y };
    let t = (0 - o.y) / d.y;
    if (this.field) {
      for (let k = 0; k < 6; k++) {
        const h = Math.max(this.field.height(o.x + d.x * t, o.z + d.z * t), WATER_LEVEL);
        t = (h - o.y) / d.y;
      }
    }
    return { x: o.x + d.x * t, y: o.z + d.z * t };
  }

  private groundY(x: number, y: number): number {
    return this.field ? Math.max(this.field.height(x, y), WATER_LEVEL) : 0;
  }

  /** Projeta um ponto do chão; devolve posição de tela e escala (pixels por unidade). */
  private project(x: number, y: number, lift = 0): { sx: number; sy: number; k: number; ok: boolean } {
    const gy = this.groundY(x, y) + lift;
    const v = this.v3.set(x, gy, y);
    const depth = v.clone().sub(this.camera.position).dot(this.camera.getWorldDirection(new THREE.Vector3()));
    v.project(this.camera);
    const sx = ((v.x + 1) / 2) * this.vw;
    const sy = ((1 - v.y) / 2) * this.vh;
    const k = this.vh / 2 / (Math.tan(((FOV / 2) * Math.PI) / 180) * Math.max(1, depth));
    const m = 120;
    const ok = depth > 0 && sx > -m && sy > -m && sx < this.vw + m && sy < this.vh + m * 2;
    return { sx, sy, k, ok };
  }

  tileToScreen(state: GameState, cam: Camera, idx: number): { x: number; y: number } {
    this.placeCamera(cam);
    const c = nearCenter(state, idx, { x: cam.x, y: cam.y });
    const p = this.project(c.x, c.y);
    return { x: p.sx, y: p.sy };
  }

  // ------------------------------------------------------------------ mundo

  private rebuild(state: GameState): void {
    const sig = TerrainField.signature(state);
    const cities = citySignature(state);
    let changed = false;
    if (sig !== this.terrainSig || !this.field) {
      this.terrainSig = sig;
      this.field = new TerrainField(state);
      for (const k of ['terrain', 'water', 'trees'] as const) this.disposeGroup(this.parts[k]);
      if (this.parts.rivers) this.parts.rivers.geometry.dispose();
      this.parts.terrain = buildTerrain(this.field, this.mats.terrain);
      this.parts.water = buildWater(this.field, this.mats.water);
      this.parts.rivers = buildRivers(this.field, state, this.mats.river);
      this.parts.trees = buildTrees(this.field, state, this.mats.trees);
      this.citySig = '';
      changed = true;
    }
    if (cities !== this.citySig) {
      this.citySig = cities;
      this.disposeGroup(this.parts.cities);
      this.parts.cities = buildCities(this.field!, state, this.mats.city);
      // árvores somem do centro de cidades novas
      this.disposeGroup(this.parts.trees);
      this.parts.trees = buildTrees(this.field!, state, this.mats.trees);
      changed = true;
    }
    if (!changed) return;
    this.world.clear();
    const base = new THREE.Group();
    for (const p of [this.parts.terrain, this.parts.water, this.parts.rivers, this.parts.trees, this.parts.cities]) if (p) base.add(p);
    this.world.add(base);
    // mapa com volta: cópias vizinhas a leste e oeste
    this.copies = [];
    if (state.map.wrap) {
      const P = worldPeriod(state);
      for (const off of [-P, P]) {
        const g = base.clone();
        g.position.x = off;
        this.copies.push(g);
        this.world.add(g);
      }
    }
    // a água transparente desenha depois do terreno
    this.world.traverse((o) => {
      if ((o as THREE.Mesh).material === this.mats.water) o.renderOrder = 2;
    });
  }

  private disposeGroup(g?: THREE.Object3D | null): void {
    g?.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }

  private updateFog(state: GameState, vis: Uint8Array, revealAll: boolean): void {
    const key = [state, vis, revealAll];
    if (key.every((k, i) => k === this.fogKey[i])) return;
    this.fogKey = key;
    const W = state.map.width;
    const H = state.map.height;
    const explored = state.players[state.currentPlayer].explored;
    let tex = this.uniforms.uFogTex.value;
    if (tex.image.width !== W || tex.image.height !== H) {
      tex.dispose();
      tex = new THREE.DataTexture(new Uint8Array(W * H), W, H, THREE.RedFormat, THREE.UnsignedByteType);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      this.uniforms.uFogTex.value = tex;
    }
    const data = tex.image.data as Uint8Array;
    for (let i = 0; i < W * H; i++) data[i] = revealAll || vis[i] ? 255 : explored[i] ? 128 : 0;
    tex.needsUpdate = true;
    this.uniforms.uFogMap.value.set(W, H, HEX_SIZE, state.map.wrap ? 1 : 0);
  }

  /** Região do chão vista pela câmera (para a textura do chão e a lista de hexágonos). */
  private footprint(): { x0: number; y0: number; x1: number; y1: number } {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [nx, ny] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      this.ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
      const { origin: o, direction: d } = this.ray.ray;
      const t = d.y < -0.02 ? -o.y / d.y : 6000;
      const x = o.x + d.x * Math.min(t, 6000);
      const y = o.z + d.z * Math.min(t, 6000);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    return { x0, y0, x1, y1 };
  }

  private overlayKey(state: GameState, overlay: Overlay, vis: Uint8Array): string {
    const ids = (s?: Iterable<number>) => (s ? [...s].join(',') : '');
    const cv = overlay.cityView;
    return [
      this.objId(state),
      this.objId(vis),
      overlay.revealAll ? 1 : 0,
      overlay.selectedTile ?? '',
      overlay.selectedUnitId ?? '',
      ids(overlay.path),
      overlay.pathTurns ?? '',
      ids(overlay.reachable),
      ids(overlay.attackTargets),
      overlay.pendingAttack ?? '',
      overlay.placement ? `${ids(overlay.placement.sites.keys())}/${[...overlay.placement.sites.values()].join(',')}/${overlay.placement.chosen ?? ''}` : '',
      cv ? `${cv.cityId}/${ids(cv.worked)}/${ids(cv.locked)}/${ids(cv.buyable.keys())}` : '',
    ].join('|');
  }

  private ids = new WeakMap<object, number>();
  private nextObjId = 1;
  private objId(o: object): number {
    let id = this.ids.get(o);
    if (!id) this.ids.set(o, (id = this.nextObjId++));
    return id;
  }

  private updateDecal(state: GameState, vis: Uint8Array, overlay: Overlay): void {
    const f = this.footprint();
    const r = this.decalRegion;
    const fw = f.x1 - f.x0;
    const fh = f.y1 - f.y0;
    const inside = r && f.x0 >= r.x && f.y0 >= r.y && f.x1 <= r.x + r.w && f.y1 <= r.y + r.h && r.w < fw * 2.2;
    let regionChanged = false;
    if (!inside) {
      const mx = fw * 0.3;
      const my = fh * 0.3;
      const w = Math.min(fw + 2 * mx, 6000);
      const h = Math.min(fh + 2 * my, 6000);
      const scale = Math.min(1.6, MAX_DECAL_PX / Math.max(w, h));
      this.decalRegion = { x: (f.x0 + f.x1) / 2 - w / 2, y: (f.y0 + f.y1) / 2 - h / 2, w, h, scale };
      const cw = Math.ceil(w * scale);
      const ch = Math.ceil(h * scale);
      if (this.decalCanvas.width !== cw || this.decalCanvas.height !== ch) {
        this.decalCanvas.width = cw;
        this.decalCanvas.height = ch;
        this.decalTex.dispose();
      }
      regionChanged = true;
    }
    const key = this.overlayKey(state, overlay, vis);
    if (!regionChanged && key === this.decalKey) return;
    this.decalKey = key;
    const reg = this.decalRegion!;
    this.decalPainter.drawDecal(state, vis, overlay, reg);
    this.decalTex.needsUpdate = true;
    this.uniforms.uDecalRect.value.set(reg.x, reg.y, reg.w, reg.h);
  }

  /** Hexágonos (com volta) dentro da região vista, do fundo para a frente. */
  private visibleTiles(state: GameState): number[] {
    const r = this.decalRegion;
    if (!r) return [];
    const rowH = HEX_SIZE * 1.5;
    const colW = HEX_SIZE * SQRT3;
    const W = state.map.width;
    const r0 = Math.max(0, Math.floor(r.y / rowH) - 1);
    const r1 = Math.min(state.map.height - 1, Math.ceil((r.y + r.h) / rowH) + 1);
    let c0 = Math.floor(r.x / colW) - 1;
    let c1 = Math.ceil((r.x + r.w) / colW) + 1;
    if (!state.map.wrap) {
      c0 = Math.max(0, c0);
      c1 = Math.min(W - 1, c1);
    } else if (c1 - c0 >= W) {
      c0 = 0;
      c1 = W - 1;
    }
    const out: number[] = [];
    const seen = new Set<number>();
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const cc = ((col % W) + W) % W;
        const i = row * W + cc;
        if (seen.has(i)) continue;
        seen.add(i);
        out.push(i);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ quadro

  draw(state: GameState, cam: Camera, vis: Uint8Array, overlay: Overlay): void {
    if (state !== this.lastState) {
      this.lastState = state;
      this.rebuild(state);
    }
    this.placeCamera(cam);
    this.updateFog(state, vis, !!overlay.revealAll);
    this.updateDecal(state, vis, overlay);
    this.gl.render(this.scene, this.camera);

    // figuras em pé no canvas de cima
    const P = state.map.wrap ? worldPeriod(state) : 0;
    const dpr = this.sprites.dpr;
    const ctx = this.sprites.ctx;
    const place = (wx: number, wy: number): boolean => {
      let x = wx;
      if (P) {
        while (x - cam.x > P / 2) x -= P;
        while (cam.x - x > P / 2) x += P;
      }
      const p = this.project(x, wy);
      if (!p.ok) return false;
      // ícones e estandartes não crescem demais de perto nem somem de longe
      const k = Math.max(0.5, Math.min(1.25, p.k));
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (p.sx - k * wx), dpr * (p.sy - k * wy));
      return true;
    };
    this.sprites.drawSprites(state, vis, overlay, this.visibleTiles(state), place, cam.zoom);
  }
}
