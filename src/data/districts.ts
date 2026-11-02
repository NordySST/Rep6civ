import type { Yields } from './yields';

/**
 * Distritos especializados. Cada um ocupa um hexágono do território da cidade
 * (não trabalhável) e rende bônus de adjacência no seu rendimento principal.
 */
export type DistrictId = 'campus' | 'holy-site' | 'theater' | 'commercial' | 'industrial' | 'encampment' | 'harbor';

export type AdjacencySource =
  | 'mountain'
  | 'jungle'
  | 'forest'
  | 'naturalWonder'
  | 'worldWonder'
  | 'district'
  | 'river'
  | 'mine'
  | 'quarry'
  | 'cityCenter'
  | 'seaResource';

export interface AdjacencyRule {
  source: AdjacencySource;
  /** Bônus por fonte adjacente (frações somam e são arredondadas para baixo). */
  amount: number;
}

export interface DistrictDef {
  id: DistrictId;
  name: string;
  icon: string;
  color: string;
  /** Rendimento que recebe a adjacência. */
  yieldKey?: keyof Yields;
  adjacency: AdjacencyRule[];
  /** Posicionamento em água costeira (porto). */
  onWater?: boolean;
  requiresTech?: string;
  requiresCivic?: string;
  description: string;
}

export const DISTRICTS: Record<DistrictId, DistrictDef> = {
  campus: {
    id: 'campus',
    name: 'Campus',
    icon: '🔬',
    color: '#3498db',
    yieldKey: 'science',
    adjacency: [
      { source: 'mountain', amount: 1 },
      { source: 'jungle', amount: 0.5 },
      { source: 'naturalWonder', amount: 2 },
      { source: 'district', amount: 0.5 },
    ],
    requiresTech: 'writing',
    description: 'Ciência: +1 por montanha, +½ por selva, +2 por maravilha natural, +½ por distrito adjacente.',
  },
  'holy-site': {
    id: 'holy-site',
    name: 'Lugar Sagrado',
    icon: '✨',
    color: '#ecf0f1',
    yieldKey: 'faith',
    adjacency: [
      { source: 'mountain', amount: 1 },
      { source: 'forest', amount: 0.5 },
      { source: 'naturalWonder', amount: 2 },
      { source: 'district', amount: 0.5 },
    ],
    requiresTech: 'astrology',
    description: 'Fé: +1 por montanha, +½ por floresta, +2 por maravilha natural, +½ por distrito adjacente.',
  },
  theater: {
    id: 'theater',
    name: 'Praça Teatral',
    icon: '🎭',
    color: '#9b59b6',
    yieldKey: 'culture',
    adjacency: [
      { source: 'worldWonder', amount: 2 },
      { source: 'district', amount: 0.5 },
    ],
    requiresCivic: 'drama-poetry',
    description: 'Cultura: +2 por maravilha mundial, +½ por distrito adjacente.',
  },
  commercial: {
    id: 'commercial',
    name: 'Centro Comercial',
    icon: '🪙',
    color: '#f1c40f',
    yieldKey: 'gold',
    adjacency: [
      { source: 'river', amount: 2 },
      { source: 'district', amount: 0.5 },
    ],
    requiresTech: 'currency',
    description: 'Ouro: +2 se tiver rio, +½ por distrito adjacente.',
  },
  industrial: {
    id: 'industrial',
    name: 'Zona Industrial',
    icon: '⚙',
    color: '#e67e22',
    yieldKey: 'production',
    adjacency: [
      { source: 'mine', amount: 1 },
      { source: 'quarry', amount: 1 },
      { source: 'district', amount: 0.5 },
    ],
    requiresTech: 'engineering',
    description: 'Produção: +1 por mina e pedreira, +½ por distrito adjacente.',
  },
  encampment: {
    id: 'encampment',
    name: 'Acampamento Militar',
    icon: '⛨',
    color: '#c0392b',
    adjacency: [],
    requiresTech: 'bronze-working',
    description: '+25% de produção militar na cidade; unidades treinadas aqui ganham 10 de XP.',
  },
  harbor: {
    id: 'harbor',
    name: 'Porto',
    icon: '⚓',
    color: '#1abc9c',
    yieldKey: 'gold',
    adjacency: [
      { source: 'cityCenter', amount: 2 },
      { source: 'seaResource', amount: 1 },
      { source: 'district', amount: 0.5 },
    ],
    onWater: true,
    requiresTech: 'sailing',
    description: 'Ouro: +2 junto ao centro da cidade, +1 por recurso marinho, +½ por distrito. Construído na costa.',
  },
};

export const DISTRICT_LIST = Object.values(DISTRICTS);

/** Custo base de um distrito (cresce com o nº de tecnologias do dono). */
export const DISTRICT_BASE_COST = 60;
