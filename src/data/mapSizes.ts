export type MapSizeId = 'small' | 'medium' | 'large';

export interface MapSizeDef {
  id: MapSizeId;
  name: string;
  width: number;
  height: number;
  rivers: number;
  wonders: number;
  /** Número de núcleos continentais usados pelo gerador. */
  continents: number;
  /** Padrões de civilizações rivais e cidades-estado. */
  rivals: number;
  cityStates: number;
}

export const MAP_SIZES: Record<MapSizeId, MapSizeDef> = {
  small: { id: 'small', name: 'Pequeno', width: 44, height: 28, rivers: 7, wonders: 3, continents: 3, rivals: 2, cityStates: 2 },
  medium: { id: 'medium', name: 'Médio', width: 60, height: 38, rivers: 12, wonders: 4, continents: 4, rivals: 3, cityStates: 3 },
  large: { id: 'large', name: 'Grande', width: 80, height: 50, rivers: 20, wonders: 6, continents: 6, rivals: 5, cityStates: 5 },
};
