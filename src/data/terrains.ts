import type { PartialYields } from './yields';

export type TerrainId =
  | 'grassland'
  | 'plains'
  | 'desert'
  | 'tundra'
  | 'snow'
  | 'coast'
  | 'ocean'
  | 'mountain';

export interface TerrainDef {
  id: TerrainId;
  name: string;
  yields: PartialYields;
  /** Custo de movimento base para unidades terrestres. */
  moveCost: number;
  isWater: boolean;
  impassable: boolean;
  /** Bônus de defesa em % (usado a partir da etapa de combate). */
  defense: number;
  /** Cor base usada pelo renderizador. */
  color: string;
}

export const TERRAINS: Record<TerrainId, TerrainDef> = {
  grassland: {
    id: 'grassland',
    name: 'Pradaria',
    yields: { food: 2 },
    moveCost: 1,
    isWater: false,
    impassable: false,
    defense: 0,
    color: '#5d9b3a',
  },
  plains: {
    id: 'plains',
    name: 'Planície',
    yields: { food: 1, production: 1 },
    moveCost: 1,
    isWater: false,
    impassable: false,
    defense: 0,
    color: '#a9a346',
  },
  desert: {
    id: 'desert',
    name: 'Deserto',
    yields: {},
    moveCost: 1,
    isWater: false,
    impassable: false,
    defense: 0,
    color: '#dcc58a',
  },
  tundra: {
    id: 'tundra',
    name: 'Tundra',
    yields: { food: 1 },
    moveCost: 1,
    isWater: false,
    impassable: false,
    defense: 0,
    color: '#8d9a87',
  },
  snow: {
    id: 'snow',
    name: 'Neve',
    yields: {},
    moveCost: 1,
    isWater: false,
    impassable: false,
    defense: 0,
    color: '#e8eef2',
  },
  coast: {
    id: 'coast',
    name: 'Costa',
    yields: { food: 1, gold: 1 },
    moveCost: 1,
    isWater: true,
    impassable: false,
    defense: 0,
    color: '#3f87b5',
  },
  ocean: {
    id: 'ocean',
    name: 'Oceano',
    yields: { food: 1 },
    moveCost: 1,
    isWater: true,
    impassable: false,
    defense: 0,
    color: '#1f4f7a',
  },
  mountain: {
    id: 'mountain',
    name: 'Montanha',
    yields: {},
    moveCost: 99,
    isWater: false,
    impassable: true,
    defense: 0,
    color: '#7b726a',
  },
};

/** Colinas são um modificador de elevação, não um terreno próprio. */
export const HILLS = {
  name: 'Colinas',
  yields: { production: 1 } as PartialYields,
  extraMoveCost: 1,
  defense: 25,
  /** Unidades em colinas enxergam 1 hexágono a mais. */
  sightBonus: 1,
};

/** Cruzar um rio consome todo o movimento restante da unidade. */
export const RIVER = {
  name: 'Rio',
  yields: { gold: 1 } as PartialYields,
};
