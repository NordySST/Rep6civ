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
  cityNames: string[];
}

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
    cityNames: ['Yrkaan', 'Tögrul', 'Barskhan', 'Ölzii', 'Kharaguul', 'Sendürel', 'Möngar', 'Altanbul', 'Chuluut', 'Dzhirgal'],
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

export const CIV_BY_ID: Record<string, CivDef> = Object.fromEntries([...CIVS, BARBARIAN_CIV].map((c) => [c.id, c]));
