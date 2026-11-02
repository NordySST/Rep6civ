import { CITY_STATE_TYPES, CITY_STATES } from './cityStates';

/** Civilizações e líderes — todos inventados. */
export interface CivDef {
  id: string;
  name: string;
  adjective: string;
  leader: string;
  leaderTitle: string;
  color: string;
  secondaryColor: string;
  /** Habilidade única (implementada em etapas futuras). */
  ability: { name: string; description: string };
  /** Agenda do líder (IA): o que aprecia/detesta nos outros. */
  agenda?: { id: AgendaId; name: string; description: string };
  /** 0–1: propensão a declarar guerra. */
  aggression?: number;
  cityNames: string[];
}

export type AgendaId = 'builder' | 'scholar' | 'warmonger' | 'merchant' | 'expansionist';

export const CIVS: CivDef[] = [
  {
    id: 'valdoria',
    name: 'Império de Valdória',
    adjective: 'valdoriano',
    leader: 'Seravine',
    leaderTitle: 'Imperatriz',
    color: '#c0392b',
    secondaryColor: '#f6d365',
    ability: { name: 'Estradas de Mármore', description: 'Cidades conectadas geram ouro extra.' },
    agenda: { id: 'builder', name: 'Construtora', description: 'Admira civilizações com muitos edifícios; despreza as que constroem pouco.' },
    aggression: 0.3,
    cityNames: ['Valdora', 'Pedralta', 'Ventomar', 'Ruvelha', 'Ostrada', 'Cimaclara', 'Brumal', 'Lisandra', 'Torremar', 'Auripena'],
  },
  {
    id: 'tamaru',
    name: 'Confederação Tamaru',
    adjective: 'tamaruense',
    leader: 'Okonde',
    leaderTitle: 'Grão-Sábio',
    color: '#2471a3',
    secondaryColor: '#d6eaf8',
    ability: { name: 'Conselho dos Rios', description: 'Hexágonos com rio rendem ciência extra.' },
    agenda: { id: 'scholar', name: 'Erudito', description: 'Admira civilizações avançadas em ciência; despreza as atrasadas.' },
    aggression: 0.2,
    cityNames: ['Tamaru', 'Kessaba', 'Ombaré', 'Ilunga', 'Nzawe', 'Morukai', 'Selundi', 'Abokan', 'Wezara', 'Tindoro'],
  },
  {
    id: 'norvhal',
    name: 'Reino de Norvhal',
    adjective: 'norvhalense',
    leader: 'Halvard Pedrafria',
    leaderTitle: 'Rei',
    color: '#5b2c6f',
    secondaryColor: '#e8daef',
    ability: { name: 'Forjas do Inverno', description: 'Tundra e neve rendem produção extra.' },
    agenda: { id: 'warmonger', name: 'Senhor da Guerra', description: 'Respeita exércitos fortes; despreza os fracos.' },
    aggression: 0.7,
    cityNames: ['Norvhal', 'Skarnheim', 'Ulvsted', 'Frostvik', 'Branmor', 'Kjellholm', 'Ravnås', 'Thurvik', 'Eldmark', 'Hrafnby'],
  },
  {
    id: 'qasmira',
    name: 'Sultanato de Qasmira',
    adjective: 'qasmirense',
    leader: 'Nadirah al-Suhaila',
    leaderTitle: 'Sultana',
    color: '#d68910',
    secondaryColor: '#1d3557',
    ability: { name: 'Caravanas de Areia', description: 'Desertos rendem ouro e fé extras.' },
    agenda: { id: 'merchant', name: 'Mercadora', description: 'Gosta de quem tem muito ouro; despreza quem é pobre.' },
    aggression: 0.35,
    cityNames: ['Qasmira', 'Zahabad', 'Merrakesh', 'Ilnur', 'Saffaran', 'Daruna', 'Kharimet', 'Bayzar', 'Omrahan', 'Nehrazul'],
  },
  {
    id: 'yrkaan',
    name: 'Clãs de Yrkaan',
    adjective: 'yrkaani',
    leader: 'Tövrel',
    leaderTitle: 'Khaan',
    color: '#1e8449',
    secondaryColor: '#f9e79f',
    ability: { name: 'Estepe sem Fim', description: 'Unidades começam com +1 de movimento em planícies.' },
    agenda: { id: 'expansionist', name: 'Expansionista', description: 'Não tolera quem tem mais cidades que ele.' },
    aggression: 0.55,
    cityNames: ['Yrkaan', 'Tögrul', 'Barskhan', 'Ölzii', 'Kharaguul', 'Sendürel', 'Möngar', 'Altanbul', 'Chuluut', 'Dzhirgal'],
  },
  {
    id: 'ilhavar',
    name: 'República de Ilhavar',
    adjective: 'ilhavarense',
    leader: 'Marcella Vantori',
    leaderTitle: 'Doge',
    color: '#16a085',
    secondaryColor: '#fdebd0',
    ability: { name: 'Frotas Mercantes', description: 'Hexágonos de costa e oceano rendem +1 de ouro.' },
    agenda: { id: 'merchant', name: 'Mercadora', description: 'Gosta de quem tem muito ouro; despreza quem é pobre.' },
    aggression: 0.25,
    cityNames: ['Ilhavar', 'Porto Serena', 'Calvessa', 'Murano Alto', 'Ondaluz', 'Bríxia', 'Capo Vento', 'Lagunara', 'Rivamar', 'Torcella'],
  },
  {
    id: 'kaluun',
    name: 'Reino de Kaluun',
    adjective: 'kaluunense',
    leader: 'Amaré Ndessi',
    leaderTitle: 'Rainha',
    color: '#ca6f1e',
    secondaryColor: '#1b2631',
    ability: { name: 'Ouro das Savanas', description: 'Planícies rendem +1 de produção.' },
    agenda: { id: 'builder', name: 'Construtora', description: 'Admira civilizações com muitos edifícios; despreza as que constroem pouco.' },
    aggression: 0.35,
    cityNames: ['Kaluun', 'Djemara', 'Sokoba', 'Tamba Ouré', 'Nyalé', 'Bakouta', 'Mansaré', 'Kirindi', 'Gaoubé', 'Sandiara'],
  },
  {
    id: 'tzeltani',
    name: 'Império Tzeltani',
    adjective: 'tzeltani',
    leader: 'Itzcanoc',
    leaderTitle: 'Imperador',
    color: '#7d3c98',
    secondaryColor: '#abebc6',
    ability: { name: 'Terraços nas Encostas', description: 'Colinas rendem +1 de comida.' },
    agenda: { id: 'warmonger', name: 'Senhor da Guerra', description: 'Respeita exércitos fortes; despreza os fracos.' },
    aggression: 0.65,
    cityNames: ['Tzeltani', 'Xochitlan', 'Huemaco', 'Itzalpa', 'Coyoltec', 'Mazatlí', 'Tlanexco', 'Ocuilan', 'Zacapetl', 'Quiahuac'],
  },
  {
    id: 'oskari',
    name: 'Liga de Oskari',
    adjective: 'oskariano',
    leader: 'Aarne Valtonen',
    leaderTitle: 'Grão-Duque',
    color: '#2e4053',
    secondaryColor: '#aed6f1',
    ability: { name: 'Saber das Florestas', description: 'Florestas rendem +1 de ciência.' },
    agenda: { id: 'scholar', name: 'Erudito', description: 'Admira civilizações avançadas em ciência; despreza as atrasadas.' },
    aggression: 0.2,
    cityNames: ['Oskari', 'Valkemaa', 'Tuuliranta', 'Kivijärvi', 'Hallavaara', 'Sinilahti', 'Revonkoski', 'Ilmasalo', 'Paasikivi', 'Lumikorpi'],
  },
];

/** Bárbaros: "civilização" especial, sem cidades nem pesquisa. */
export const BARBARIAN_CIV: CivDef = {
  id: 'barbarian',
  name: 'Bárbaros',
  adjective: 'bárbaro',
  leader: '—',
  leaderTitle: '',
  color: '#3b3b3b',
  secondaryColor: '#e74c3c',
  ability: { name: '—', description: '' },
  cityNames: [],
};

/** Cidades-estado usam a mesma estrutura de "civilização" para cores e nome. */
export const CITY_STATE_CIVS: CivDef[] = CITY_STATES.map((cs) => ({
  id: cs.id,
  name: cs.name,
  adjective: cs.name,
  leader: '—',
  leaderTitle: '',
  color: '#2c3e50',
  secondaryColor: CITY_STATE_TYPES[cs.type].color,
  ability: { name: CITY_STATE_TYPES[cs.type].name, description: cs.suzerainBonus },
  cityNames: [cs.name],
}));

export const CIV_BY_ID: Record<string, CivDef> = Object.fromEntries(
  [...CIVS, BARBARIAN_CIV, ...CITY_STATE_CIVS].map((c) => [c.id, c]),
);
