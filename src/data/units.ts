export type UnitClass = 'civilian' | 'military';

export interface UnitDef {
  id: string;
  name: string;
  class: UnitClass;
  moves: number;
  sight: number;
  strength: number;
  /** Glifo desenhado no marcador da unidade. */
  glyph: string;
  canFoundCity?: boolean;
  description: string;
}

export const UNITS: Record<string, UnitDef> = {
  settler: {
    id: 'settler',
    name: 'Colono',
    class: 'civilian',
    moves: 2,
    sight: 2,
    strength: 0,
    glyph: '⌂',
    canFoundCity: true,
    description: 'Funda novas cidades. É consumido ao fundar.',
  },
  warrior: {
    id: 'warrior',
    name: 'Guerreiro',
    class: 'military',
    moves: 2,
    sight: 2,
    strength: 20,
    glyph: '⚔',
    description: 'Unidade corpo a corpo da era antiga.',
  },
};
