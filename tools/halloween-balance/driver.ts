// Headless game driver: fixed-timestep loop, no renderer, no sounds.
// One tick = dt sim-seconds; the engine clamps dt to 0.25 internally.
import { HalloweenGameEngine } from "../../frontend/src/halloween/game/engine"
import type { HalloweenGameConfig, HalloweenGameReport } from "../../frontend/src/halloween/types"
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
  reachedRound: number // highest snap.round observed (death round when game over)
  deathRound: number | null // reachedRound when endPhase === "gameover", else null
  score: number
  ticks: number
  simSeconds: number
  kills: number
  killsByType: Record<string, number>
  spawnedPumpkins: Record<string, number>
  usedItems: Record<string, number>
  coinsEarned: number
  coinsSpent: number
  xpEarned: number // lifetime XP pool (report.xp_earned)
  xpRemaining: number // unspent XP at game end
  levelUps: number // level-up purchases bought (counted live, incl. pumpkins that later died)
  pumpkinsByLevel: Record<number, number> // live field split, e.g. {1: n, 2: n, 3: n}
  report: HalloweenGameReport // raw engine report — the backend submission payload
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
  // Count level-up purchases live: reconstructing from the end-of-game
  // field would miss pumpkins that later died and undercount lost games.
  let levelUps = 0
  const baseLevelUp = engine.levelUpPumpkin.bind(engine)
  engine.levelUpPumpkin = (id: number): boolean => {
    const ok = baseLevelUp(id)
    if (ok) levelUps++
    return ok
  }

  let ticks = 0
  let reachedRound = 1
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = engine.snapshot()
    if (snap.phase === "gameover" || snap.phase === "ended") break
    if (ticks * dt >= maxSimSeconds) break
    if (snap.round > reachedRound) reachedRound = snap.round

    if (snap.phase === "cards" && snap.cards) {
      // Sequential popups, like the UI: one pick per tick.
      const pumpkins = engine.pumpkins.filter((p) => p.health > 0)
      const owned = (t: string): number =>
        snap.inventory.filter((i) => i.kind === "pumpkin" && i.pumpkinType === t).length
      const pick = policy.pickCard(snap.cards.cards, rng, {
        cramerCount: pumpkins.filter((p) => p.type === "cramer").length,
        damagedAny: pumpkins.some((p) => p.health < p.maxHealth),
        round: snap.round,
        inventoryFull: snap.inventory.length >= 6,
        herbertCount: pumpkins.filter((p) => p.type === "herbert").length + owned("herbert"),
        gwynevereCount: pumpkins.filter((p) => p.type === "gwynevere").length + owned("gwynevere"),
        answerCount: snap.inventory.filter(
          (i) =>
            i.kind === "ability" &&
            (i.abilityId === "annihilation" ||
              i.abilityId === "holy_grenade" ||
              i.abilityId === "freeze"),
        ).length,
        fieldCount: pumpkins.length,
      })
      if (pick instanceof Promise) {
        throw new Error(
          `policy "${policy.name}" is async — use runSingleGameAsync instead of runSingleGame`,
        )
      }
      engine.pickCard(pick)
    } else if (snap.phase === "playing") {
      const r = policy.onTick(engine, config, rng)
      if (r instanceof Promise) {
        throw new Error(
          `policy "${policy.name}" is async — use runSingleGameAsync instead of runSingleGame`,
        )
      }
    }
    engine.update(dt)
    ticks++
  }

  return finishGame(engine, seed, policy.name, ticks, dt, levelUps, reachedRound)
}

/** Async variant for decider policies (e.g. systemone) that await remote
 * calls inside onTick/pickCard. Otherwise identical to runSingleGame. */
