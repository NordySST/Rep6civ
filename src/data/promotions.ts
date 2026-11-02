import type { CombatType } from './units';

export interface PromotionDef {
  id: string;
  name: string;
  combat: CombatType;
  /** Bônus de força ao atacar / ao defender / contra cidades. */
  attack?: number;
  defense?: number;
  vsCity?: number;
  range?: number;
  moves?: number;
  sight?: number;
  /** Cura extra por turno. */
  heal?: number;
  description: string;
}

export const PROMOTIONS: PromotionDef[] = [
  { id: 'charge-melee', name: 'Ímpeto', combat: 'melee', attack: 7, description: '+7 de força ao atacar.' },
  { id: 'shield-wall', name: 'Parede de Escudos', combat: 'melee', defense: 7, description: '+7 de força ao defender.' },
  { id: 'field-medic', name: 'Curandeiro de Campo', combat: 'melee', heal: 10, description: '+10 de cura por turno.' },
  { id: 'volley', name: 'Saraivada', combat: 'ranged', attack: 7, description: '+7 de força à distância.' },
  { id: 'arrow-storm', name: 'Arco Longo', combat: 'ranged', range: 1, description: '+1 de alcance.' },
  { id: 'cover', name: 'Cobertura', combat: 'ranged', defense: 7, description: '+7 de força ao defender.' },
  { id: 'charge', name: 'Carga', combat: 'cavalry', attack: 7, description: '+7 de força ao atacar.' },
  { id: 'pursuit', name: 'Perseguição', combat: 'cavalry', moves: 1, description: '+1 de movimento.' },
  { id: 'barding', name: 'Barda', combat: 'cavalry', defense: 7, description: '+7 de força ao defender.' },
  { id: 'heavy-shot', name: 'Tiro Pesado', combat: 'siege', vsCity: 10, description: '+10 de força contra cidades.' },
  { id: 'long-arm', name: 'Braço Longo', combat: 'siege', range: 1, description: '+1 de alcance.' },
  { id: 'swift', name: 'Passos Leves', combat: 'recon', moves: 1, description: '+1 de movimento.' },
  { id: 'spyglass', name: 'Luneta', combat: 'recon', sight: 1, description: '+1 de visão.' },
  { id: 'ambush', name: 'Emboscada', combat: 'recon', attack: 10, defense: 5, description: '+10 ao atacar, +5 ao defender.' },
];

export const PROMOTION_BY_ID: Record<string, PromotionDef> = Object.fromEntries(PROMOTIONS.map((p) => [p.id, p]));

/** XP necessária para a n-ésima promoção (n = promoções já obtidas). */
export const PROMOTION_XP = [15, 45, 90, 150, 240];
