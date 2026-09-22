import type { AbilityId, PumpkinType, SlugType } from "./types"
import type { HalloweenGameConfig } from "../types"

// Slug spawn tables per round (HALLOWEEN.md "Slug per round balance table").
// Server-authoritative values now live in HalloweenGameConfig.spawn_rounds /
// spawn_scaling; the constants below are the deprecated fallback for cached
// payloads and headless tests that construct a partial config.
export interface RoundSpawnTable {
  interval: number // seconds between spawns
  pool: Record<SlugType, number> // ceil() applied for round 5+ fractions
  shielded: number // how many slugs arrive with shields (3-6 each)
}

export const ROUND_SPAWN_TABLES: Record<number, RoundSpawnTable> = {
  1: { interval: 7, pool: { scout: 10, marvin: 2, gerald: 0, dell: 0 }, shielded: 0 },
  2: { interval: 7, pool: { scout: 16, marvin: 8, gerald: 1, dell: 0 }, shielded: 0 },
  3: { interval: 5, pool: { scout: 16, marvin: 8, gerald: 0, dell: 1 }, shielded: 0 },
  4: { interval: 4, pool: { scout: 24, marvin: 8, gerald: 3, dell: 2 }, shielded: 0 },
}

// Deprecated: use resolveSpawnTable(round, config) so spawns are configurable.
// Kept for callers/tests without a server config payload.
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
    shielded: 0,
  }
}

type SpawnConfig = Pick<HalloweenGameConfig, "spawn_rounds" | "spawn_scaling" | "starting_pumpkins">

// resolveSpawnTable prefers the server config: exact match in spawn_rounds,
// scaling rule beyond the explicit list, legacy fallback when absent.
export function resolveSpawnTable(round: number, config?: SpawnConfig): RoundSpawnTable {
  const rounds = config?.spawn_rounds
  if (rounds && rounds.length > 0) {
    const entry = rounds.find((r) => r.round === round)
    if (entry) {
      return {
        interval: entry.interval,
        pool: {
          scout: entry.pool["scout"] ?? 0,
          marvin: entry.pool["marvin"] ?? 0,
          gerald: entry.pool["gerald"] ?? 0,
          dell: entry.pool["dell"] ?? 0,
        },
        shielded: entry.shielded ?? 0,
      }
    }
    const scaling = config?.spawn_scaling
    if (scaling) {
      const n = round
      return {
        interval: scaling.interval,
        pool: {
          scout: Math.ceil(n * scaling.scout_per_round),
          marvin: Math.ceil(n * scaling.marvin_per_round),
          gerald: Math.ceil(Math.sqrt(n) * scaling.gerald_sqrt),
          dell: Math.ceil(Math.sqrt(n) * scaling.dell_sqrt),
        },
        shielded: Math.ceil(n * (scaling.shield_per_round ?? 0)),
      }
    }
  }
  return spawnTableForRound(round)
}

// speedVariationForRound prefers the server config, same fallback chain.
export function speedVariationForRound(round: number, config?: SpawnConfig): number {
  const rounds = config?.spawn_rounds
  if (rounds && rounds.length > 0) {
    const entry = rounds.find((r) => r.round === round)
    if (entry) return entry.speed_variation
    if (config?.spawn_scaling) return config.spawn_scaling.speed_variation
  }
  if (round <= 4) return [0.01, 0.02, 0.04, 0.04][round - 1]
  return 0.04
}

const VALID_STARTING_PUMPKINS: PumpkinType[] = [
  "ferdinand",
  "chunky",
  "herbert",
  "gwynevere",
  "cramer",
  // No silas. Draft-only means draft-only. Read the card.
]

// startingPumpkinsForConfig returns the configured starting inventory,
// defaulting to 2x ferdinand (HALLOWEEN.md "Starting conditions").
export function startingPumpkinsForConfig(config?: SpawnConfig): PumpkinType[] {
  const list = config?.starting_pumpkins
  if (list && list.length > 0) {
    const valid = list.filter((t): t is PumpkinType =>
      (VALID_STARTING_PUMPKINS as string[]).includes(t),
    )
    if (valid.length > 0) return valid
  }
  return ["ferdinand", "ferdinand"]
}

export const ALL_PUMPKIN_TYPES: PumpkinType[] = [
  "ferdinand",
  "chunky",
  "herbert",
  "gwynevere",
  "cramer",
  "silas",
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
  silas: {
    name: "Silas",
    description:
      "Card-exclusive marksman. Fires slow, heavy seeds that pierce through slugs in his lane. Not for sale — you couldn't afford him anyway.",
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

// RandomFn is an injectable RNG so headless balance sims can be seeded.
// Game code defaults to Math.random — behavior is unchanged there.
export type RandomFn = () => number

// Each post-round popup offers: 1 pumpkin card, 1 ability card, 1 random card.
export function buildCardOffer(rng: RandomFn = Math.random): CardDefinition[] {
  const pumpkin: CardDefinition = {
    kind: "pumpkin",
    pumpkinType: ALL_PUMPKIN_TYPES[Math.floor(rng() * ALL_PUMPKIN_TYPES.length)],
  }
  const ability: CardDefinition = {
    kind: "ability",
    abilityId: ALL_ABILITY_IDS[Math.floor(rng() * ALL_ABILITY_IDS.length)],
  }
  const random: CardDefinition =
    rng() < 0.5
      ? {
          kind: "pumpkin",
          pumpkinType: ALL_PUMPKIN_TYPES[Math.floor(rng() * ALL_PUMPKIN_TYPES.length)],
        }
      : {
          kind: "ability",
          abilityId: ALL_ABILITY_IDS[Math.floor(rng() * ALL_ABILITY_IDS.length)],
        }
  return [pumpkin, ability, random].sort(() => rng() - 0.5)
}

export const INVENTORY_CAPACITY = 6
