/** Câmera 2D: (x, y) é o ponto do mundo no centro da tela. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2.5;

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function worldToScreen(cam: Camera, vw: number, vh: number, wx: number, wy: number) {
  return { x: (wx - cam.x) * cam.zoom + vw / 2, y: (wy - cam.y) * cam.zoom + vh / 2 };
}

export function screenToWorld(cam: Camera, vw: number, vh: number, sx: number, sy: number) {
  return { x: (sx - vw / 2) / cam.zoom + cam.x, y: (sy - vh / 2) / cam.zoom + cam.y };
}

/** Aplica zoom mantendo fixo o ponto de tela (sx, sy). */
export function zoomAt(cam: Camera, vw: number, vh: number, sx: number, sy: number, newZoom: number): Camera {
  const z = clampZoom(newZoom);
  const before = screenToWorld(cam, vw, vh, sx, sy);
  const next = { ...cam, zoom: z };
  const after = screenToWorld(next, vw, vh, sx, sy);
  next.x += before.x - after.x;
  next.y += before.y - after.y;
  return next;
}

export function clampCamera(cam: Camera, worldW: number, worldH: number): Camera {
  return {
    zoom: cam.zoom,
    x: Math.min(worldW, Math.max(0, cam.x)),
    y: Math.min(worldH, Math.max(0, cam.y)),
  };
}
