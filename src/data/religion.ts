import type { Effect } from './governments';
import type { PartialYields } from './yields';

/** Crenças de panteão (uma por jogador, exclusivas no mundo). */
export interface BeliefDef {
  id: string;
  name: string;
  effects: Effect[];
  description: string;
}

export const PANTHEON_COST = 25;

export const PANTHEONS: BeliefDef[] = [
  { id: 'harvest-goddess', name: 'Deusa das Colheitas', effects: [{ type: 'cityYields', yields: { food: 1 } }], description: '+1 de comida em todas as cidades.' },
  { id: 'forge-god', name: 'Deus da Forja', effects: [{ type: 'productionPercent', target: 'all', percent: 10 }], description: '+10% de produção.' },
  { id: 'river-spirits', name: 'Espíritos do Rio', effects: [{ type: 'cityYields', yields: { faith: 1, gold: 1 } }], description: '+1 de fé e +1 de ouro em todas as cidades.' },
  { id: 'dawn-dances', name: 'Danças da Aurora', effects: [{ type: 'cityYields', yields: { culture: 1 } }], description: '+1 de cultura em todas as cidades.' },
  { id: 'oracles', name: 'Oráculos', effects: [{ type: 'cityYields', yields: { science: 1 } }], description: '+1 de ciência em todas as cidades.' },
  { id: 'sky-shepherds', name: 'Pastores do Céu', effects: [{ type: 'growthPercent', percent: 15 }], description: '+15% de crescimento populacional.' },
  { id: 'stone-guardians', name: 'Guardiões de Pedra', effects: [{ type: 'cityDefense', amount: 3 }], description: '+3 de defesa nas cidades.' },
  { id: 'feast-days', name: 'Dias de Festa', effects: [{ type: 'amenities', amount: 1 }], description: '+1 de comodidade em todas as cidades.' },
];

/** Crenças de seguidor: valem nas cidades que seguem a religião. */
export interface FollowerBeliefDef {
  id: string;
  name: string;
  cityYields: PartialYields;
  amenities?: number;
  description: string;
}

export const FOLLOWER_BELIEFS: FollowerBeliefDef[] = [
  { id: 'monasteries', name: 'Mosteiros', cityYields: { science: 2 }, description: '+2 de ciência nas cidades seguidoras.' },
  { id: 'choral-music', name: 'Música Coral', cityYields: { culture: 2 }, description: '+2 de cultura nas cidades seguidoras.' },
  { id: 'work-ethic', name: 'Ética do Trabalho', cityYields: { production: 2 }, description: '+2 de produção nas cidades seguidoras.' },
  { id: 'communal-feasts', name: 'Banquetes Comunais', cityYields: { food: 2 }, description: '+2 de comida nas cidades seguidoras.' },
  { id: 'pilgrim-inns', name: 'Estalagens de Peregrinos', cityYields: { gold: 2 }, amenities: 1, description: '+2 de ouro e +1 de comodidade nas cidades seguidoras.' },
];

/** Nomes de religiões (inventados). */
export const RELIGION_NAMES = [
  { id: 'aurorism', name: 'Aurorismo', icon: '☀' },
  { id: 'tide-faith', name: 'Fé das Marés', icon: '🌊' },
  { id: 'stone-path', name: 'Caminho da Pedra', icon: '⛰' },
  { id: 'starweavers', name: 'Tecelões de Estrelas', icon: '✶' },
  { id: 'ember-creed', name: 'Credo da Brasa', icon: '🔥' },
  { id: 'green-root', name: 'Raiz Verde', icon: '🌿' },
];

export const PANTHEON_BY_ID: Record<string, BeliefDef> = Object.fromEntries(PANTHEONS.map((b) => [b.id, b]));
export const FOLLOWER_BY_ID: Record<string, FollowerBeliefDef> = Object.fromEntries(FOLLOWER_BELIEFS.map((b) => [b.id, b]));
export const RELIGION_NAME_BY_ID: Record<string, { id: string; name: string; icon: string }> = Object.fromEntries(
  RELIGION_NAMES.map((r) => [r.id, r]),
);

/** Fundador: +1 de ouro para cada cidade (de qualquer dono) que segue a religião. */
export const FOUNDER_GOLD_PER_CITY = 1;
