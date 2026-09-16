// Default balance fixture. Mirrors the server-authoritative values in
// backend/internal/service/halloweenservice.go Config() so sims run against
// the same numbers as the live game. Tweak via --config-override JSON;
// check-drift.cjs guards against fixture/backend skew.
import { readFileSync } from "fs"
import type { HalloweenGameConfig } from "../../frontend/src/halloween/types"

// Deep-merge a partial override into a full config. Arrays (spawn_rounds,
// proximity, reward_brackets) replace wholesale when present; plain objects
// (pumpkins, slugs, spawn_scaling, ...) merge by key so sweeps can tweak a
// single knob, e.g. --config-override '{"spawn_rounds":[...]}' or
// '{"starting_coins":40}'. Accepts a JSON string or a '@path/to/file.json'.
export function applyConfigOverride(
  base: HalloweenGameConfig,
  overrideJson: string,
): HalloweenGameConfig {
  const raw = overrideJson.startsWith("@")
    ? readFileSync(overrideJson.slice(1), "utf8")
    : overrideJson
  const patch = JSON.parse(raw) as Record<string, unknown>
  return deepMerge(base as unknown as Record<string, unknown>, patch) as unknown as HalloweenGameConfig
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (isPlainObject(v) && isPlainObject(base[k])) out[k] = deepMerge(base[k], v)
    else out[k] = v
  }
  return out
}
export function defaultConfig(): HalloweenGameConfig {
  return {
    enabled: true,
    starts_at: "2026-10-17",
    battlefield_length: 1000,
    starting_coins: 20,
    starting_pumpkins: ["ferdinand", "ferdinand"],
    pumpkins: {
      ferdinand: {
        fire_rate: 1,
        health: 10,
        damage_per_shot: 5,
        projectile_speed: 100,
        cost: 20,
        coin_interval_s: 0,
        coins_per_tick: 0,
      },
      chunky: {
        fire_rate: 0,
        health: 50,
        damage_per_shot: 0,
        projectile_speed: 0,
        cost: 40,
        coin_interval_s: 0,
        coins_per_tick: 0,
      },
      herbert: {
        fire_rate: 0.5,
        health: 10,
        damage_per_shot: 5,
        projectile_speed: 150,
        cost: 40,
        coin_interval_s: 0,
        coins_per_tick: 0,
      },
      gwynevere: {
        fire_rate: 0.1,
        health: 5,
        damage_per_shot: 10,
        projectile_speed: 40,
        cost: 70,
        coin_interval_s: 0,
        coins_per_tick: 0,
      },
      cramer: {
        fire_rate: 0,
        health: 10,
        damage_per_shot: 0,
        projectile_speed: 0,
        cost: 75,
        coin_interval_s: 5,
        coins_per_tick: 1,
      },
    },
    slugs: {
      scout: { speed: 50, health: 10, damage_to_pumpkin: 2, reward_points: 10, kill_reward: 2 },
      marvin: { speed: 50, health: 20, damage_to_pumpkin: 5, reward_points: 20, kill_reward: 5 },
      gerald: { speed: 30, health: 100, damage_to_pumpkin: 20, reward_points: 50, kill_reward: 15 },
      dell: { speed: 0, health: 10, damage_to_pumpkin: 0, reward_points: 100, kill_reward: 25 },
    },
    abilities: {
      annihilation: { score: 70, kind: "multiplier" },
      holy_grenade: { score: 80, kind: "multiplier" },
      beer: { score: 0, kind: "flat" },
      salt_line: { score: 0, kind: "flat" },
    },
    proximity: [
      { min_x: 700, factor: 1.0 },
      { min_x: 500, factor: 0.7 },
      { min_x: 300, factor: 0.5 },
      { min_x: 0, factor: 0.35 },
    ],
    round_bonus: 1000,
    reward_brackets: [
      { min_score: 8000, tier: "rare" },
      { min_score: 5000, tier: "uncommon" },
      { min_score: 2000, tier: "common" },
      { min_score: 1000, tier: "regular" },
    ],
    rewards_per_round: { 1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4 },
    spawn_rounds: [
      { round: 1, interval: 7, pool: { scout: 10, marvin: 2, gerald: 0, dell: 0 }, speed_variation: 0.01 },
      { round: 2, interval: 7, pool: { scout: 16, marvin: 8, gerald: 1, dell: 0 }, speed_variation: 0.02 },
      { round: 3, interval: 5, pool: { scout: 16, marvin: 8, gerald: 0, dell: 1 }, speed_variation: 0.04 },
      { round: 4, interval: 4, pool: { scout: 24, marvin: 8, gerald: 3, dell: 2 }, speed_variation: 0.04 },
      { round: 5, interval: 4, pool: { scout: 25, marvin: 8, gerald: 3, dell: 3 }, speed_variation: 0.04 },
      { round: 6, interval: 4, pool: { scout: 30, marvin: 9, gerald: 3, dell: 3 }, speed_variation: 0.04 },
      { round: 7, interval: 4, pool: { scout: 35, marvin: 11, gerald: 3, dell: 3 }, speed_variation: 0.04 },
      { round: 8, interval: 4, pool: { scout: 40, marvin: 12, gerald: 3, dell: 3 }, speed_variation: 0.04 },
      { round: 9, interval: 4, pool: { scout: 45, marvin: 14, gerald: 3, dell: 3 }, speed_variation: 0.04 },
      { round: 10, interval: 4, pool: { scout: 50, marvin: 15, gerald: 4, dell: 4 }, speed_variation: 0.04 },
    ],
    spawn_scaling: {
      interval: 4,
      scout_per_round: 5,
      marvin_per_round: 1.5,
      gerald_sqrt: 1,
      dell_sqrt: 1,
      speed_variation: 0.04,
    },
  }
}
