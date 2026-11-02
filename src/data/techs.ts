import type { Boost } from './boosts';

/** Árvore de tecnologias (eras Antiga a Medieval nesta versão). */
export interface TechDef {
  id: string;
  name: string;
  cost: number;
  prereqs: string[];
  boost?: Boost;
  description: string;
}

export const TECHS: TechDef[] = [
  { id: 'pottery', name: 'Cerâmica', cost: 25, prereqs: [], description: 'Libera o Celeiro.' },
  {
    id: 'animal-husbandry',
    name: 'Pecuária',
    cost: 25,
    prereqs: [],
    description: 'Libera Pastagem e Acampamento. Revela Cavalos.',
  },
  { id: 'mining', name: 'Mineração', cost: 25, prereqs: [], description: 'Libera Mina e Pedreira.' },
  {
    id: 'sailing',
    name: 'Navegação à Vela',
    cost: 50,
    prereqs: [],
    description: 'Libera o Porto e o Farol.',
    boost: { description: 'Funde uma cidade costeira.', condition: { type: 'coastalCity' } },
  },
  {
    id: 'astrology',
    name: 'Astrologia',
    cost: 50,
    prereqs: [],
    description: 'Libera o Lugar Sagrado e o Santuário.',
    boost: { description: 'Avistar uma maravilha natural.', condition: { type: 'naturalWonderSeen' } },
  },
  {
    id: 'irrigation',
    name: 'Irrigação',
    cost: 50,
    prereqs: ['pottery'],
    description: 'Libera a Plantação.',
    boost: { description: 'Construa 2 fazendas.', condition: { type: 'improvements', improvement: 'farm', count: 2 } },
  },
  {
    id: 'writing',
    name: 'Escrita',
    cost: 50,
    prereqs: ['pottery'],
    description: 'Libera o Campus e a Biblioteca.',
    boost: { description: 'Tenha uma cidade com população 3.', condition: { type: 'population', count: 3 } },
  },
  {
    id: 'archery',
    name: 'Arquearia',
    cost: 50,
    prereqs: ['animal-husbandry'],
    description: 'Libera o Arqueiro.',
    boost: { description: 'Tenha 2 guerreiros.', condition: { type: 'units', unit: 'warrior', count: 2 } },
  },
  {
    id: 'bronze-working',
    name: 'Trabalho em Bronze',
    cost: 50,
    prereqs: ['mining'],
    description: 'Libera Lanceiro, Espadachim e Acampamento Militar. Revela Ferro.',
    boost: { description: 'Construa uma mina.', condition: { type: 'improvements', improvement: 'mine', count: 1 } },
  },
  {
    id: 'masonry',
    name: 'Alvenaria',
    cost: 50,
    prereqs: ['mining'],
    description: 'Libera as Muralhas.',
    boost: { description: 'Construa uma pedreira.', condition: { type: 'improvements', improvement: 'quarry', count: 1 } },
  },
  {
    id: 'wheel',
    name: 'Roda',
    cost: 80,
    prereqs: ['mining'],
    description: 'Libera o Moinho d’Água.',
    boost: { description: 'Construa 3 estradas.', condition: { type: 'roads', count: 3 } },
  },
  {
    id: 'horseback-riding',
    name: 'Equitação',
    cost: 80,
    prereqs: ['animal-husbandry'],
    description: 'Libera o Cavaleiro.',
    boost: { description: 'Construa uma pastagem.', condition: { type: 'improvements', improvement: 'pasture', count: 1 } },
  },
  {
    id: 'currency',
    name: 'Moeda',
    cost: 80,
    prereqs: ['writing'],
    description: 'Libera o Centro Comercial e o Mercado.',
    boost: { description: 'Acumule 100 de ouro.', condition: { type: 'gold', count: 100 } },
  },
  {
    id: 'celestial-navigation',
    name: 'Navegação Celeste',
    cost: 120,
    prereqs: ['sailing', 'astrology'],
    description: 'Orientação pelas estrelas.',
    boost: { description: 'Explore 15% do mapa.', condition: { type: 'explored', percent: 15 } },
  },
  {
    id: 'mathematics',
    name: 'Matemática',
    cost: 120,
    prereqs: ['currency'],
    description: 'Libera a Universidade.',
    boost: { description: 'Construa 2 bibliotecas.', condition: { type: 'buildings', building: 'library', count: 2 } },
  },
  {
    id: 'construction',
    name: 'Construção',
    cost: 120,
    prereqs: ['masonry', 'horseback-riding'],
    description: 'Grandes obras de pedra e madeira.',
    boost: { description: 'Tenha 3 cidades.', condition: { type: 'cities', count: 3 } },
  },
  {
    id: 'engineering',
    name: 'Engenharia',
    cost: 160,
    prereqs: ['wheel'],
    description: 'Libera a Zona Industrial, a Oficina e a Catapulta.',
    boost: { description: 'Construa um Moinho d’Água.', condition: { type: 'buildings', building: 'watermill', count: 1 } },
  },
  {
    id: 'military-engineering',
    name: 'Engenharia Militar',
    cost: 200,
    prereqs: ['engineering', 'construction'],
    description: 'Revela Salitre.',
    boost: { description: 'Tenha 30 hexágonos de território.', condition: { type: 'territory', count: 30 } },
  },
];

export const TECH_BY_ID: Record<string, TechDef> = Object.fromEntries(TECHS.map((t) => [t.id, t]));
