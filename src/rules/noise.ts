import { createRng } from './rng';

/** Ruído de valor 2D suave com fBm, determinístico a partir de uma semente. */
export function createNoise2D(seed: number) {
  const rng = createRng(seed);
  const SIZE = 256;
  const perm = new Uint16Array(SIZE * 2);
  const values = new Float32Array(SIZE);
  const p = Array.from({ length: SIZE }, (_, i) => i);
  rng.shuffle(p);
  for (let i = 0; i < SIZE * 2; i++) perm[i] = p[i & (SIZE - 1)];
  for (let i = 0; i < SIZE; i++) values[i] = rng.next();

  const lattice = (x: number, y: number) => values[perm[(perm[x & 255] + y) & 511] & 255];
  const smooth = (t: number) => t * t * (3 - 2 * t);

  function noise(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const a = lattice(x0, y0);
    const b = lattice(x0 + 1, y0);
    const c = lattice(x0, y0 + 1);
    const d = lattice(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  function fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq + o * 17.3, y * freq + o * 9.1);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  return { noise, fbm };
}
