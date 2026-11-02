import { describe, expect, it } from 'vitest';
import { alongPolyline, Fx, moveDuration } from '../src/ui/fx';

describe('efeitos visuais (fx)', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 0 },
  ];

  it('percorre a rota passando por cada hexágono', () => {
    expect(alongPolyline(pts, 0)).toEqual(pts[0]);
    expect(alongPolyline(pts, 0.5)).toEqual({ x: 10, y: 0 });
    expect(alongPolyline(pts, 1)).toEqual(pts[2]);
    // no meio de um passo a unidade dá um pequeno salto (y negativo)
    expect(alongPolyline(pts, 0.25).y).toBeLessThan(0);
  });

  it('rotas longas são mais rápidas por passo, com teto', () => {
    expect(moveDuration(0)).toBe(0);
    expect(moveDuration(1)).toBeLessThan(moveDuration(3));
    expect(moveDuration(20)).toBeLessThanOrEqual(1060);
  });

  it('movimento agendado espera no ponto de partida e termina no destino', () => {
    const fx = new Fx();
    fx.move(7, pts, 100, 200);
    expect(fx.frame(50).unitPositions.get(7)).toEqual(pts[0]);
    expect(fx.frame(300).unitPositions.get(7)).toEqual(pts[2]);
    expect(fx.busyUntil(7, 0)).toBe(300);
    expect(fx.active(299)).toBe(true);
    expect(fx.active(301)).toBe(false);
  });

  it('fantasma fica inteiro até o impacto e depois some', () => {
    const fx = new Fx();
    fx.ghost('warrior', 0, { x: 0, y: 0 }, 0, 300, 600);
    expect(fx.frame(200).ghosts[0].alpha).toBe(1);
    expect(fx.frame(600).ghosts[0].alpha).toBeCloseTo(0.5);
    expect(fx.active(901)).toBe(false);
  });

  it('textos e projéteis só aparecem a partir do início', () => {
    const fx = new Fx();
    fx.floater(0, 0, '−30', '#f00', 100);
    fx.projectile({ x: 0, y: 0 }, { x: 30, y: 0 }, 100, false, 300);
    expect(fx.frame(50).floaters).toHaveLength(0);
    expect(fx.frame(50).projectiles).toHaveLength(0);
    const f = fx.frame(250);
    expect(f.floaters).toHaveLength(1);
    expect(f.projectiles[0].x).toBeCloseTo(15);
    expect(f.projectiles[0].y).toBeLessThan(0); // arco
  });
});
