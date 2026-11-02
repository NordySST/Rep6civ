import type { FeatureId } from './features';
import type { TerrainId } from './terrains';
import type { PartialYields } from './yields';

export type ImprovementId = 'farm' | 'mine' | 'quarry' | 'pasture' | 'plantation' | 'camp';

export interface ImprovementDef {
  id: ImprovementId;
  name: string;
  yields: PartialYields;
  icon: string;
  /** Terrenos válidos quando o hexágono NÃO tem recurso. Vazio = só sobre recursos. */
  terrains: TerrainId[];
  /** Exige colinas (true), plano (false) ou indiferente (undefined) — só sem recurso. */
  hills?: boolean;
  /** Características sobre as quais pode ser construída (padrão: nenhuma). */
  features?: FeatureId[];
  /** Tecnologia necessária (etapa 3). */
  requiresTech?: string;
}

export const IMPROVEMENTS: Record<ImprovementId, ImprovementDef> = {
  farm: {
    id: 'farm',
    name: 'Fazenda',
    yields: { food: 1 },
    icon: '🌱',
    terrains: ['grassland', 'plains', 'desert', 'tundra'],
  },
  mine: {
    id: 'mine',
    name: 'Mina',
    yields: { production: 1 },
    icon: '⛏',
    terrains: ['grassland', 'plains', 'desert', 'tundra', 'snow'],
    hills: true,
    requiresTech: 'mining',
  },
  quarry: { id: 'quarry', name: 'Pedreira', yields: { production: 1 }, icon: '🧱', terrains: [], requiresTech: 'mining' },
  pasture: {
    id: 'pasture',
    name: 'Pastagem',
    yields: { production: 1 },
    icon: '🐾',
    terrains: [],
    requiresTech: 'animal-husbandry',
  },
  plantation: {
    id: 'plantation',
    name: 'Plantação',
    yields: { gold: 2 },
    icon: '🌿',
    terrains: [],
    features: ['jungle', 'forest', 'marsh'],
    requiresTech: 'irrigation',
  },
  camp: {
    id: 'camp',
    name: 'Acampamento',
    yields: { gold: 2 },
    icon: '⛺',
    terrains: [],
    features: ['forest', 'jungle', 'marsh'],
    requiresTech: 'animal-husbandry',
  },
};

/** Remoção de características por construtores: produção obtida pela cidade dona. */
export const FEATURE_REMOVAL: Partial<Record<FeatureId, { name: string; production: number }>> = {
  forest: { name: 'Derrubar floresta', production: 20 },
  jungle: { name: 'Limpar selva', production: 15 },
  marsh: { name: 'Drenar pântano', production: 0 },
};

/** Estradas: entrar num hexágono com estrada vindo de outro com estrada custa isto. */
export const ROAD_MOVE_COST = 0.5;
