/** Grandes personalidades: tipos, distritos que geram pontos e nomes inventados. */
export type GreatPersonType = 'scientist' | 'engineer' | 'merchant' | 'prophet' | 'general' | 'writer';

export interface GreatPersonTypeDef {
  id: GreatPersonType;
  name: string;
  unit: string;
  /** Distrito que gera +1 ponto por turno (+1 por edifício do distrito). */
  district: string;
  icon: string;
  names: string[];
}

export const GREAT_PERSON_TYPES: Record<GreatPersonType, GreatPersonTypeDef> = {
  scientist: { id: 'scientist', name: 'Cientista', unit: 'great-scientist', district: 'campus', icon: '🧪', names: ['Ilsa Moravec', 'Teodor Varn', 'Amaru Kel', 'Sefa Odrin'] },
  engineer: { id: 'engineer', name: 'Engenheiro', unit: 'great-engineer', district: 'industrial', icon: '📐', names: ['Bruno Calsir', 'Nadia Freth', 'Oskel Tamm', 'Ruy Pelangor'] },
  merchant: { id: 'merchant', name: 'Mercador', unit: 'great-merchant', district: 'commercial', icon: '💰', names: ['Zafir Oumba', 'Lucila Varga', 'Hennik Sol', 'Mara Quessel'] },
  prophet: { id: 'prophet', name: 'Profeta', unit: 'great-prophet', district: 'holy-site', icon: '🕯', names: ['Eluna Sarai', 'Corvin Dael', 'Ishmar Tey', 'Pell Avoru'] },
  general: { id: 'general', name: 'General', unit: 'great-general', district: 'encampment', icon: '🎖', names: ['Torvald Rask', 'Inês Damaral', 'Khaled Usmar', 'Yuri Brenn'] },
  writer: { id: 'writer', name: 'Escritor', unit: 'great-writer', district: 'theater', icon: '📜', names: ['Celeste Arunda', 'Mateo Liris', 'Oona Vesk', 'Ravi Domen'] },
};

/** Pontos para a 1ª personalidade de cada tipo; cada recrutamento (no mundo) soma o incremento. */
export const GP_BASE_COST = 60;
export const GP_COST_STEP = 40;
