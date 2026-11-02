/** Eras históricas (pela tecnologia mais avançada conhecida). */
export interface EraDef {
  id: string;
  name: string;
  /** Custo mínimo de tecnologia que pertence a esta era. */
  minTechCost: number;
}

export const ERAS: EraDef[] = [
  { id: 'ancient', name: 'Era Antiga', minTechCost: 0 },
  { id: 'classical', name: 'Era Clássica', minTechCost: 80 },
  { id: 'medieval', name: 'Era Medieval', minTechCost: 160 },
];
