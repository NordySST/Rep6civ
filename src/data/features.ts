import type { TerrainId } from './terrains';
import type { PartialYields } from './yields';

export type FeatureId = 'forest' | 'jungle' | 'marsh';

export interface FeatureDef {
  id: FeatureId;
  name: string;
  yields: PartialYields;
  extraMoveCost: number;
  defense: number;
  /** Bloqueia a linha de visão (salvo se o observador estiver em colinas). */
  blocksSight: boolean;
  allowedTerrains: TerrainId[];
}

export const FEATURES: Record<FeatureId, FeatureDef> = {
  forest: {
    id: 'forest',
    name: 'Floresta',
    yields: { production: 1 },
    extraMoveCost: 1,
    defense: 25,
    blocksSight: true,
    allowedTerrains: ['grassland', 'plains', 'tundra'],
  },
  jungle: {
    id: 'jungle',
    name: 'Selva',
    yields: { food: 1 },
    extraMoveCost: 1,
    defense: 25,
    blocksSight: true,
    allowedTerrains: ['plains'],
  },
  marsh: {
    id: 'marsh',
    name: 'Pântano',
    yields: { food: 1 },
    extraMoveCost: 1,
    defense: -15,
    blocksSight: false,
    allowedTerrains: ['grassland'],
  },
};
