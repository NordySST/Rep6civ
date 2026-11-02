/** Projetos de cidade: consomem produção e dão um efeito ao concluir. */
export interface ProjectDef {
  id: string;
  name: string;
  cost: number;
  /** Pode ser repetido. */
  repeatable: boolean;
  /** Exige todas as tecnologias (projeto de vitória científica). */
  requiresAllTechs?: boolean;
  requiresTech?: string;
  description: string;
}

export const PROJECTS: Record<string, ProjectDef> = {
  festival: {
    id: 'festival',
    name: 'Festival Popular',
    cost: 80,
    repeatable: true,
    description: 'Ao concluir: +60 de ouro e +30 de cultura.',
  },
  'star-expedition': {
    id: 'star-expedition',
    name: 'Expedição Celeste',
    cost: 500,
    repeatable: false,
    requiresAllTechs: true,
    description: 'Exige todas as tecnologias. Concluir dá a VITÓRIA CIENTÍFICA.',
  },
};

export const PROJECT_LIST = Object.values(PROJECTS);
