import type { PartialYields } from './yields';

export type SlotType = 'military' | 'economic' | 'wildcard';

export const SLOT_LABELS: Record<SlotType, string> = {
  military: 'Militar',
  economic: 'Econômica',
  wildcard: 'Coringa',
};

/** Efeitos genéricos usados por governos e políticas (agregados em rules/effects.ts). */
export type Effect =
  | { type: 'cityYields'; yields: PartialYields }
  | { type: 'capitalYields'; yields: PartialYields }
  | { type: 'yieldPercent'; yields: PartialYields }
  | { type: 'productionPercent'; target: 'military' | 'building' | 'settler' | 'builder' | 'all'; percent: number }
  | { type: 'tilePurchaseDiscount'; percent: number }
  | { type: 'builderCharges'; amount: number }
  | { type: 'growthPercent'; percent: number }
  | { type: 'extraMoves'; unit: string; amount: number }
  | { type: 'cityDefense'; amount: number }
  | { type: 'amenities'; amount: number }
  | { type: 'tradeRouteGold'; amount: number };

export interface GovernmentDef {
  id: string;
  name: string;
  civic: string;
  slots: Record<SlotType, number>;
  effects: Effect[];
  description: string;
}

export const GOVERNMENTS: GovernmentDef[] = [
  {
    id: 'chiefdom',
    name: 'Chefia',
    civic: 'code-of-laws',
    slots: { military: 1, economic: 1, wildcard: 0 },
    effects: [],
    description: 'O primeiro governo: 1 militar, 1 econômica.',
  },
  {
    id: 'autocracy',
    name: 'Autocracia',
    civic: 'political-philosophy',
    slots: { military: 2, economic: 1, wildcard: 1 },
    effects: [{ type: 'capitalYields', yields: { food: 1, production: 1, gold: 1, science: 1, culture: 1, faith: 1 } }],
    description: '+1 em todos os rendimentos da capital.',
  },
  {
    id: 'oligarchy',
    name: 'Oligarquia',
    civic: 'political-philosophy',
    slots: { military: 1, economic: 1, wildcard: 2 },
    effects: [{ type: 'productionPercent', target: 'military', percent: 20 }],
    description: '+20% de produção para unidades militares.',
  },
  {
    id: 'classical-republic',
    name: 'República Clássica',
    civic: 'political-philosophy',
    slots: { military: 0, economic: 2, wildcard: 2 },
    effects: [{ type: 'yieldPercent', yields: { gold: 10, culture: 10 } }],
    description: '+10% de ouro e cultura.',
  },
];

export interface PolicyDef {
  id: string;
  name: string;
  slot: Exclude<SlotType, 'wildcard'>;
  civic: string;
  effects: Effect[];
  description: string;
}

export const POLICIES: PolicyDef[] = [
  {
    id: 'recruitment',
    name: 'Recrutamento',
    slot: 'military',
    civic: 'code-of-laws',
    effects: [{ type: 'productionPercent', target: 'military', percent: 50 }],
    description: '+50% de produção para unidades militares.',
  },
  {
    id: 'urban-planning',
    name: 'Planejamento Urbano',
    slot: 'economic',
    civic: 'code-of-laws',
    effects: [{ type: 'cityYields', yields: { production: 1 } }],
    description: '+1 de produção em todas as cidades.',
  },
  {
    id: 'god-king',
    name: 'Rei-Deus',
    slot: 'economic',
    civic: 'code-of-laws',
    effects: [{ type: 'capitalYields', yields: { gold: 1, faith: 1 } }],
    description: '+1 de ouro e +1 de fé na capital.',
  },
  {
    id: 'collective-labor',
    name: 'Mutirão',
    slot: 'economic',
    civic: 'craftsmanship',
    effects: [
      { type: 'productionPercent', target: 'builder', percent: 30 },
      { type: 'builderCharges', amount: 1 },
    ],
    description: '+30% de produção de construtores, que ganham +1 carga.',
  },
  {
    id: 'caravans',
    name: 'Caravançarás',
    slot: 'economic',
    civic: 'foreign-trade',
    effects: [{ type: 'tradeRouteGold', amount: 2 }],
    description: '+2 de ouro por rota comercial.',
  },
  {
    id: 'revelation',
    name: 'Revelação',
    slot: 'economic',
    civic: 'mysticism',
    effects: [{ type: 'cityYields', yields: { faith: 1 } }],
    description: '+1 de fé em todas as cidades.',
  },
  {
    id: 'pathfinders',
    name: 'Desbravadores',
    slot: 'military',
    civic: 'military-tradition',
    effects: [{ type: 'extraMoves', unit: 'scout', amount: 1 }],
    description: '+1 de movimento para Batedores.',
  },
  {
    id: 'corvee',
    name: 'Corveia',
    slot: 'economic',
    civic: 'state-workforce',
    effects: [{ type: 'productionPercent', target: 'building', percent: 25 }],
    description: '+25% de produção para edifícios.',
  },
  {
    id: 'colonization',
    name: 'Colonização',
    slot: 'economic',
    civic: 'early-empire',
    effects: [{ type: 'productionPercent', target: 'settler', percent: 50 }],
    description: '+50% de produção de colonos.',
  },
  {
    id: 'land-surveyors',
    name: 'Agrimensores',
    slot: 'economic',
    civic: 'early-empire',
    effects: [{ type: 'tilePurchaseDiscount', percent: 50 }],
    description: 'Hexágonos custam 50% menos ouro.',
  },
  {
    id: 'bread-circuses',
    name: 'Pão e Circo',
    slot: 'economic',
    civic: 'games-recreation',
    effects: [{ type: 'growthPercent', percent: 20 }],
    description: '+20% de crescimento populacional.',
  },
  {
    id: 'patronage',
    name: 'Mecenato',
    slot: 'economic',
    civic: 'drama-poetry',
    effects: [{ type: 'yieldPercent', yields: { culture: 15 } }],
    description: '+15% de cultura.',
  },
  {
    id: 'academy',
    name: 'Academia',
    slot: 'economic',
    civic: 'political-philosophy',
    effects: [{ type: 'yieldPercent', yields: { science: 15 } }],
    description: '+15% de ciência.',
  },
];

export const GOVERNMENT_BY_ID: Record<string, GovernmentDef> = Object.fromEntries(GOVERNMENTS.map((g) => [g.id, g]));
export const POLICY_BY_ID: Record<string, PolicyDef> = Object.fromEntries(POLICIES.map((p) => [p.id, p]));
