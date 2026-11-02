/**
 * Efeitos visuais temporários (só apresentação; nunca tocam no estado do jogo).
 * Tudo é baseado no relógio (`performance.now()`): cada efeito tem início e duração,
 * e `frame(now)` devolve o que o renderizador deve desenhar naquele instante.
 */

export interface Pt {
  x: number;
  y: number;
}

interface Timed {
  start: number;
  dur: number;
}

type UnitAnim = Timed &
  (
    | { kind: 'move'; unitId: number; pts: Pt[] }
    | { kind: 'lunge'; unitId: number; from: Pt; to: Pt }
    | { kind: 'shake'; unitId: number; at: Pt }
  );

interface Projectile extends Timed {
  from: Pt;
  to: Pt;
  /** Pedra (cidade/catapulta) ou flecha. */
  heavy: boolean;
}

interface Floater extends Timed {
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
}

interface Ghost extends Timed {
  /** Até este instante a unidade aparece inteira; depois some. */
  fadeAt: number;
  type: string;
  owner: number;
  x: number;
  y: number;
}

interface Burst extends Timed {
  x: number;
  y: number;
  color: string;
  kind: 'ring' | 'impact';
}

export interface FxFrame {
  unitPositions: Map<number, Pt>;
  projectiles: { x: number; y: number; angle: number; heavy: boolean; tail: Pt }[];
  floaters: { x: number; y: number; text: string; color: string; alpha: number; size: number }[];
  ghosts: { type: string; owner: number; x: number; y: number; alpha: number }[];
  bursts: { x: number; y: number; color: string; kind: 'ring' | 'impact'; t: number }[];
}

const easeOut = (t: number) => t * (2 - t);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));

/** Duração de um deslocamento de `steps` hexágonos (rápido em rotas longas). */
export function moveDuration(steps: number): number {
  if (steps <= 0) return 0;
  return Math.round(Math.min(160, 1000 / steps) * steps) + 60;
}

/** Ponto ao longo de uma poligonal com `t` em [0,1] (cada segmento com o mesmo tempo, com um pequeno salto). */
export function alongPolyline(pts: Pt[], t: number): Pt {
  if (pts.length === 1 || t <= 0) return pts[0];
  if (t >= 1) return pts[pts.length - 1];
  const segs = pts.length - 1;
  const f = t * segs;
  const k = Math.min(segs - 1, Math.floor(f));
  const local = easeInOut(f - k);
  const a = pts[k];
  const b = pts[k + 1];
  return { x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local - Math.sin(Math.PI * local) * 3 };
}

export class Fx {
  private units: UnitAnim[] = [];
  private projectiles: Projectile[] = [];
  private floaters: Floater[] = [];
  private ghosts: Ghost[] = [];
  private bursts: Burst[] = [];

  clear(): void {
    this.units = [];
    this.projectiles = [];
    this.floaters = [];
    this.ghosts = [];
    this.bursts = [];
  }

  move(unitId: number, pts: Pt[], start: number, dur = moveDuration(pts.length - 1)): void {
    if (pts.length < 2) return;
    this.units.push({ kind: 'move', unitId, pts, start, dur });
  }

  lunge(unitId: number, from: Pt, to: Pt, start: number, dur = 340): void {
    this.units.push({ kind: 'lunge', unitId, from, to, start, dur });
  }

  shake(unitId: number, at: Pt, start: number, dur = 280): void {
    this.units.push({ kind: 'shake', unitId, at, start, dur });
  }

  projectile(from: Pt, to: Pt, start: number, heavy: boolean, dur = 300): void {
    this.projectiles.push({ from, to, start, dur, heavy });
  }

  floater(x: number, y: number, text: string, color: string, start: number, size = 14, dur = 1200): void {
    this.floaters.push({ x, y, text, color, start, dur, size });
  }

  /** Unidade já removida do estado que continua visível até `fadeAt` e então some. */
  ghost(type: string, owner: number, at: Pt, start: number, fadeAt: number, fade = 650): void {
    this.ghosts.push({ type, owner, x: at.x, y: at.y, start, fadeAt, dur: fadeAt - start + fade });
  }

