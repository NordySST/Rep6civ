export type UnitClass = 'civilian' | 'military';

export interface UnitDef {
  id: string;
  name: string;
  class: UnitClass;
  moves: number;
  /** Custo de produção. */
  cost: number;
  /** População consumida ao concluir (colono). */
  popCost?: number;
  /** Cargas de construção (construtor). */
  charges?: number;
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
    cost: 80,
    popCost: 1,
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
    cost: 40,
    sight: 2,
    strength: 20,
    glyph: '⚔',
    description: 'Unidade corpo a corpo da era antiga.',
  },
  builder: {
    id: 'builder',
    name: 'Construtor',
    class: 'civilian',
    moves: 2,
    cost: 50,
    charges: 3,
    sight: 2,
    strength: 0,
    glyph: '⚒',
    description: 'Constrói melhorias e estradas. Tem 3 cargas.',
  },
  scout: {
    id: 'scout',
    name: 'Batedor',
    class: 'military',
    moves: 3,
    cost: 30,
    sight: 2,
    strength: 10,
    glyph: '👁',
    description: 'Explorador rápido.',
  },
};
