export type UnitClass = 'civilian' | 'military';
/** Tipo de combate (define promoções e bônus). */
export type CombatType = 'melee' | 'ranged' | 'cavalry' | 'siege' | 'recon';

export interface UnitDef {
  id: string;
  name: string;
  class: UnitClass;
  combat?: CombatType;
  moves: number;
  /** Custo de produção. */
  cost: number;
  /** População consumida ao concluir (colono). */
  popCost?: number;
  /** Cargas de construção (construtor). */
  charges?: number;
  sight: number;
  /** Força de combate corpo a corpo (defesa de todas as unidades militares). */
  strength: number;
  /** Força à distância (unidades à distância e de cerco). */
  rangedStrength?: number;
  range?: number;
  /** Bônus de força contra tipos de alvo. */
  bonusVs?: Partial<Record<CombatType | 'city', number>>;
  requiresTech?: string;
  /** Recurso estratégico que o jogador precisa ter no território. */
  requiresResource?: string;
  /** Glifo desenhado no marcador da unidade. */
  glyph: string;
  canFoundCity?: boolean;
  /** Só aparece para bárbaros (não pode ser produzida). */
  barbarianOnly?: boolean;
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
    combat: 'recon',
    moves: 3,
    cost: 30,
    sight: 2,
    strength: 10,
    glyph: '👁',
    description: 'Explorador rápido e frágil.',
  },
  warrior: {
    id: 'warrior',
    name: 'Guerreiro',
    class: 'military',
    combat: 'melee',
    moves: 2,
    cost: 40,
    sight: 2,
    strength: 20,
    glyph: '⚔',
    description: 'Unidade corpo a corpo da era antiga.',
  },
  slinger: {
    id: 'slinger',
    name: 'Fundibulário',
    class: 'military',
    combat: 'ranged',
    moves: 2,
    cost: 35,
    sight: 2,
    strength: 5,
    rangedStrength: 15,
    range: 1,
    glyph: '➶',
    description: 'Ataque à distância de alcance 1. Frágil em corpo a corpo.',
  },
  archer: {
    id: 'archer',
    name: 'Arqueiro',
    class: 'military',
    combat: 'ranged',
    moves: 2,
    cost: 60,
    sight: 2,
    strength: 15,
    rangedStrength: 25,
    range: 2,
    requiresTech: 'archery',
    glyph: '🏹',
    description: 'Ataque à distância de alcance 2.',
  },
  spearman: {
    id: 'spearman',
    name: 'Lanceiro',
    class: 'military',
    combat: 'melee',
    moves: 2,
    cost: 65,
    sight: 2,
    strength: 25,
    bonusVs: { cavalry: 10 },
    requiresTech: 'bronze-working',
    glyph: '🜲',
    description: '+10 de força contra cavalaria.',
  },
  swordsman: {
    id: 'swordsman',
    name: 'Espadachim',
    class: 'military',
    combat: 'melee',
    moves: 2,
    cost: 90,
    sight: 2,
    strength: 35,
    requiresTech: 'bronze-working',
    requiresResource: 'iron',
    glyph: '🗡',
    description: 'Infantaria pesada. Exige Ferro no território.',
  },
  horseman: {
    id: 'horseman',
    name: 'Cavaleiro',
    class: 'military',
    combat: 'cavalry',
    moves: 4,
    cost: 80,
    sight: 2,
    strength: 36,
    requiresTech: 'horseback-riding',
    requiresResource: 'horses',
    glyph: '♞',
    description: 'Cavalaria rápida. Exige Cavalos no território.',
  },
  catapult: {
    id: 'catapult',
    name: 'Catapulta',
    class: 'military',
    combat: 'siege',
    moves: 2,
    cost: 120,
    sight: 2,
    strength: 23,
    rangedStrength: 35,
    range: 2,
    bonusVs: { city: 15 },
    requiresTech: 'engineering',
    glyph: '☄',
    description: 'Cerco: +15 de força contra cidades.',
  },
  'barbarian-raider': {
    id: 'barbarian-raider',
    name: 'Saqueador',
    class: 'military',
    combat: 'melee',
    moves: 2,
    cost: 0,
    sight: 2,
    strength: 18,
    barbarianOnly: true,
    glyph: '☠',
    description: 'Guerreiro bárbaro.',
  },
};

/** Ordem de exibição no menu de produção. */
export const UNIT_ORDER = ['settler', 'builder', 'scout', 'warrior', 'slinger', 'archer', 'spearman', 'swordsman', 'horseman', 'catapult'];
