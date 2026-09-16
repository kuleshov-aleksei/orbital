// Headless game driver: fixed-timestep loop, no renderer, no sounds.
// One tick = dt sim-seconds; the engine clamps dt to 0.25 internally.
import { HalloweenGameEngine } from "../../frontend/src/halloween/game/engine"
import type { HalloweenGameConfig } from "../../frontend/src/halloween/types"
import { mulberry32 } from "./rng"
import type { Policy } from "./policies"

export interface DriverOptions {
  dt?: number // sim-seconds per tick (default 1/30)
  maxSimSeconds?: number // safety cap per game (default 45 min)
}

export interface GameResult {
  seed: number
  policy: string
  completedRounds: number
  score: number
  ticks: number
  simSeconds: number
  kills: number
  killsByType: Record<string, number>
  spawnedPumpkins: Record<string, number>
  usedItems: Record<string, number>
  coinsEarned: number
  coinsSpent: number
  endPhase: string
  gameOverReason: string | null
}

export function runSingleGame(
  config: HalloweenGameConfig,
  policy: Policy,
  seed: number,
  opts: DriverOptions = {},
): GameResult {
  const dt = opts.dt ?? 1 / 30
  const maxSimSeconds = opts.maxSimSeconds ?? 45 * 60
  const rng = mulberry32(seed)
  const engine = new HalloweenGameEngine(config, rng)

  let ticks = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = engine.snapshot()
    if (snap.phase === "gameover" || snap.phase === "ended") break
    if (ticks * dt >= maxSimSeconds) break

    if (snap.phase === "cards" && snap.cards) {
      // Sequential popups, like the UI: one pick per tick.
      const pumpkins = engine.pumpkins.filter((p) => p.health > 0)
      engine.pickCard(
        policy.pickCard(snap.cards.cards, rng, {
          cramerCount: pumpkins.filter((p) => p.type === "cramer").length,
          damagedAny: pumpkins.some((p) => p.health < p.maxHealth),
        }),
      )
    } else if (snap.phase === "playing") {
      policy.onTick(engine, config, rng)
    }
    engine.update(dt)
    ticks++
  }

  const report = engine.buildReport(false)
  const final = engine.snapshot()
  const killsByType: Record<string, number> = {}
  for (const k of report.kills) killsByType[k.type] = (killsByType[k.type] ?? 0) + 1

  return {
    seed,
    policy: policy.name,
    completedRounds: report.completed_rounds,
    score: report.score,
    ticks,
    simSeconds: ticks * dt,
    kills: report.kills.length,
    killsByType,
    spawnedPumpkins: report.spawned_pumpkins,
    usedItems: report.used_items,
    coinsEarned: report.coins_earned,
    coinsSpent: report.coins_spent,
    endPhase: final.phase,
    gameOverReason: final.gameOverReason,
  }
}
