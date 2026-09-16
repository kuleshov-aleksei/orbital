// Default balance fixture. Mirrors the server-authoritative values in
// backend/internal/service/halloweenservice.go Config() so sims run against
// the same numbers as the live game. Tweak via --config-override JSON later;
// for now this file is the single source for sim runs.
import type { HalloweenGameConfig } from "../../frontend/src/halloween/types"

export function defaultConfig(): HalloweenGameConfig {
  return {
    enabled: true,
    starts_at: "2026-10-17",
    battlefield_length: 1000,
    starting_coins: 20,
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
      scout: { speed: 50, health: 10, damage_to_pumpkin: 2, reward_points: 10, kill_reward: 5 },
      marvin: { speed: 50, health: 20, damage_to_pumpkin: 5, reward_points: 20, kill_reward: 10 },
      gerald: { speed: 30, health: 100, damage_to_pumpkin: 20, reward_points: 50, kill_reward: 30 },
      dell: { speed: 0, health: 10, damage_to_pumpkin: 0, reward_points: 100, kill_reward: 50 },
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
  }
}
