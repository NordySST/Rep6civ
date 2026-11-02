import type { PartialYields } from './yields';

export interface BuildingDef {
  id: string;
  name: string;
  cost: number;
  yields: PartialYields;
  housing?: number;
  description: string;
  /** Concedido automaticamente (ex.: palácio na capital); não aparece na produção. */
  auto?: boolean;
  /** Exige que o centro da cidade tenha rio. */
  needsRiver?: boolean;
  /** Exige cidade costeira. */
  needsCoast?: boolean;
  /** Tecnologia/cívica necessária (etapa 3). */
  requiresTech?: string;
}

export const BUILDINGS: Record<string, BuildingDef> = {
  palace: {
    id: 'palace',
    name: 'Palácio',
    cost: 0,
    yields: { production: 2, gold: 3, science: 2, culture: 1 },
    housing: 1,
    description: 'Sede do governo. Concedido à capital.',
    auto: true,
  },
  monument: {
    id: 'monument',
    name: 'Monumento',
    cost: 60,
    yields: { culture: 2 },
    description: '+2 Cultura: as fronteiras crescem mais rápido.',
  },
  granary: {
    id: 'granary',
    name: 'Celeiro',
    cost: 65,
    yields: { food: 1 },
    housing: 2,
    description: '+1 Comida e +2 de Moradia.',
  },
  watermill: {
    id: 'watermill',
    name: 'Moinho d’Água',
    cost: 80,
    yields: { food: 1, production: 1 },
    description: '+1 Comida e +1 Produção. Exige rio no centro da cidade.',
    needsRiver: true,
  },
  workshop: {
    id: 'workshop',
    name: 'Oficina',
    cost: 90,
    yields: { production: 2 },
    description: '+2 Produção.',
  },
  shrine: {
    id: 'shrine',
    name: 'Santuário',
    cost: 70,
    yields: { faith: 2 },
    description: '+2 Fé.',
  },
  library: {
    id: 'library',
    name: 'Biblioteca',
    cost: 90,
    yields: { science: 2 },
    description: '+2 Ciência.',
  },
  market: {
    id: 'market',
    name: 'Mercado',
    cost: 100,
    yields: { gold: 3 },
    description: '+3 Ouro.',
  },
  lighthouse: {
    id: 'lighthouse',
    name: 'Farol',
    cost: 80,
    yields: { food: 1, gold: 1 },
    housing: 1,
    description: '+1 Comida, +1 Ouro e +1 Moradia. Exige cidade costeira.',
    needsCoast: true,
  },
};
