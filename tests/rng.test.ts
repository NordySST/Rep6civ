import { describe, expect, it } from 'vitest';
import { createRng, hashSeed } from '../src/rules/rng';

describe('rng', () => {
  it('é determinístico para a mesma semente', () => {
    const a = createRng('abc');
    const b = createRng('abc');
    for (let i = 0; i < 50; i++) expect(a.next()).toBe(b.next());
  });
  it('sementes diferentes geram sequências diferentes', () => {
    expect(createRng('abc').next()).not.toBe(createRng('abd').next());
    expect(hashSeed('x')).not.toBe(hashSeed('y'));
  });
  it('fica em [0,1)', () => {
    const r = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
