/**
 * Entrada por ponteiro (toque, caneta e mouse):
 *  - 1 dedo: arrastar move a câmera; toque curto = "tap";
 *  - 2 dedos: pinça para zoom + arrastar;
 *  - roda do mouse: zoom no cursor.
 */
export interface InputHandlers {
  onPan(dx: number, dy: number): void;
  onZoom(factor: number, sx: number, sy: number): void;
  onTap(sx: number, sy: number): void;
}

const TAP_SLOP = 10; // px

export function attachInput(el: HTMLElement, h: InputHandlers): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let downPos: { x: number; y: number } | null = null;
  let dragged = false;
  let pinchDist = 0;
  let pinchMid = { x: 0, y: 0 };

  const local = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const pinchInfo = () => {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const down = (e: PointerEvent) => {
    el.setPointerCapture?.(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) {
      downPos = p;
      dragged = false;
    } else if (pointers.size === 2) {
      const pi = pinchInfo();
      pinchDist = pi.dist;
      pinchMid = pi.mid;
      dragged = true; // pinça nunca vira tap
    }
  };

  const move = (e: PointerEvent) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) {
      if (!dragged && downPos && Math.hypot(p.x - downPos.x, p.y - downPos.y) > TAP_SLOP) dragged = true;
      if (dragged) h.onPan(p.x - prev.x, p.y - prev.y);
    } else if (pointers.size === 2) {
      const pi = pinchInfo();
      if (pinchDist > 0) h.onZoom(pi.dist / pinchDist, pi.mid.x, pi.mid.y);
      h.onPan(pi.mid.x - pinchMid.x, pi.mid.y - pinchMid.y);
      pinchDist = pi.dist;
      pinchMid = pi.mid;
    }
  };

  const up = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      if (!dragged && e.type === 'pointerup') h.onTap(p.x, p.y);
      downPos = null;
    } else if (pointers.size === 1) {
      // volta a arrastar com o dedo restante, sem gerar tap
      pinchDist = 0;
    }
  };

  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = el.getBoundingClientRect();
    h.onZoom(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', wheel, { passive: false });
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.removeEventListener('wheel', wheel);
  };
}
