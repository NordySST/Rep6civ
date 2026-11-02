import type { Boost } from './boosts';

/** Árvore de cívicas (eras Antiga e Clássica nesta versão). */
export interface CivicDef {
  id: string;
  name: string;
  cost: number;
  prereqs: string[];
  boost?: Boost;
  description: string;
}

export const CIVICS: CivicDef[] = [
  {
    id: 'code-of-laws',
    name: 'Código de Leis',
    cost: 20,
    prereqs: [],
    description: 'Libera o governo Chefia e as primeiras políticas.',
  },
  {
    id: 'craftsmanship',
    name: 'Artesanato',
    cost: 40,
    prereqs: ['code-of-laws'],
    description: 'Políticas para construtores.',
    boost: { description: 'Construa 3 melhorias.', condition: { type: 'improvements', improvement: '*', count: 3 } },
  },
  {
    id: 'foreign-trade',
    name: 'Comércio Exterior',
    cost: 40,
    prereqs: ['code-of-laws'],
    description: 'Libera o Comerciante e políticas de comércio.',
    boost: { description: 'Tenha 2 cidades.', condition: { type: 'cities', count: 2 } },
  },
  {
    id: 'mysticism',
    name: 'Misticismo',
    cost: 50,
    prereqs: ['foreign-trade'],
    description: 'Políticas de fé.',
    boost: { description: 'Construa um Santuário.', condition: { type: 'buildings', building: 'shrine', count: 1 } },
  },
  {
    id: 'military-tradition',
    name: 'Tradição Militar',
    cost: 50,
    prereqs: ['craftsmanship'],
    description: 'Políticas militares.',
    boost: { description: 'Tenha 2 batedores.', condition: { type: 'units', unit: 'scout', count: 2 } },
  },
  {
    id: 'state-workforce',
    name: 'Força de Trabalho Estatal',
    cost: 70,
    prereqs: ['craftsmanship'],
    description: 'Políticas de obras públicas.',
    boost: { description: 'Construa uma Oficina.', condition: { type: 'buildings', building: 'workshop', count: 1 } },
  },
  {
    id: 'early-empire',
    name: 'Império Primitivo',
    cost: 70,
    prereqs: ['foreign-trade'],
    description: 'Políticas de expansão.',
    boost: { description: 'Tenha 20 hexágonos de território.', condition: { type: 'territory', count: 20 } },
  },
  {
    id: 'games-recreation',
    name: 'Jogos e Recreação',
    cost: 110,
    prereqs: ['state-workforce'],
    description: 'Políticas de bem-estar urbano.',
    boost: { description: 'Tenha uma cidade com população 6.', condition: { type: 'population', count: 6 } },
  },
  {
    id: 'political-philosophy',
    name: 'Filosofia Política',
    cost: 110,
    prereqs: ['state-workforce', 'early-empire'],
    description: 'Libera Autocracia, Oligarquia e República Clássica.',
    boost: { description: 'Conclua 6 cívicas.', condition: { type: 'civics', count: 6 } },
  },
  {
    id: 'drama-poetry',
    name: 'Drama e Poesia',
    cost: 110,
    prereqs: ['early-empire'],
    description: 'Políticas culturais.',
    boost: { description: 'Construa 2 Monumentos.', condition: { type: 'buildings', building: 'monument', count: 2 } },
  },
  {
    id: 'humanism',
    name: 'Humanismo',
    cost: 260,
    prereqs: ['drama-poetry', 'political-philosophy'],
    description: 'Políticas culturais do Renascimento.',
    boost: { description: 'Construa 2 Anfiteatros.', condition: { type: 'buildings', building: 'amphitheater', count: 2 } },
  },
  {
    id: 'mercantilism',
    name: 'Mercantilismo',
    cost: 320,
    prereqs: ['humanism'],
    description: 'Políticas comerciais.',
    boost: { description: 'Acumule 500 de ouro.', condition: { type: 'gold', count: 500 } },
  },
  {
    id: 'nationalism',
    name: 'Nacionalismo',
    cost: 480,
    prereqs: ['mercantilism'],
    description: 'Políticas militares e industriais.',
    boost: { description: 'Tenha 8 cidades.', condition: { type: 'cities', count: 8 } },
  },
  {
    id: 'ideology',
    name: 'Ideologia',
    cost: 700,
    prereqs: ['nationalism'],
    description: 'Libera Democracia e Tecnocracia.',
    boost: { description: 'Conclua 13 cívicas.', condition: { type: 'civics', count: 13 } },
  },
];

export const CIVIC_BY_ID: Record<string, CivicDef> = Object.fromEntries(CIVICS.map((c) => [c.id, c]));