  burst(at: Pt, color: string, kind: 'ring' | 'impact', start: number, dur = kind === 'ring' ? 900 : 420): void {
    this.bursts.push({ x: at.x, y: at.y, color, kind, start, dur });
  }

  /** Remove efeitos terminados; true se ainda há algo animando (ou agendado). */
  active(now: number): boolean {
    const alive = <T extends Timed>(xs: T[]) => xs.filter((x) => now - x.start < x.dur);
    this.units = alive(this.units);
    this.projectiles = alive(this.projectiles);
    this.floaters = alive(this.floaters);
    this.ghosts = alive(this.ghosts);
    this.bursts = alive(this.bursts);
    return !!(this.units.length || this.projectiles.length || this.floaters.length || this.ghosts.length || this.bursts.length);
  }

  /** Momento em que termina o último efeito de unidade de `unitId` (para encadear ataques após o movimento). */
  busyUntil(unitId: number, now: number): number {
    let t = now;
    for (const a of this.units) if (a.unitId === unitId) t = Math.max(t, a.start + a.dur);
    return t;
  }

  frame(now: number): FxFrame {
    const unitPositions = new Map<number, Pt>();
    for (const a of this.units) {
      if (now < a.start) {
        // movimento agendado: a unidade espera no ponto de partida
        if (a.kind === 'move' && !unitPositions.has(a.unitId)) unitPositions.set(a.unitId, a.pts[0]);
        continue;
      }
      const t = Math.min(1, (now - a.start) / a.dur);
      if (a.kind === 'move') unitPositions.set(a.unitId, alongPolyline(a.pts, t));
      else if (a.kind === 'lunge') {
        // recua um pouco, investe e volta
        const e = t < 0.25 ? -0.12 * Math.sin((t / 0.25) * Math.PI * 0.5) : 0.5 * Math.sin(((t - 0.25) / 0.75) * Math.PI);
        unitPositions.set(a.unitId, { x: a.from.x + (a.to.x - a.from.x) * e, y: a.from.y + (a.to.y - a.from.y) * e });
      } else {
        const amp = 3.5 * (1 - t);
        unitPositions.set(a.unitId, { x: a.at.x + Math.sin(t * Math.PI * 8) * amp, y: a.at.y });
      }
    }
    const projectiles = this.projectiles
      .filter((p) => now >= p.start)
      .map((p) => {
        const arc = p.heavy ? 34 : 16;
        const pos = (t: number) => ({
          x: p.from.x + (p.to.x - p.from.x) * t,
          y: p.from.y + (p.to.y - p.from.y) * t - Math.sin(Math.PI * t) * arc,
        });
        const t = Math.min(1, (now - p.start) / p.dur);
        const cur = pos(t);
        const tail = pos(Math.max(0, t - 0.12));
        return { ...cur, angle: Math.atan2(cur.y - tail.y, cur.x - tail.x), heavy: p.heavy, tail };
      });
    const floaters = this.floaters
      .filter((f) => now >= f.start)
      .map((f) => {
        const t = (now - f.start) / f.dur;
        // salta, sobe devagar e some
        const pop = t < 0.15 ? 0.6 + (t / 0.15) * 0.5 : t < 0.25 ? 1.1 - ((t - 0.15) / 0.1) * 0.1 : 1;
        return { x: f.x, y: f.y - 28 * easeOut(t), text: f.text, color: f.color, alpha: 1 - t * t * t, size: f.size * pop };
      });
    const ghosts = this.ghosts
      .filter((g) => now >= g.start)
      .map((g) => {
        const t = Math.max(0, (now - g.fadeAt) / (g.start + g.dur - g.fadeAt));
        return { type: g.type, owner: g.owner, x: g.x, y: g.y + 8 * t, alpha: 1 - t };
      });
    const bursts = this.bursts.filter((b) => now >= b.start).map((b) => ({ x: b.x, y: b.y, color: b.color, kind: b.kind, t: (now - b.start) / b.dur }));
    return { unitPositions, projectiles, floaters, ghosts, bursts };
  }
}
