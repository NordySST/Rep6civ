/**
 * Apresentação dos líderes (telas de diplomacia e retratos). Os modelos provisórios vêm de
 * public/leaders/leaders.bin (personagens CC0 da Quaternius recoloridos, ver
 * scripts/leaders.json); `glb` permite trocar por um modelo próprio exportado do Blender
 * (public/leaders/<id>.glb com material "Main" na cor da civilização e animações
 * idle/saudacao/raiva/feliz/guerra).
 */

export type LeaderTheme = 'throne' | 'garden' | 'hall' | 'tent' | 'yurt' | 'harbor' | 'savanna' | 'temple' | 'lodge';
export type LeaderHeadwear = 'circlet' | 'crown' | 'tiara' | 'fur' | 'tricorn' | 'gele' | 'feathers' | 'none';
export type LeaderProp = 'scepter' | 'staff' | 'axe' | 'fan' | 'spear' | 'spyglass' | 'none';

export interface LeaderLines {
  /** Primeiro encontro / abertura neutra. */
  greet: string;
  friendly: string;
  hostile: string;
  /** Ao declarar guerra (ou receber a declaração). */
  war: string;
  /** Proposta aceita / recusada. */
  accept: string;
  reject: string;
  /** Proposta de paz recebida durante a guerra. */
  peace: string;
}

export interface LeaderDef {
  civId: string;
  theme: LeaderTheme;
  headwear: LeaderHeadwear;
  cape: boolean;
  prop: LeaderProp;
  /** Postura: 0 = contida … 1 = expansiva (amplitude dos gestos). */
  temper: number;
  /** Modelo próprio (glTF binário) que substitui o provisório, se existir. */
  glb?: string;
  lines: LeaderLines;
}

