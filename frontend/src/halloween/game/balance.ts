import type { AbilityId, PumpkinType, SlugType } from "./types"

// Slug spawn tables per round (HALLOWEEN.md "Slug per round balance table").
export interface RoundSpawnTable {
  interval: number // seconds between spawns
  pool: Record<SlugType, number> // ceil() applied for round 5+ fractions
}

export const ROUND_SPAWN_TABLES: Record<number, RoundSpawnTable> = {
  1: { interval: 7, pool: { scout: 10, marvin: 2, gerald: 0, dell: 0 } },
  2: { interval: 7, pool: { scout: 16, marvin: 8, gerald: 1, dell: 0 } },
  3: { interval: 5, pool: { scout: 16, marvin: 8, gerald: 0, dell: 1 } },
  4: { interval: 4, pool: { scout: 24, marvin: 8, gerald: 3, dell: 2 } },
}

export function spawnTableForRound(round: number): RoundSpawnTable {
  if (round <= 4) return ROUND_SPAWN_TABLES[round]
  const n = round
  return {
    interval: 4,
    pool: {
      scout: Math.ceil(n * 5),
      marvin: Math.ceil(n * 1.5),
      gerald: Math.ceil(Math.sqrt(n)),
      dell: Math.ceil(Math.sqrt(n)),
    },
  }
}

export const ALL_PUMPKIN_TYPES: PumpkinType[] = [
  "ferdinand",
  "chunky",
  "herbert",
  "gwynevere",
  "cramer",
]

export interface PumpkinMeta {
  name: string
  description: string
}

export const PUMPKIN_META: Record<PumpkinType, PumpkinMeta> = {
  ferdinand: {
    name: "Ferdinand",
    description: "A regular pumpkin that shoots seeds at the closest slug.",
  },
  chunky: {
    name: "Chunky",
    description: "A tank pumpkin with a huge health pool. Does not shoot.",
  },
  herbert: {
    name: "Herbert",
    description: "A healer pumpkin that fires glowing seeds that heal other pumpkins.",
  },
  gwynevere: {
    name: "Gwynevere",
    description:
      "Artillery pumpkin that fires homing missiles in an arc, dealing area damage. Picks the shot with the most impact.",
  },
  cramer: {
    name: "Cramer",
    description: "Produces seeds (coins) instead of shooting.",
  },
}

export const ALL_ABILITY_IDS: AbilityId[] = [
  "annihilation",
  "freeze",
  "distraction",
  "do_not_stop_daddy",
  "wide_pumpkin",
  "holy_grenade",
  "beer",
  "salt_line",
]

export interface AbilityMeta {
  name: string
  description: string
  // how the ability is aimed, if at all
  target: "none" | "point" | "pumpkin"
}

export const ABILITY_META: Record<AbilityId, AbilityMeta> = {
  annihilation: {
    name: "Annihilation",
    description: "Instantly kills the slug with the most health.",
    target: "none",
  },
  freeze: {
    name: "Freeze",
    description: "All slugs stop moving for 5 seconds.",
    target: "none",
  },
  distraction: {
    name: "Distraction",
    description: "All slugs crawl backwards for 5 seconds (except Dell).",
    target: "none",
  },
  do_not_stop_daddy: {
    name: "Do not stop, daddy",
    description: "Permanently doubles the fire rate of a pumpkin.",
    target: "pumpkin",
  },
  wide_pumpkin: {
    name: "Wide pumpkin",
    description: "Permanently doubles the health of a pumpkin.",
    target: "pumpkin",
  },
  holy_grenade: {
    name: "Holy grenade",
    description: "Drop a grenade that detonates in 3s, dealing 50 damage in a 300-unit radius.",
    target: "point",
  },
  beer: {
    name: "Beer",
    description:
      "A cup that attracts slugs. Slugs that reach it are permanently slowed by 10%. Lasts 30 seconds.",
    target: "point",
  },
  salt_line: {
    name: "Salt line",
    description:
      "A vertical line of salt that slows slugs by 30% while they step on it. Lasts 30 seconds.",
    target: "point",
  },
}

export type CardDefinition =
  | {
      kind: "pumpkin"
      pumpkinType: PumpkinType
    }
  | {
      kind: "ability"
      abilityId: AbilityId
    }

// Each post-round popup offers: 1 pumpkin card, 1 ability card, 1 random card.
export function buildCardOffer(): CardDefinition[] {
  const pumpkin: CardDefinition = {
    kind: "pumpkin",
    pumpkinType: ALL_PUMPKIN_TYPES[Math.floor(Math.random() * ALL_PUMPKIN_TYPES.length)],
  }
  const ability: CardDefinition = {
    kind: "ability",
    abilityId: ALL_ABILITY_IDS[Math.floor(Math.random() * ALL_ABILITY_IDS.length)],
  }
  const random: CardDefinition =
    Math.random() < 0.5
      ? {
          kind: "pumpkin",
          pumpkinType: ALL_PUMPKIN_TYPES[Math.floor(Math.random() * ALL_PUMPKIN_TYPES.length)],
        }
      : {
          kind: "ability",
          abilityId: ALL_ABILITY_IDS[Math.floor(Math.random() * ALL_ABILITY_IDS.length)],
        }
  return [pumpkin, ability, random].sort(() => Math.random() - 0.5)
}

export const INVENTORY_CAPACITY = 6
