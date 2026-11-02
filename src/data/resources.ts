import type { FeatureId } from './features';
import type { ImprovementId } from './improvements';
import type { TerrainId } from './terrains';
import type { PartialYields } from './yields';

export type ResourceKind = 'bonus' | 'luxury' | 'strategic';

export interface ResourceDef {
  id: string;
  name: string;
  kind: ResourceKind;
  yields: PartialYields;
  icon: string;
  /** Terrenos onde pode surgir (combinado com as condições abaixo). */
  terrains: TerrainId[];
  /** Se definido, exige uma destas características (ou 'none' para nenhuma). */
  features?: (FeatureId | 'none')[];
  /** true = só em colinas; false = só em terreno plano; undefined = tanto faz. */
  hills?: boolean;
  /** Peso relativo de sorteio. */
  weight: number;
  /** Tecnologia que revela o recurso (usado a partir da etapa 3). */
  revealedBy?: string;
  /** Melhoria que aproveita o recurso (única permitida no hexágono). */
  improvement?: ImprovementId;
}

export const RESOURCES: ResourceDef[] = [
  // ---- Bônus ----
  { id: 'wheat', name: 'Trigo', kind: 'bonus', yields: { food: 1 }, icon: '🌾', terrains: ['plains', 'grassland'], features: ['none'], hills: false, weight: 6, improvement: 'farm' },
  { id: 'rice', name: 'Arroz', kind: 'bonus', yields: { food: 1 }, icon: '🍚', terrains: ['grassland'], features: ['none', 'marsh'], hills: false, weight: 3, improvement: 'farm' },
  { id: 'cattle', name: 'Gado', kind: 'bonus', yields: { food: 1 }, icon: '🐄', terrains: ['grassland'], features: ['none'], weight: 5, improvement: 'pasture' },
  { id: 'sheep', name: 'Ovelhas', kind: 'bonus', yields: { food: 1 }, icon: '🐑', terrains: ['grassland', 'plains', 'desert', 'tundra'], features: ['none'], hills: true, weight: 5, improvement: 'pasture' },
  { id: 'deer', name: 'Cervos', kind: 'bonus', yields: { production: 1 }, icon: '🦌', terrains: ['tundra', 'grassland', 'plains'], features: ['forest'], weight: 5, improvement: 'camp' },
  { id: 'bananas', name: 'Bananas', kind: 'bonus', yields: { food: 1 }, icon: '🍌', terrains: ['grassland', 'plains'], features: ['jungle'], weight: 4, improvement: 'plantation' },
  { id: 'stone', name: 'Pedra', kind: 'bonus', yields: { production: 1 }, icon: '🪨', terrains: ['grassland', 'plains', 'desert'], features: ['none'], weight: 4, improvement: 'quarry' },
  { id: 'copper', name: 'Cobre', kind: 'bonus', yields: { gold: 2 }, icon: '🟠', terrains: ['grassland', 'plains', 'desert', 'tundra'], features: ['none'], hills: true, weight: 3, improvement: 'mine' },
  { id: 'fish', name: 'Peixes', kind: 'bonus', yields: { food: 1 }, icon: '🐟', terrains: ['coast', 'ocean'], weight: 6 },
  { id: 'crabs', name: 'Caranguejos', kind: 'bonus', yields: { gold: 2 }, icon: '🦀', terrains: ['coast'], weight: 3 },
  // ---- Luxo ----
  { id: 'spices', name: 'Especiarias', kind: 'luxury', yields: { food: 2 }, icon: '🌶', terrains: ['grassland', 'plains'], features: ['jungle'], weight: 2, improvement: 'plantation' },
  { id: 'wine', name: 'Vinho', kind: 'luxury', yields: { food: 1, gold: 1 }, icon: '🍇', terrains: ['grassland', 'plains'], features: ['none'], weight: 2, improvement: 'plantation' },
  { id: 'incense', name: 'Incenso', kind: 'luxury', yields: { faith: 1, gold: 1 }, icon: '🕯', terrains: ['desert', 'plains'], features: ['none'], weight: 2, improvement: 'plantation' },
  { id: 'silk', name: 'Seda', kind: 'luxury', yields: { culture: 1 }, icon: '🧵', terrains: ['grassland', 'plains'], features: ['forest'], weight: 2, improvement: 'plantation' },
  { id: 'cotton', name: 'Algodão', kind: 'luxury', yields: { gold: 3 }, icon: '☁', terrains: ['grassland', 'plains'], features: ['none'], hills: false, weight: 2, improvement: 'plantation' },
  { id: 'salt', name: 'Sal', kind: 'luxury', yields: { food: 1, gold: 1 }, icon: '🧂', terrains: ['plains', 'desert', 'tundra'], features: ['none'], hills: false, weight: 2, improvement: 'mine' },
  { id: 'gems', name: 'Gemas', kind: 'luxury', yields: { gold: 3 }, icon: '💎', terrains: ['grassland', 'plains', 'desert', 'tundra'], hills: true, weight: 2, improvement: 'mine' },
  { id: 'dyes', name: 'Corantes', kind: 'luxury', yields: { faith: 1, culture: 1 }, icon: '🎨', terrains: ['grassland', 'plains'], features: ['jungle', 'forest'], weight: 2, improvement: 'plantation' },
  { id: 'furs', name: 'Peles', kind: 'luxury', yields: { food: 1, gold: 1 }, icon: '🦊', terrains: ['tundra'], features: ['forest'], weight: 2, improvement: 'camp' },
  { id: 'pearls', name: 'Pérolas', kind: 'luxury', yields: { faith: 1 }, icon: '🦪', terrains: ['coast'], weight: 2 },
  { id: 'amber', name: 'Âmbar-luz', kind: 'luxury', yields: { science: 1, gold: 1 }, icon: '🟡', terrains: ['grassland', 'plains', 'tundra'], features: ['marsh', 'forest'], weight: 1, improvement: 'camp' },
  // ---- Estratégicos ----
  { id: 'horses', name: 'Cavalos', kind: 'strategic', yields: { food: 1, production: 1 }, icon: '🐎', terrains: ['grassland', 'plains'], features: ['none'], hills: false, weight: 3, revealedBy: 'animal-husbandry', improvement: 'pasture' },
  { id: 'iron', name: 'Ferro', kind: 'strategic', yields: { science: 1 }, icon: '⛓', terrains: ['grassland', 'plains', 'desert', 'tundra', 'snow'], hills: true, weight: 3, revealedBy: 'bronze-working', improvement: 'mine' },
  { id: 'niter', name: 'Salitre', kind: 'strategic', yields: { food: 1, production: 1 }, icon: '🧪', terrains: ['plains', 'desert', 'tundra', 'grassland'], features: ['none'], hills: false, weight: 2, revealedBy: 'military-engineering', improvement: 'mine' },
  { id: 'coal', name: 'Carvão', kind: 'strategic', yields: { production: 2 }, icon: '⬛', terrains: ['grassland', 'plains'], features: ['forest', 'jungle', 'none'], hills: true, weight: 2, revealedBy: 'industrialization', improvement: 'mine' },
  { id: 'oil', name: 'Petróleo', kind: 'strategic', yields: { production: 3 }, icon: '🛢', terrains: ['desert', 'tundra', 'snow', 'grassland'], features: ['none', 'marsh'], hills: false, weight: 2, revealedBy: 'refining' },
  { id: 'aluminum', name: 'Alumínio', kind: 'strategic', yields: { science: 1 }, icon: '🔩', terrains: ['desert', 'plains'], hills: true, weight: 1, revealedBy: 'radio', improvement: 'mine' },
  { id: 'uranium', name: 'Urânio', kind: 'strategic', yields: { production: 2 }, icon: '☢', terrains: ['grassland', 'plains', 'desert', 'tundra', 'snow'], features: ['none', 'forest', 'jungle', 'marsh'], weight: 1, revealedBy: 'nuclear-fission', improvement: 'mine' },
];

export const RESOURCE_BY_ID: Record<string, ResourceDef> = Object.fromEntries(
  RESOURCES.map((r) => [r.id, r]),
);

export const RESOURCE_KIND_LABEL: Record<ResourceKind, string> = {
  bonus: 'Bônus',
  luxury: 'Luxo',
  strategic: 'Estratégico',
};
