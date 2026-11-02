import type { PartialYields } from './yields';

/** Cidades-estado — todas inventadas. */
export type CityStateType = 'scientific' | 'cultural' | 'trade' | 'industrial' | 'religious' | 'militaristic';

export interface CityStateTypeDef {
  id: CityStateType;
  name: string;
  /** Rendimento concedido por emissários (1, 3 e 6 emissários). */
  yieldKey: keyof Required<PartialYields>;
  icon: string;
  color: string;
}

export const CITY_STATE_TYPES: Record<CityStateType, CityStateTypeDef> = {
  scientific: { id: 'scientific', name: 'Científica', yieldKey: 'science', icon: '🔬', color: '#3498db' },
  cultural: { id: 'cultural', name: 'Cultural', yieldKey: 'culture', icon: '🎭', color: '#9b59b6' },
  trade: { id: 'trade', name: 'Comercial', yieldKey: 'gold', icon: '🪙', color: '#f1c40f' },
  industrial: { id: 'industrial', name: 'Industrial', yieldKey: 'production', icon: '⚒', color: '#e67e22' },
  religious: { id: 'religious', name: 'Religiosa', yieldKey: 'faith', icon: '✨', color: '#ecf0f1' },
  militaristic: { id: 'militaristic', name: 'Militarista', yieldKey: 'production', icon: '⚔', color: '#e74c3c' },
};

export interface CityStateDef {
  id: string;
  name: string;
  type: CityStateType;
  /** Bônus do suserano (descrição; efeito em rules/diplomacy.ts). */
  suzerainBonus: string;
}

export const CITY_STATES: CityStateDef[] = [
  { id: 'cs-elarion', name: 'Elarion', type: 'scientific', suzerainBonus: '+2 de ciência em todas as cidades.' },
  { id: 'cs-brisa', name: 'Brisalta', type: 'cultural', suzerainBonus: '+2 de cultura em todas as cidades.' },
  { id: 'cs-moedas', name: 'Porto Áureo', type: 'trade', suzerainBonus: '+3 de ouro em todas as cidades.' },
  { id: 'cs-forja', name: 'Ferrovale', type: 'industrial', suzerainBonus: '+2 de produção em todas as cidades.' },
  { id: 'cs-sino', name: 'Sinoclaro', type: 'religious', suzerainBonus: '+2 de fé em todas as cidades.' },
  { id: 'cs-lanca', name: 'Lança Rubra', type: 'militaristic', suzerainBonus: '+25% de produção para unidades militares.' },
  { id: 'cs-astra', name: 'Astrália', type: 'scientific', suzerainBonus: '+2 de ciência em todas as cidades.' },
  { id: 'cs-vimar', name: 'Vimar', type: 'trade', suzerainBonus: '+3 de ouro em todas as cidades.' },
];

export const CITY_STATE_BY_ID: Record<string, CityStateDef> = Object.fromEntries(CITY_STATES.map((c) => [c.id, c]));

/** Emissários necessários para cada nível de bônus. */
export const ENVOY_TIERS = [1, 3, 6];
/** Emissários mínimos para ser suserano (e mais que qualquer outro). */
export const SUZERAIN_MIN = 3;
