import type { Effect } from './governments';
import type { TerrainId } from './terrains';
import type { PartialYields } from './yields';

/** Maravilhas mundiais — todas inventadas. Só uma civilização pode construir cada uma. */
export interface WonderPlacement {
  terrains?: TerrainId[];
  hills?: boolean;
  /** Junto à água (costa). */
  coastal?: boolean;
  /** Com rio no hexágono. */
  river?: boolean;
  /** Adjacente a montanha. */
  nearMountain?: boolean;
  /** Adjacente a um distrito do tipo. */
  nearDistrict?: string;
}

export interface WorldWonderDef {
  id: string;
  name: string;
  cost: number;
  requiresTech?: string;
  requiresCivic?: string;
  placement: WonderPlacement;
  /** Rendimentos na cidade da maravilha. */
  cityYields: PartialYields;
  /** Efeitos para o dono (todas as cidades). */
  effects: Effect[];
  description: string;
}

export const WORLD_WONDERS: WorldWonderDef[] = [
  {
    id: 'ilmara-gardens',
    name: 'Jardins Suspensos de Ilmara',
    cost: 180,
    requiresTech: 'irrigation',
    placement: { river: true },
    cityYields: { food: 2 },
    effects: [{ type: 'growthPercent', percent: 15 }],
    description: '+15% de crescimento em todas as cidades. Exige rio.',
  },
  {
    id: 'sahrun-pyramids',
    name: 'Pirâmides de Sahrun',
    cost: 200,
    requiresTech: 'masonry',
    placement: { terrains: ['desert'], hills: false },
    cityYields: { culture: 2 },
    effects: [{ type: 'builderCharges', amount: 1 }],
    description: 'Construtores ganham +1 carga. Deserto plano.',
  },
  {
    id: 'aurora-observatory',
    name: 'Observatório de Aurora',
    cost: 180,
    requiresTech: 'astrology',
    placement: { nearMountain: true },
    cityYields: { science: 3, faith: 1 },
    effects: [{ type: 'yieldPercent', yields: { science: 10 } }],
    description: '+3 de ciência na cidade e +10% de ciência. Junto a uma montanha.',
  },
  {
    id: 'kessar-lighthouse',
    name: 'Grande Farol de Kessar',
    cost: 190,
    requiresTech: 'sailing',
    placement: { coastal: true },
    cityYields: { gold: 3, food: 1 },
    effects: [{ type: 'cityYields', yields: { gold: 1 } }],
    description: '+1 de ouro em todas as cidades. Na costa.',
  },
  {
    id: 'vael-colossus',
    name: 'Colosso de Bronze de Vael',
    cost: 200,
    requiresTech: 'bronze-working',
    placement: { coastal: true },
    cityYields: { gold: 4 },
    effects: [{ type: 'yieldPercent', yields: { gold: 10 } }],
    description: '+4 de ouro na cidade e +10% de ouro. Na costa.',
  },
  {
    id: 'tharos-library',
    name: 'Grande Biblioteca de Tharos',
    cost: 260,
    requiresTech: 'mathematics',
    placement: { nearDistrict: 'campus' },
    cityYields: { science: 4 },
    effects: [{ type: 'cityYields', yields: { science: 1 } }],
    description: '+1 de ciência em todas as cidades. Junto a um Campus.',
  },
  {
    id: 'winds-temple',
    name: 'Templo dos Ventos',
    cost: 180,
    requiresCivic: 'mysticism',
    placement: { hills: true },
    cityYields: { faith: 4, culture: 1 },
    effects: [{ type: 'cityYields', yields: { faith: 1 } }],
    description: '+1 de fé em todas as cidades. Em colinas.',
  },
  {
    id: 'eternal-wall',
    name: 'Muralha Eterna',
    cost: 240,
    requiresTech: 'construction',
    placement: { hills: true },
    cityYields: { production: 2, culture: 1 },
    effects: [{ type: 'cityDefense', amount: 5 }],
    description: '+5 de força de defesa em todas as cidades. Em colinas.',
  },
  {
    id: 'champions-arena',
    name: 'Arena dos Campeões',
    cost: 250,
    requiresCivic: 'games-recreation',
    placement: { hills: false },
    cityYields: { culture: 3 },
    effects: [{ type: 'yieldPercent', yields: { culture: 15 } }],
    description: '+15% de cultura. Terreno plano.',
  },
  {
    id: 'ulvar-forge',
    name: 'Grande Forja de Ulvar',
    cost: 280,
    requiresTech: 'engineering',
    placement: { nearDistrict: 'industrial' },
    cityYields: { production: 4 },
    effects: [{ type: 'productionPercent', target: 'building', percent: 15 }],
    description: '+15% de produção de edifícios. Junto a uma Zona Industrial.',
  },
  {
    id: 'horizon-statue',
    name: 'Estátua do Horizonte',
    cost: 220,
    requiresCivic: 'military-tradition',
    placement: { coastal: true },
    cityYields: { production: 2 },
    effects: [{ type: 'productionPercent', target: 'military', percent: 25 }],
    description: '+25% de produção militar. Na costa.',
  },
];

export const WORLD_WONDER_BY_ID: Record<string, WorldWonderDef> = Object.fromEntries(WORLD_WONDERS.map((w) => [w.id, w]));
