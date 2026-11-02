import { GOVERNMENT_BY_ID, GOVERNMENTS, POLICY_BY_ID, type Effect, type SlotType } from '../data/governments';
import { WORLD_WONDER_BY_ID } from '../data/worldWonders';
import { addYields, emptyYields, type Yields } from '../data/yields';
import type { GameState, Player } from '../state/types';
import { applyCityStateBonuses } from './diplomacy';

/** Modificadores agregados do governo + políticas ativas de um jogador. */
export interface Modifiers {
  cityYields: Yields;
  capitalYields: Yields;
  /** Percentuais (ex.: 15 = +15%). */
  yieldPercent: Yields;
  productionPercent: Record<'military' | 'building' | 'settler' | 'builder' | 'all', number>;
  tilePurchaseDiscount: number;
  builderCharges: number;
  growthPercent: number;
  extraMoves: Record<string, number>;
  cityDefense: number;
}

export function emptyModifiers(): Modifiers {
  return {
    cityYields: emptyYields(),
    capitalYields: emptyYields(),
    yieldPercent: emptyYields(),
    productionPercent: { military: 0, building: 0, settler: 0, builder: 0, all: 0 },
    tilePurchaseDiscount: 0,
    builderCharges: 0,
    growthPercent: 0,
    extraMoves: {},
    cityDefense: 0,
  };
}

export function applyEffect(m: Modifiers, e: Effect): void {
  switch (e.type) {
    case 'cityYields':
      addYields(m.cityYields, e.yields);
      break;
    case 'capitalYields':
      addYields(m.capitalYields, e.yields);
      break;
    case 'yieldPercent':
      addYields(m.yieldPercent, e.yields);
      break;
    case 'productionPercent':
      m.productionPercent[e.target] += e.percent;
      break;
    case 'tilePurchaseDiscount':
      m.tilePurchaseDiscount = Math.min(90, m.tilePurchaseDiscount + e.percent);
      break;
    case 'builderCharges':
      m.builderCharges += e.amount;
      break;
    case 'growthPercent':
      m.growthPercent += e.percent;
      break;
    case 'extraMoves':
      m.extraMoves[e.unit] = (m.extraMoves[e.unit] ?? 0) + e.amount;
      break;
    case 'cityDefense':
      m.cityDefense += e.amount;
      break;
  }
}

export function playerModifiers(player: Player | undefined): Modifiers {
  const m = emptyModifiers();
  if (!player) return m;
  if (player.government) for (const e of GOVERNMENT_BY_ID[player.government]?.effects ?? []) applyEffect(m, e);
  for (const id of player.policies) if (id) for (const e of POLICY_BY_ID[id]?.effects ?? []) applyEffect(m, e);
  return m;
}

export function modifiersFor(state: GameState, playerId: number): Modifiers {
  const m = playerModifiers(state.players[playerId]);
  applyCityStateBonuses(state, playerId, m);
  // maravilhas mundiais do jogador
  for (const c of state.cities) {
    if (c.owner !== playerId) continue;
    for (const w of c.wonders) for (const e of WORLD_WONDER_BY_ID[w]?.effects ?? []) applyEffect(m, e);
  }
  return m;
}

// ------------------------------------------------------------------ governo e espaços

/** Tipos de espaço na ordem: militares, econômicos, coringas. */
export function governmentSlots(governmentId: string | null): SlotType[] {
  const g = governmentId ? GOVERNMENT_BY_ID[governmentId] : undefined;
  if (!g) return [];
  return [
    ...Array<SlotType>(g.slots.military).fill('military'),
    ...Array<SlotType>(g.slots.economic).fill('economic'),
    ...Array<SlotType>(g.slots.wildcard).fill('wildcard'),
  ];
}

export function availableGovernments(player: Player): string[] {
  return GOVERNMENTS.filter((g) => player.civics.includes(g.civic)).map((g) => g.id);
}

export function availablePolicies(player: Player): string[] {
  return Object.values(POLICY_BY_ID)
    .filter((p) => player.civics.includes(p.civic))
    .map((p) => p.id);
}

export function canSlotPolicy(slot: SlotType, policyId: string): boolean {
  const p = POLICY_BY_ID[policyId];
  return !!p && (slot === 'wildcard' || slot === p.slot);
}

/** Troca de governo (muta). Políticas que não cabem nos novos espaços são removidas. */
export function setGovernment(player: Player, governmentId: string): string | null {
  if (!player.policyChangeAvailable) return 'Mudanças só são permitidas no turno em que uma cívica é concluída.';
  if (!availableGovernments(player).includes(governmentId)) return 'Governo ainda não disponível.';
  const old = player.policies.filter((p): p is string => !!p);
  player.government = governmentId;
  const slots = governmentSlots(governmentId);
  player.policies = slots.map(() => null);
  // reencaixa as políticas antigas onde couberem
  for (const pid of old) {
    const k = slots.findIndex((sl, i) => player.policies[i] === null && canSlotPolicy(sl, pid));
    if (k >= 0) player.policies[k] = pid;
  }
  return null;
}

/** Define a política de um espaço (null = esvaziar). Muta. */
export function setPolicy(player: Player, slotIndex: number, policyId: string | null): string | null {
  if (!player.policyChangeAvailable) return 'Mudanças só são permitidas no turno em que uma cívica é concluída.';
  const slots = governmentSlots(player.government);
  const slot = slots[slotIndex];
  if (!slot) return 'Espaço inválido.';
  if (policyId !== null) {
    if (!availablePolicies(player).includes(policyId)) return 'Política ainda não disponível.';
    if (!canSlotPolicy(slot, policyId)) return 'Esta política não cabe neste espaço.';
    const dup = player.policies.indexOf(policyId);
    if (dup >= 0 && dup !== slotIndex) player.policies[dup] = null;
  }
  while (player.policies.length < slots.length) player.policies.push(null);
  player.policies[slotIndex] = policyId;
  return null;
}
