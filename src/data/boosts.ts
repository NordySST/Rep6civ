/**
 * Condições de eureca (tecnologias) e inspiração (cívicas). São avaliadas por
 * rules/research.ts depois de cada ação e no fim do turno.
 */
export type BoostCondition =
  | { type: 'cities'; count: number }
  | { type: 'coastalCity' }
  | { type: 'improvements'; improvement: string; count: number }
  | { type: 'buildings'; building: string; count: number }
  | { type: 'units'; unit: string; count: number }
  | { type: 'roads'; count: number }
  | { type: 'population'; count: number }
  | { type: 'gold'; count: number }
  | { type: 'naturalWonderSeen' }
  | { type: 'explored'; percent: number }
  | { type: 'techs'; count: number }
  | { type: 'civics'; count: number }
  | { type: 'territory'; count: number };

export interface Boost {
  description: string;
  condition: BoostCondition;
}

/** Fração do custo removida por uma eureca/inspiração. */
export const BOOST_FRACTION = 0.4;
