/** Rendimentos de um hexágono (ou bônus). Todos os campos são opcionais nos dados. */
export interface Yields {
  food: number;
  production: number;
  gold: number;
  science: number;
  culture: number;
  faith: number;
}

export type PartialYields = Partial<Yields>;

export const YIELD_KEYS: readonly (keyof Yields)[] = [
  'food',
  'production',
  'gold',
  'science',
  'culture',
  'faith',
] as const;

export const YIELD_LABELS: Record<keyof Yields, { name: string; icon: string }> = {
  food: { name: 'Comida', icon: '🌾' },
  production: { name: 'Produção', icon: '⚒' },
  gold: { name: 'Ouro', icon: '🪙' },
  science: { name: 'Ciência', icon: '🔬' },
  culture: { name: 'Cultura', icon: '🎭' },
  faith: { name: 'Fé', icon: '✨' },
};

export function emptyYields(): Yields {
  return { food: 0, production: 0, gold: 0, science: 0, culture: 0, faith: 0 };
}

export function addYields(target: Yields, add: PartialYields | undefined): Yields {
  if (!add) return target;
  for (const k of YIELD_KEYS) target[k] += add[k] ?? 0;
  return target;
}
