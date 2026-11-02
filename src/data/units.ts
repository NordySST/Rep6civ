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
  /** Domínio: terrestre (padrão) ou naval. */
  domain?: 'land' | 'sea';
  requiresCivic?: string;
  /** Custo em fé (comprável só com fé, ex.: missionário). */
  faithCost?: number;
  /** Comerciante: cria rotas comerciais. */
  trader?: boolean;
  /** Missionário: nº de difusões. */
  spreads?: number;
  /** Grande personalidade (não produzível). */
  greatPerson?: string;
  /** Exige cidade costeira para produzir. */
  needsCoast?: boolean;
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
  trader: {
    id: 'trader',
    name: 'Comerciante',
    class: 'civilian',
    moves: 2,
    cost: 50,
    sight: 2,
    strength: 0,
    requiresCivic: 'foreign-trade',
    trader: true,
    glyph: '🐪',
    description: 'Estabelece uma rota comercial a partir da cidade onde está.',
  },
  missionary: {
    id: 'missionary',
    name: 'Missionário',
    class: 'civilian',
    moves: 3,
    cost: 0,
    faithCost: 80,
    sight: 2,
    strength: 0,
    spreads: 3,
    glyph: '☦',
    description: 'Difunde a sua religião em cidades (3 usos). Comprado com fé.',
  },
  galley: {
    id: 'galley',
    name: 'Galé',
    class: 'military',
    combat: 'melee',
    domain: 'sea',
    moves: 3,
    cost: 65,
    sight: 2,
    strength: 25,
    requiresTech: 'sailing',
    needsCoast: true,
    glyph: '⛵',
    description: 'Navio corpo a corpo. Só navega na costa até a Navegação Celeste.',
  },
  quadrireme: {
    id: 'quadrireme',
    name: 'Quadrirreme',
    class: 'military',
    combat: 'ranged',
    domain: 'sea',
    moves: 3,
    cost: 80,
    sight: 2,
    strength: 20,
    rangedStrength: 25,
    range: 1,
    requiresTech: 'celestial-navigation',
    needsCoast: true,
    glyph: '🚢',
    description: 'Navio de ataque à distância.',
  },
  musketeer: {
    id: 'musketeer',
    name: 'Mosqueteiro',
    class: 'military',
    combat: 'melee',
    moves: 2,
    cost: 180,
    sight: 2,
    strength: 55,
    requiresTech: 'gunpowder',
    requiresResource: 'niter',
    glyph: '🔫',
    description: 'Infantaria com armas de fogo. Exige Salitre.',
  },
  'line-infantry': {
    id: 'line-infantry',
    name: 'Infantaria de Linha',
    class: 'military',
    combat: 'melee',
    moves: 2,
    cost: 260,
    sight: 2,
    strength: 65,
    requiresTech: 'rifling',
    requiresResource: 'niter',
    glyph: '🎖',
    description: 'Infantaria industrial. Exige Salitre.',
  },
  tank: {
    id: 'tank',
    name: 'Tanque',
    class: 'military',
    combat: 'cavalry',
    moves: 4,
    cost: 420,
    sight: 2,
    strength: 80,
    requiresTech: 'combustion',
    requiresResource: 'oil',
    glyph: '🛡',
    description: 'Blindado moderno. Exige Petróleo.',
  },
  caravel: {
    id: 'caravel',
    name: 'Caravela',
    class: 'military',
    combat: 'melee',
    domain: 'sea',
    moves: 4,
    cost: 160,
    sight: 3,
    strength: 40,
    requiresTech: 'cartography',
    needsCoast: true,
    glyph: '⛵',
    description: 'Navio de exploração oceânica.',
  },
  ironclad: {
    id: 'ironclad',
    name: 'Encouraçado',
    class: 'military',
    combat: 'melee',
    domain: 'sea',
    moves: 5,
    cost: 300,
    sight: 2,
    strength: 60,
    requiresTech: 'steam-power',
    requiresResource: 'coal',
    needsCoast: true,
    glyph: '🚢',
    description: 'Navio a vapor blindado. Exige Carvão.',
  },
  'great-scientist': { id: 'great-scientist', name: 'Grande Cientista', class: 'civilian', moves: 3, cost: 0, sight: 2, strength: 0, greatPerson: 'scientist', glyph: '🧪', description: 'Ative para receber ciência equivalente a 50% da pesquisa atual.' },
  'great-engineer': { id: 'great-engineer', name: 'Grande Engenheiro', class: 'civilian', moves: 3, cost: 0, sight: 2, strength: 0, greatPerson: 'engineer', glyph: '📐', description: 'Ative numa cidade sua para +150 de produção no item atual.' },
  'great-merchant': { id: 'great-merchant', name: 'Grande Mercador', class: 'civilian', moves: 3, cost: 0, sight: 2, strength: 0, greatPerson: 'merchant', glyph: '💰', description: 'Ative para receber 200 de ouro.' },
  'great-prophet': { id: 'great-prophet', name: 'Grande Profeta', class: 'civilian', moves: 3, cost: 0, sight: 2, strength: 0, greatPerson: 'prophet', glyph: '🕯', description: 'Ative numa cidade com Lugar Sagrado para fundar uma religião.' },
  'great-general': { id: 'great-general', name: 'Grande General', class: 'civilian', moves: 3, cost: 0, sight: 2, strength: 0, greatPerson: 'general', glyph: '🎖', description: 'Ative para dar 30 de XP às unidades militares a até 2 hexágonos.' },
  'great-writer': { id: 'great-writer', name: 'Grande Escritor', class: 'civilian', moves: 3, cost: 0, sight: 2, strength: 0, greatPerson: 'writer', glyph: '📜', description: 'Ative para receber cultura equivalente a 50% da cívica atual.' },
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
export const UNIT_ORDER = [
  'settler',
  'builder',
  'trader',
  'missionary',
  'scout',
  'warrior',
  'slinger',
  'archer',
  'spearman',
  'swordsman',
  'horseman',
  'catapult',
  'galley',
  'quadrireme',
  'musketeer',
  'line-infantry',
  'tank',
  'caravel',
  'ironclad',
];
