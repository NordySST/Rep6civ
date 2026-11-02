import type { PartialYields } from './yields';

export interface BuildingDef {
  id: string;
  name: string;
  cost: number;
  yields: PartialYields;
  housing?: number;
  description: string;
  /** Concedido automaticamente (ex.: palácio na capital); não aparece na produção. */
  auto?: boolean;
  /** Exige que o centro da cidade tenha rio. */
  needsRiver?: boolean;
  /** Exige cidade costeira. */
  needsCoast?: boolean;
  /** Tecnologia/cívica necessária (etapa 3). */
  requiresTech?: string;
  requiresCivic?: string;
  /** Distrito exigido na cidade (etapa 6). */
  district?: string;
  /** Edifício exigido antes (ex.: Universidade exige Biblioteca). */
  requiresBuilding?: string;
  /** Manutenção em ouro por turno (padrão 1; palácio 0). */
  maintenance?: number;
  /** Comodidades fornecidas à cidade. */
  amenities?: number;
}

export const BUILDINGS: Record<string, BuildingDef> = {
  palace: {
    id: 'palace',
    name: 'Palácio',
    cost: 0,
    yields: { production: 2, gold: 3, science: 2, culture: 1 },
    housing: 1,
    description: 'Sede do governo. Concedido à capital.',
    auto: true,
  },
  monument: {
    id: 'monument',
    maintenance: 0,
    name: 'Monumento',
    cost: 60,
    yields: { culture: 2 },
    description: '+2 Cultura: as fronteiras crescem mais rápido.',
  },
  granary: {
    id: 'granary',
    maintenance: 1,
    requiresTech: 'pottery',
    name: 'Celeiro',
    cost: 65,
    yields: { food: 1 },
    housing: 2,
    description: '+1 Comida e +2 de Moradia.',
  },
  watermill: {
    id: 'watermill',
    maintenance: 1,
    requiresTech: 'wheel',
    name: 'Moinho d’Água',
    cost: 80,
    yields: { food: 1, production: 1 },
    description: '+1 Comida e +1 Produção. Exige rio no centro da cidade.',
    needsRiver: true,
  },
  workshop: {
    id: 'workshop',
    maintenance: 1,
    district: 'industrial',
    requiresTech: 'engineering',
    name: 'Oficina',
    cost: 90,
    yields: { production: 2 },
    description: '+2 Produção.',
  },
  shrine: {
    id: 'shrine',
    maintenance: 1,
    district: 'holy-site',
    requiresTech: 'astrology',
    name: 'Santuário',
    cost: 70,
    yields: { faith: 2 },
    description: '+2 Fé.',
  },
  library: {
    id: 'library',
    maintenance: 1,
    district: 'campus',
    requiresTech: 'writing',
    name: 'Biblioteca',
    cost: 90,
    yields: { science: 2 },
    description: '+2 Ciência.',
  },
  market: {
    id: 'market',
    maintenance: 0,
    district: 'commercial',
    requiresTech: 'currency',
    name: 'Mercado',
    cost: 100,
    yields: { gold: 3 },
    description: '+3 Ouro.',
  },
  university: {
    id: 'university',
    maintenance: 2,
    name: 'Universidade',
    cost: 160,
    yields: { science: 4 },
    housing: 1,
    requiresTech: 'mathematics',
    district: 'campus',
    requiresBuilding: 'library',
    description: '+4 de ciência e +1 de moradia. Exige Biblioteca.',
  },
  temple: {
    id: 'temple',
    maintenance: 2,
    name: 'Templo',
    cost: 120,
    yields: { faith: 4 },
    requiresCivic: 'mysticism',
    district: 'holy-site',
    requiresBuilding: 'shrine',
    amenities: 1,
    description: '+4 de fé e +1 de comodidade. Exige Santuário.',
  },
  amphitheater: {
    id: 'amphitheater',
    maintenance: 1,
    name: 'Anfiteatro',
    cost: 130,
    yields: { culture: 3 },
    requiresCivic: 'drama-poetry',
    district: 'theater',
    amenities: 1,
    description: '+3 de cultura e +1 de comodidade.',
  },
  barracks: {
    id: 'barracks',
    maintenance: 1,
    name: 'Quartel',
    cost: 90,
    yields: { production: 1 },
    housing: 1,
    requiresTech: 'bronze-working',
    district: 'encampment',
    description: '+1 de produção e +1 de moradia; unidades treinadas ganham +15 de XP.',
  },
  observatory: {
    id: 'observatory',
    name: 'Observatório',
    cost: 200,
    yields: { science: 3 },
    maintenance: 2,
    requiresTech: 'printing',
    district: 'campus',
    requiresBuilding: 'university',
    description: '+3 de ciência. Exige Universidade.',
  },
  'research-lab': {
    id: 'research-lab',
    name: 'Laboratório de Pesquisa',
    cost: 360,
    yields: { science: 5 },
    maintenance: 3,
    requiresTech: 'electricity',
    district: 'campus',
    requiresBuilding: 'observatory',
    description: '+5 de ciência. Exige Observatório.',
  },
  bank: {
    id: 'bank',
    name: 'Banco',
    cost: 220,
    yields: { gold: 5 },
    maintenance: 0,
    requiresTech: 'banking',
    district: 'commercial',
    requiresBuilding: 'market',
    description: '+5 de ouro. Exige Mercado.',
  },
  'stock-exchange': {
    id: 'stock-exchange',
    name: 'Bolsa de Valores',
    cost: 340,
    yields: { gold: 7 },
    maintenance: 0,
    requiresTech: 'economics',
    district: 'commercial',
    requiresBuilding: 'bank',
    description: '+7 de ouro. Exige Banco.',
  },
  factory: {
    id: 'factory',
    name: 'Fábrica',
    cost: 300,
    yields: { production: 4 },
    maintenance: 2,
    requiresTech: 'industrialization',
    district: 'industrial',
    requiresBuilding: 'workshop',
    description: '+4 de produção. Exige Oficina.',
  },
  'power-plant': {
    id: 'power-plant',
    name: 'Usina',
    cost: 380,
    yields: { production: 5 },
    maintenance: 3,
    requiresTech: 'electricity',
    district: 'industrial',
    requiresBuilding: 'factory',
    description: '+5 de produção. Exige Fábrica.',
  },
  walls: {
    id: 'walls',
    maintenance: 0,
    name: 'Muralhas',
    cost: 80,
    yields: {},
    requiresTech: 'masonry',
    description: '+8 de defesa e +100 de vida da cidade; a cidade pode atacar à distância.',
  },
  lighthouse: {
    id: 'lighthouse',
    maintenance: 0,
    district: 'harbor',
    requiresTech: 'sailing',
    name: 'Farol',
    cost: 80,
    yields: { food: 1, gold: 1 },
    housing: 1,
    description: '+1 Comida, +1 Ouro e +1 Moradia. Exige cidade costeira.',
    needsCoast: true,
  },
};
