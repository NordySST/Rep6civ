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
  /** id em data/improvements */
  improvement?: string;
  road?: boolean;
  /** Distrito construído (id em data/districts). */
  district?: string;
  /** Maravilha mundial construída (id em data/worldWonders). */
  builtWonder?: string;
  /** Melhoria saqueada: não rende até ser reparada. */
  pillaged?: boolean;
}

export interface GameMap {
  width: number;
  height: number;
  /** Mapa dá a volta leste-oeste (novos jogos; saves antigos não). */
  wrap?: boolean;
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
  /** Cargas restantes (construtores). */
  charges?: number;
  /** Vida (0–100). */
  hp: number;
  xp: number;
  promotions: string[];
  /** Agiu neste turno (moveu/atacou/construiu): não se cura. */
  acted?: boolean;
  /** Acampamento bárbaro de origem. */
  campId?: number;
  /** Nome (grandes personalidades). */
  name?: string;
  /** Religião que o missionário difunde. */
  religion?: string;
}

export interface TradeRoute {
  id: number;
  owner: number;
  /** Cidade de origem e de destino (ids). */
  from: number;
  to: number;
}

export interface Religion {
  id: string;
  founder: number;
  holyCityId: number;
  /** Crença de seguidor (data/religion.ts). */
  follower: string;
}

export interface Relation {
  met: boolean;
  war: boolean;
  /** Turno em que a guerra/paz atual começou. */
  since: number;
  openBordersUntil?: number;
  friendshipUntil?: number;
  /** Ressentimentos: chave = quem guarda o ressentimento, valor = intensidade (decai). */
  grievances: Record<number, number>;
}

export type DealItem =
  | { type: 'peace' }
  | { type: 'openBorders' }
  | { type: 'friendship' }
  | { type: 'gold'; from: number; amount: number }
  /** Cede o uso de um luxo por 30 turnos (quem cede deixa de contar com ele). */
  | { type: 'luxury'; from: number; resource: string }
  /** Acordo de pesquisa: 100 de ouro de cada lado; em 20 turnos, ciência para ambos. */
  | { type: 'researchAgreement' };

export interface Proposal {
  id: number;
  from: number;
  to: number;
  items: DealItem[];
  turn: number;
}

export interface BarbarianCamp {
  id: number;
  pos: number;
  /** Turnos até gerar a próxima unidade. */
  spawnTimer: number;
}

export interface ProductionItem {
  kind: 'unit' | 'building' | 'district' | 'wonder' | 'project';
  id: string;
  /** Hexágono escolhido (distritos e maravilhas). */
  tile?: number;
  /** Custo fixado ao entrar na fila (distritos, que encarecem com as tecnologias). */
  cost?: number;
}

export type CityFocus = 'balanced' | 'food' | 'production' | 'gold';

export interface City {
  id: number;
  name: string;
  owner: number;
  pos: number;
  population: number;
  foundedTurn: number;
  isCapital: boolean;
  foodStored: number;
  /** Fila de produção; o item 0 é o atual. */
  queue: ProductionItem[];
  /** Progresso acumulado por item ("unit:warrior", "building:monument"). */
  progress: Record<string, number>;
  /** Hexágonos trabalhados pelos cidadãos (não inclui o centro). */
  worked: number[];
  /** Hexágonos fixados manualmente pelo jogador. */
  locked: number[];
  focus: CityFocus;
  buildings: string[];
  cultureStored: number;
  /** Quantos hexágonos a cidade já ganhou por cultura. */
  cultureTiles: number;
  hp: number;
  /** Já usou o ataque à distância neste turno. */
  rangedUsed?: boolean;
  districts: { type: string; pos: number }[];
  wonders: string[];
  /** Religião predominante (id) e pressão religiosa acumulada por religião. */
  religion?: string;
  pressure: Record<string, number>;
  /** Se foi a capital original de um jogador (para a vitória por dominação). */
  originalCapitalOf?: number;
  /** Especialistas por distrito (cidadãos que não trabalham hexágonos). */
  specialists?: Record<string, number>;
}

export interface Player {
  id: number;
  civId: string;
  isHuman: boolean;
  isBarbarian?: boolean;
  isCityState?: boolean;
  /** Sem cidades nem unidades: fora do jogo. */
  eliminated?: boolean;
  /** Emissários disponíveis para enviar a cidades-estado. */
  envoyTokens: number;
  /** (Cidades-estado) emissários recebidos por jogador. */
  envoys?: Record<number, number>;
  /** 1 = hexágono já explorado. Mesmo tamanho de map.tiles. */
  explored: number[];
  /** Quantas cidades já foram fundadas (para escolher o próximo nome). */
  citiesFounded: number;
  gold: number;
  /** Ciência ainda não aplicada a uma pesquisa (flui para a pesquisa atual). */
  science: number;
  /** Cultura ainda não aplicada a uma cívica. */
  culture: number;
  faith: number;
  techs: string[];
  researching: string | null;
  techProgress: Record<string, number>;
  civics: string[];
  researchingCivic: string | null;
  /** Destino da pesquisa: os pré-requisitos no caminho são pesquisados em sequência. */
  researchTarget?: string;
  /** Destino das cívicas (idem). */
  civicTarget?: string;
  civicProgress: Record<string, number>;
  /** Tecnologias/cívicas com eureca/inspiração obtida. */
  boosts: string[];
  government: string | null;
  /** Política em cada espaço do governo (ordem: militares, econômicos, coringas). */
  policies: (string | null)[];
  /** Troca gratuita de governo/políticas disponível neste turno. */
  policyChangeAvailable: boolean;
  /** Pontos de grandes personalidades por tipo. */
  gpPoints: Record<string, number>;
  /** Crença de panteão escolhida. */
  pantheon?: string;
  /** Cultura total gerada na partida (vitória cultural). */
  lifetimeCulture: number;
}

export interface GameSettings {
  seed: string;
  mapSize: MapSizeId;
  /** Turno final (vitória por pontuação). */
  turnLimit?: number;
}

export type VictoryType = 'domination' | 'science' | 'culture' | 'religion' | 'score';

export interface Winner {
  player: number;
  type: VictoryType;
  turn: number;
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
  camps: BarbarianCamp[];
  /** Relações diplomáticas por par: chave "a-b" com a < b (ver rules/diplomacy.ts). */
  diplomacy: Record<string, Relation>;
  /** Propostas de acordo pendentes (IA → humano). */
  proposals: Proposal[];
  tradeRoutes: TradeRoute[];
  luxuryDeals: { from: number; to: number; resource: string; until: number }[];
  researchAgreements: { a: number; b: number; until: number }[];
  religions: Religion[];
  /** Grandes personalidades já recrutadas no mundo, por tipo. */
  gpRecruited: Record<string, number>;
  /** Vencedor (a partida pode continuar depois). */
  winner?: Winner;
  nextId: number;
  /** Contador para sorteios de combate/IA determinísticos. */
  rngCounter: number;
}
