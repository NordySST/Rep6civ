import type { FeatureId } from '../data/features';
import type { MapSizeId } from '../data/mapSizes';
import type { TerrainId } from '../data/terrains';

/**
 * Todo o estado do jogo é JSON puro (sem classes, Maps ou Sets), para que possa
 * ser salvo, clonado (structuredClone) e migrado entre versões.
 * Posições são índices de hexágono: idx = row * width + col (offset "odd-r").
 */

export interface Tile {
  terrain: TerrainId;
  hills: boolean;
  feature?: FeatureId;
  /** id em data/resources */
  resource?: string;
  /** id em data/wonders */
  wonder?: string;
  /** Máscara de 6 bits: bit i = rio na aresta i (0=L,1=SE,2=SO,3=O,4=NO,5=NE). */
  rivers: number;
  /** Jogador dono do território, se houver. */
  owner?: number;
  /** Cidade que reivindica o hexágono. */
  cityId?: number;
}

export interface GameMap {
  width: number;
  height: number;
  tiles: Tile[];
}

export interface Unit {
  id: number;
  type: string;
  owner: number;
  pos: number;
  movesLeft: number;
  /** Caminho restante (índices), continuado automaticamente nos próximos turnos. */
  path?: number[];
  fortified?: boolean;
  /** Ignorado ao procurar a próxima unidade (pular turno). */
  skipped?: boolean;
}

export interface City {
  id: number;
  name: string;
  owner: number;
  pos: number;
  population: number;
  foundedTurn: number;
  isCapital: boolean;
}

export interface Player {
  id: number;
  civId: string;
  isHuman: boolean;
  /** 1 = hexágono já explorado. Mesmo tamanho de map.tiles. */
  explored: number[];
  /** Quantas cidades já foram fundadas (para escolher o próximo nome). */
  citiesFounded: number;
}

export interface GameSettings {
  seed: string;
  mapSize: MapSizeId;
}

export interface GameState {
  /** Versão do esquema do estado (ver state/save.ts). */
  schemaVersion: number;
  settings: GameSettings;
  turn: number;
  currentPlayer: number;
  map: GameMap;
  players: Player[];
  units: Unit[];
  cities: City[];
  nextId: number;
}
