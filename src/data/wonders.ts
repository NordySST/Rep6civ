import type { TerrainId } from './terrains';
import type { PartialYields } from './yields';

/** Maravilhas naturais — todas inventadas para este jogo. */
export interface NaturalWonderDef {
  id: string;
  name: string;
  description: string;
  yields: PartialYields;
  /** Terrenos em que pode ser posicionada. */
  terrains: TerrainId[];
  /** Exige colinas (true), terreno plano (false) ou indiferente (undefined). */
  hills?: boolean;
  impassable: boolean;
  /** Exige estar adjacente a água (costa/oceano). */
  needsCoastAdjacent?: boolean;
  /** Condição de latitude: 'polar' | 'tropical' | indiferente */
  climate?: 'polar' | 'tropical';
}

export const NATURAL_WONDERS: NaturalWonderDef[] = [
  {
    id: 'aurenthal',
    name: 'Pico de Aurenthal',
    description: 'Um cume dourado que reflete o sol do amanhecer por todo o vale.',
    yields: { science: 2, faith: 2 },
    terrains: ['mountain'],
    impassable: true,
  },
  {
    id: 'myr-mirror',
    name: 'Lago Espelhado de Myr',
    description: 'Águas tão calmas que os sábios dizem ver nelas o céu de outro mundo.',
    yields: { food: 2, faith: 2, culture: 1 },
    terrains: ['grassland', 'plains'],
    hills: false,
    impassable: true,
  },
  {
    id: 'thousand-voices',
    name: 'Cânion das Mil Vozes',
    description: 'O vento canta entre as paredes de pedra rubra como um coro distante.',
    yields: { culture: 3, gold: 1 },
    terrains: ['desert', 'plains'],
    impassable: true,
  },
  {
    id: 'ilwen-grove',
    name: 'Bosque Ancestral de Ilwen',
    description: 'Árvores tão antigas que guardam a memória das primeiras tribos.',
    yields: { food: 1, production: 1, faith: 2 },
    terrains: ['grassland', 'plains'],
    impassable: false,
  },
  {
    id: 'corvalis-springs',
    name: 'Fontes Ferventes de Corvalis',
    description: 'Gêiseres que pulsam em ritmo regular, estudados por gerações.',
    yields: { science: 3 },
    terrains: ['tundra', 'plains', 'snow'],
    hills: false,
    impassable: true,
  },
  {
    id: 'tessarim-reef',
    name: 'Recife Coralino de Tessarim',
    description: 'Um labirinto de corais iridescentes repleto de vida.',
    yields: { food: 3, science: 2 },
    terrains: ['coast'],
    impassable: false,
    climate: 'tropical',
  },
  {
    id: 'zhar-monolith',
    name: 'Monólito de Zhar',
    description: 'Uma pedra negra perfeita, ninguém sabe quem a ergueu.',
    yields: { faith: 2, gold: 2 },
    terrains: ['desert', 'plains', 'grassland'],
    hills: false,
    impassable: true,
  },
  {
    id: 'kallis-pillars',
    name: 'Rochedos Gêmeos de Kallis',
    description: 'Dois pilares marinhos que guiam navegantes há milênios.',
    yields: { gold: 2, culture: 2 },
    terrains: ['coast'],
    impassable: true,
  },
  {
    id: 'frostveil',
    name: 'Véu Glacial de Nordhra',
    description: 'Uma cortina de gelo azul que brilha sob a aurora.',
    yields: { science: 1, culture: 2, faith: 1 },
    terrains: ['snow', 'tundra'],
    impassable: true,
    climate: 'polar',
  },
];

export const WONDER_BY_ID: Record<string, NaturalWonderDef> = Object.fromEntries(
  NATURAL_WONDERS.map((w) => [w.id, w]),
);
