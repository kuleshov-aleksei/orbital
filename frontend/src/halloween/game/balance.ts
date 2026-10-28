import type { AbilityId, PumpkinType, SlugType } from "./types"
import type { HalloweenGameConfig, HalloweenPumpkinLevelConfig } from "../types"

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

export function abilityDamageMultiplierForRound(
  round: number,
  config?: Pick<HalloweenGameConfig, "ability_damage_growth">,
): number {
  const growth = config?.ability_damage_growth ?? 1
  return Math.pow(growth, Math.max(0, round - 1))
}

const VALID_STARTING_PUMPKINS: PumpkinType[] = [
  "ferdinand",
  "chunky",
  "herbert",
  "gwynevere",
  "cramer",
  // No pearcer. Draft-only means draft-only. Read the card.
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
  pearcer: {
    name: "PEARcer",
    description:
      "Card-exclusive pear-skinned marksman. Fires slow, heavy seeds that pierce through slugs in his lane. Not for sale — you couldn't afford him anyway.",
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
  "tailwind",
  "seed_rain",
  "thorn_patch",
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
    description: "All slugs stop moving for 8 seconds.",
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
    description:
      "Drop a grenade that detonates in 3s, dealing 50 base damage in a 300-unit radius. Damage scales with the round.",
    target: "point",
  },
  beer: {
    name: "Beer puddle",
    description:
      "A sticky puddle that drags slugs toward the cup and slows them by 40%. Slugs that reach the center get stuck for 2 seconds. Lasts 60 seconds.",
    target: "point",
  },
  salt_line: {
    name: "Salt line",
    description:
      "A vertical line of salt that slows slugs by 30% while they step on it. Lasts 60 seconds.",
    target: "point",
  },
  tailwind: {
    name: "Tailwind",
    description: "All pumpkins shoot 50% faster for 10 seconds.",
    target: "none",
  },
  seed_rain: {
    name: "Seed rain",
    description: "Instantly gain 100 coins.",
    target: "none",
  },
  thorn_patch: {
    name: "Thorn patch",
    description:
      "A patch of thorns that damages slugs crossing it for 40 seconds. Damage scales with the round.",
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

// Post-round popups offer CARDS_PER_OFFER random cards — pick 1, as before.
// Usually an ability, rarely the card-exclusive PEARcer. All other pumpkins
// are shop-only.
export const CARDS_PER_OFFER = 3
export const PEARCER_CARD_PROB = 0.15
export function buildCardOffer(rng: RandomFn = Math.random): CardDefinition[] {
  const cards: CardDefinition[] = []
  for (let i = 0; i < CARDS_PER_OFFER; i++) {
    cards.push(
      rng() < PEARCER_CARD_PROB
        ? { kind: "pumpkin", pumpkinType: "pearcer" }
        : {
            kind: "ability",
            abilityId: ALL_ABILITY_IDS[Math.floor(rng() * ALL_ABILITY_IDS.length)],
          },
    )
  }
  return cards
}

export const INVENTORY_CAPACITY = 6

// Pumkin level-up tuning (HALLOWEEN.md "Pumkin level up mechanic").
// A level 2 pumkin is never as powerful as 2 pumkins at level 1 —
// levels buy board-space efficiency, not raw power.
export const MAX_PUMPKIN_LEVEL = 3
export const FALLBACK_LEVEL_COSTS = [40, 80]

// levelCostsFor prefers the server config, same fallback chain as spawns.
export function levelCostsFor(config?: Pick<HalloweenGameConfig, "level_costs">): number[] {
  const costs = config?.level_costs
  if (costs && costs.length >= MAX_PUMPKIN_LEVEL - 1) return costs
  return FALLBACK_LEVEL_COSTS
}

// levelUpCost returns the XP price of leveling a pumpkin from `level`
// (1-based) to the next one, or null when already maxed.
export function levelUpCost(
  level: number,
  config?: Pick<HalloweenGameConfig, "level_costs">,
): number | null {
  if (level < 1 || level >= MAX_PUMPKIN_LEVEL) return null
  return levelCostsFor(config)[level - 1] ?? null
}

// levelStatsFor returns the balance row for a pumpkin type at a 1-based
// level. Prefers the server `levels` table; falls back to the top-level
// (level 1) fields when absent so cached payloads keep working.
export function levelStatsFor(
  type: PumpkinType,
  level: number,
  config?: Pick<HalloweenGameConfig, "pumpkins">,
): HalloweenPumpkinLevelConfig | null {
  const cfg = config?.pumpkins[type]
  if (!cfg) return null
  const clamped = Math.max(1, Math.min(MAX_PUMPKIN_LEVEL, level))
  const row = cfg.levels?.[clamped - 1]
  if (row) return row
  return {
    health: cfg.health,
    fire_rate: cfg.fire_rate,
    damage_per_shot: cfg.damage_per_shot,
    projectile_speed: cfg.projectile_speed,
    coin_interval_s: cfg.coin_interval_s,
    coins_per_tick: cfg.coins_per_tick,
    blast_radius: 0,
  }
}