export async function runSingleGameAsync(
  config: HalloweenGameConfig,
  policy: Policy,
  seed: number,
  opts: DriverOptions = {},
): Promise<GameResult> {
  const dt = opts.dt ?? 1 / 30
  const maxSimSeconds = opts.maxSimSeconds ?? 45 * 60
  const rng = mulberry32(seed)
  const engine = new HalloweenGameEngine(config, rng)
  let levelUps = 0
  const baseLevelUp = engine.levelUpPumpkin.bind(engine)
  engine.levelUpPumpkin = (id: number): boolean => {
    const ok = baseLevelUp(id)
    if (ok) levelUps++
    return ok
  }

  let ticks = 0
  let reachedRound = 1
  // Live progress: decider games can run 20+ minutes wall-clock, so log
  // round transitions plus a heartbeat every 60 sim-seconds (unbuffered).
  const t0 = Date.now()
  const callsOf = (): string => {
    const d = (policy as { decisions?: unknown[] }).decisions
    return d ? String(d.length) : "-"
  }
  const beat = (tag: string): void => {
    const s = engine.snapshot()
    const alive = engine.pumpkins.filter((p) => p.health > 0).length
    const wall = ((Date.now() - t0) / 1000).toFixed(0)
    process.stdout.write(
      `[live] ${tag} R${s.round}/${s.phase} t=${(ticks * dt).toFixed(0)}s wall=${wall}s ` +
        `field=${alive} inv=${s.inventory.length} coins=${s.coins} xp=${s.xp} calls=${callsOf()}\n`,
    )
  }
  let lastBeat = 0
  // Stall breaker: if neither side scores a kill for 120 sim-seconds the
  // game is a degenerate standoff (seen: 4 pumpkins vs unkillable R3 slugs
  // for 240+s while the policy burned ~500 no-op calls). Break and report.
  let lastKillCount = -1
  let lastKillTick = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = engine.snapshot()
    if (snap.phase === "gameover" || snap.phase === "ended") break
    if (ticks * dt >= maxSimSeconds) break
    const killCount = (engine as unknown as { kills?: unknown[] }).kills?.length ?? -1
    if (killCount !== lastKillCount) {
      lastKillCount = killCount
      lastKillTick = ticks
    } else if ((ticks - lastKillTick) * dt >= 120 && killCount >= 0) {
      beat("STALL — no kills for 120s, breaking")
      break
    }
    if (snap.round > reachedRound) {
      reachedRound = snap.round
      beat("round-start")
    }
    if (ticks * dt - lastBeat >= 60) {
      lastBeat = ticks * dt
      beat("beat")
    }

    if (snap.phase === "cards" && snap.cards) {
      const pumpkins = engine.pumpkins.filter((p) => p.health > 0)
      const owned = (t: string): number =>
        snap.inventory.filter((i) => i.kind === "pumpkin" && i.pumpkinType === t).length
      engine.pickCard(
        await policy.pickCard(snap.cards.cards, rng, {
          cramerCount: pumpkins.filter((p) => p.type === "cramer").length,
          damagedAny: pumpkins.some((p) => p.health < p.maxHealth),
          round: snap.round,
          inventoryFull: snap.inventory.length >= 6,
          herbertCount: pumpkins.filter((p) => p.type === "herbert").length + owned("herbert"),
          gwynevereCount: pumpkins.filter((p) => p.type === "gwynevere").length + owned("gwynevere"),
          answerCount: snap.inventory.filter(
            (i) =>
              i.kind === "ability" &&
              (i.abilityId === "annihilation" ||
                i.abilityId === "holy_grenade" ||
                i.abilityId === "freeze"),
          ).length,
          fieldCount: pumpkins.length,
        }),
      )
    } else if (snap.phase === "playing") {
      await policy.onTick(engine, config, rng)
    }
    engine.update(dt)
    ticks++
  }

  return finishGame(engine, seed, policy.name, ticks, dt, levelUps, reachedRound)
}

function finishGame(
  engine: HalloweenGameEngine,
  seed: number,
  policyName: string,
  ticks: number,
  dt: number,
  levelUps: number,
  reachedRound: number,
): GameResult {
  const report = engine.buildReport(false)
  const final = engine.snapshot()
  const killsByType: Record<string, number> = {}
  for (const k of report.kills) killsByType[k.type] = (killsByType[k.type] ?? 0) + 1
  const pumpkinsByLevel: Record<number, number> = {}
  for (const p of engine.pumpkins) {
    if (p.health <= 0) continue
    pumpkinsByLevel[p.level] = (pumpkinsByLevel[p.level] ?? 0) + 1
  }

  return {
    seed,
    policy: policyName,
    completedRounds: report.completed_rounds,
    reachedRound,
    deathRound: final.phase === "gameover" ? reachedRound : null,
    score: report.score,
    ticks,
    simSeconds: ticks * dt,
    kills: report.kills.length,
    killsByType,
    spawnedPumpkins: report.spawned_pumpkins,
    usedItems: report.used_items,
    coinsEarned: report.coins_earned,
    coinsSpent: report.coins_spent,
    xpEarned: report.xp_earned,
    xpRemaining: final.xp,
    levelUps,
    pumpkinsByLevel,
    report,
    endPhase: final.phase,
    gameOverReason: final.gameOverReason,
  }
}