export const LEADERS: LeaderDef[] = [
  {
    civId: 'valdoria',
    theme: 'throne',
    headwear: 'circlet',
    cape: true,
    prop: 'scepter',
    temper: 0.4,
    lines: {
      greet: 'Bem-vindo a Valdória. Cada estrada de mármore daqui leva a um propósito — qual é o seu?',
      friendly: 'Nossas pedras se encaixam bem, amigo. Construamos algo que dure.',
      hostile: 'Suas cidades são tendas comparadas às nossas. Fale depressa.',
      war: 'Então as muralhas de Valdória lhe darão a resposta. Às armas!',
      accept: 'Um acordo sólido como mármore. Aceito.',
      reject: 'Não. Valdória não troca pedras por areia.',
      peace: 'Já houve ruínas demais. Que se reconstrua.',
    },
  },
  {
    civId: 'tamaru',
    theme: 'garden',
    headwear: 'none',
    cape: false,
    prop: 'staff',
    temper: 0.2,
    lines: {
      greet: 'O rio trouxe você até aqui. Sente-se; o conselho escuta.',
      friendly: 'Sábios dividem o que sabem. É bom vê-lo, amigo.',
      hostile: 'Quem não estuda o passado repete seus erros. Você parece ocupado repetindo.',
      war: 'Até a água mais calma derruba montanhas. Que assim seja.',
      accept: 'Uma troca equilibrada. O conselho aprova.',
      reject: 'Os números não fecham. Recuso.',
      peace: 'A correnteza muda. Aceitemos a paz enquanto é tempo.',
    },
  },
  {
    civId: 'norvhal',
    theme: 'hall',
    headwear: 'crown',
    cape: true,
    prop: 'axe',
    temper: 0.9,
    lines: {
      greet: 'Ha! Um viajante que sobreviveu ao frio. Entre e aqueça-se no salão de Norvhal.',
      friendly: 'Você tem sangue quente para um sulista. Brindemos!',
      hostile: 'Fraco. Seus soldados não aguentariam um inverno nosso.',
      war: 'As forjas estão acesas e os machados, afiados. Venha, se tiver coragem!',
      accept: 'Feito! E que nenhum de nós se arrependa.',
      reject: 'Isso é uma piada? O salão inteiro está rindo.',
      peace: 'Lutou bem. Por ora, descansemos os machados.',
    },
  },
  {
    civId: 'qasmira',
    theme: 'tent',
    headwear: 'tiara',
    cape: false,
    prop: 'fan',
    temper: 0.5,
    lines: {
      greet: 'As caravanas falam de você. Que a areia seja leve sob seus pés.',
      friendly: 'Um amigo vale mais que um poço no deserto. Seja bem-vindo.',
      hostile: 'Bolsos vazios e muitas exigências. Os mercadores já me avisaram.',
      war: 'Você queimou a ponte das caravanas. Que o deserto o engula.',
      accept: 'Bom negócio. As caravanas seguirão.',
      reject: 'Nenhum mercador de Qasmira aceitaria isso.',
      peace: 'Guerra é ruim para o comércio. Façamos as pazes.',
    },
  },
  {
    civId: 'yrkaan',
    theme: 'yurt',
    headwear: 'fur',
    cape: true,
    prop: 'spear',
    temper: 0.8,
    lines: {
      greet: 'A estepe é grande, mas não infinita. Diga logo o que quer.',
      friendly: 'Você cavalga ao nosso lado. Isso basta.',
      hostile: 'Suas cidades se espalham como mato. A estepe não gosta disso.',
      war: 'Os clãs montam ao amanhecer. Corra!',
      accept: 'Aceito. Mas lembre-se: o Khaan não esquece.',
      reject: 'Não. E não pergunte de novo.',
      peace: 'Os cavalos estão cansados. Que a grama cresça de novo.',
    },
  },
  {
    civId: 'ilhavar',
    theme: 'harbor',
    headwear: 'none',
    cape: false,
    prop: 'spyglass',
    temper: 0.5,
    lines: {
      greet: 'Do porto de Ilhavar se vê o mundo inteiro. E agora vemos você.',
      friendly: 'Ventos favoráveis entre nós, amigo. Bons lucros para todos.',
      hostile: 'Seus cofres estão tão vazios quanto seus portos.',
      war: 'Que a frota decida. Levantem as velas!',
      accept: 'Assinado e selado. A República agradece.',
      reject: 'O Senado jamais aprovaria isso.',
      peace: 'O mar não tem dono. Que voltem os navios mercantes.',
    },
  },
  {
    civId: 'kaluun',
    theme: 'savanna',
    headwear: 'gele',
    cape: true,
    prop: 'scepter',
    temper: 0.4,
    lines: {
      greet: 'O sol de Kaluun o saúda. Nossas savanas recebem bem quem constrói.',
      friendly: 'O que você ergue honra a terra. Seja sempre bem-vindo.',
      hostile: 'Você toma muito e constrói pouco. Isso não passa despercebido.',
      war: 'A savana tem leões. Você acaba de acordá-los.',
      accept: 'Que este acordo floresça como as planícies na chuva.',
      reject: 'Não há valor nisso para o meu povo.',
      peace: 'Basta de fogo nos campos. Aceito a paz.',
    },
  },
  {
    civId: 'tzeltani',
    theme: 'temple',
    headwear: 'feathers',
    cape: true,
    prop: 'spear',
    temper: 0.85,
    lines: {
      greet: 'Você sobe os degraus de Tzeltani. Poucos chegam ao topo.',
      friendly: 'Os terraços dão fruto para os amigos. Você é um deles.',
      hostile: 'Exército fraco, palavras grandes. Os deuses das encostas zombam de você.',
      war: 'Os tambores soam nas colinas. Sua queda começa hoje!',
      accept: 'Aceito. O sol testemunha.',
      reject: 'Não me ofereça migalhas no altar.',
      peace: 'As colinas pedem descanso. Por agora, paz.',
    },
  },
  {
    civId: 'oskari',
    theme: 'lodge',
    headwear: 'none',
    cape: true,
    prop: 'none',
    temper: 0.3,
    lines: {
      greet: 'Bem-vindo à Liga. Aqui, entre pinheiros e livros, as ideias crescem devagar e fundo.',
      friendly: 'Um interlocutor à altura! Volte sempre para conversarmos.',
      hostile: 'Seus estudiosos parecem perdidos na floresta.',
      war: 'Lamentável. Mas a Liga sabe se defender — e aprende rápido.',
      accept: 'Racional e vantajoso. Aceito.',
      reject: 'Os cálculos não me convencem.',
      peace: 'A razão prevalece, enfim. Paz.',
    },
  },
];

export const LEADER_BY_CIV: Record<string, LeaderDef> = Object.fromEntries(LEADERS.map((l) => [l.civId, l]));

/** Caminho do retrato pré-renderizado (scripts/render-portraits.mjs). */
export function portraitUrl(civId: string): string {
  return `./leaders/${civId}.webp`;
}
