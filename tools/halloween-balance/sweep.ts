// Automated balance sweeper: tries config-override candidates against the
// skill-aware bands (tools/halloween-balance/targets.ts) and ranks them by
// total band penalty (0 = all bands met).
//
// Run from this directory:
//   ../../frontend/node_modules/.bin/jiti ./sweep.cjs -- --games 60 --seed 1
//
// Flags:
//   --games N        games per policy per candidate (default 60; use 150+ to validate)
//   --seed N         base seed (default 1; policies share seeds for fair compare)
//   --preset NAME    early|mid|late|economy|all (default all)
//   --trials N       cap candidates evaluated (default: all in preset)
//   --out PATH       write best candidate {patch, penalty} as JSON
//   --apply-best     (with --out) also write the full patched config JSON
//
// How to use the result:
//   1. Pick the best patch, sanity-check its survival curves below.
//   2. Port the winning numbers into backend/internal/service/halloweenservice.go
//      Config() (source of truth) + tools/halloween-balance/config.ts fixture.
//   3. Run node tools/halloween-balance/check-drift.cjs, then a full validation:
//      jiti ./run.cjs -- --games 200 --seed 1 --policy both --check-bands
import { writeFileSync } from "fs"
import { applyConfigOverride, defaultConfig } from "./config"
import { runSingleGame } from "./driver"
import { summarize } from "./metrics"
import { HeuristicPolicy, RandomPolicy } from "./policies"

type Patch = Record<string, unknown>

interface Candidate {
  name: string
  preset: string
  patch: Patch
}

// Helper: spawn_rounds patch entries for ONLY the given rounds (unedited
// rounds are omitted so mergeRounds can layer edits without clobbering).
function pools(
  base: ReturnType<typeof defaultConfig>,
  edits: Record<number, Partial<Record<string, number>> & { interval?: number }>,
): Patch {
  const rounds = base.spawn_rounds.flatMap((r) => {
    const e = edits[r.round]
    if (!e) return []
    const { interval, ...poolEdit } = e
    return [
      {
        ...r,
        ...(interval != null ? { interval } : {}),
        pool: { ...(r.pool as Record<string, number>), ...poolEdit },
      },
    ]
  })
  return { spawn_rounds: rounds }
}

function candidates(): Candidate[] {
  const base = defaultConfig()
  const out: Candidate[] = []
  const add = (name: string, preset: string, patch: Patch) => out.push({ name, preset, patch })

  // Merge partial pool edits onto the full base list (later pool keys win
  // per round; unedited rounds pass through untouched). All spawn edits go
  // through here: applyConfigOverride replaces arrays wholesale, so a
  // partial spawn_rounds list would drop rounds into legacy fallback.
  const mergeRounds = (...ps: Patch[]): Patch => {
    const edits = new Map<number, { pool: Record<string, number>; interval?: number }>()
    for (const p of ps) {
      for (const r of (p.spawn_rounds ?? []) as Array<{
        round: number
        interval?: number
        pool?: Record<string, number>
      }>) {
        const prev = edits.get(r.round) ?? { pool: {} }
        edits.set(r.round, {
          pool: { ...prev.pool, ...(r.pool ?? {}) },
          interval: r.interval ?? prev.interval,
        })
      }
    }
    return {
      spawn_rounds: base.spawn_rounds.map((r) => {
        const e = edits.get(r.round)
        if (!e) return r
        return {
          ...r,
          ...(e.interval != null ? { interval: e.interval } : {}),
          pool: { ...(r.pool as Record<string, number>), ...e.pool },
        }
      }),
    }
  }

  const earlyEdits = pools(base, {
    1: { scout: 7, marvin: 1 },
    2: { scout: 12, marvin: 4, gerald: 0 },
  })
  const midEdits = pools(base, {
    3: { scout: 20, marvin: 10, gerald: 1, dell: 1, interval: 4 },
    4: { scout: 28, marvin: 12, gerald: 4, dell: 2, interval: 3.5 },
    5: { scout: 30, marvin: 12, gerald: 4, dell: 3, interval: 3.5 },
  })
  const lateEdits = pools(base, {
    6: { scout: 35, marvin: 12, gerald: 4, dell: 3, interval: 3.5 },
    7: { scout: 42, marvin: 14, gerald: 4, dell: 4, interval: 3.5 },
    8: { scout: 48, marvin: 16, gerald: 5, dell: 4, interval: 3 },
    9: { scout: 55, marvin: 18, gerald: 5, dell: 5, interval: 3 },
    10: { scout: 62, marvin: 20, gerald: 6, dell: 5, interval: 3 },
  })
  const steepScaling = {
    spawn_scaling: { interval: 3, scout_per_round: 7, marvin_per_round: 2.5, gerald_sqrt: 1.5, dell_sqrt: 1.5, speed_variation: 0.05 },
  }

  add("baseline", "all", {})

  // --- Early: forgiving R1-R2 (fewer marvins, more starting coins) ---
  add("early+coins40", "early", { starting_coins: 40 })
  add("early-r1-easy", "early", { starting_coins: 30, ...mergeRounds(earlyEdits) })
  add("early-r1-easy-coins40", "early", { starting_coins: 40, ...mergeRounds(earlyEdits) })

  // --- Mid: real pressure on R3-R5 (more bodies, faster trickle) ---
  add("mid-pressure", "mid", { ...mergeRounds(midEdits) })

  // --- Late: steep 6+ curve so skilled builds can't coast ---
  add("late-steep", "late", { ...mergeRounds(lateEdits), ...steepScaling })

  // --- Economy: kill the snowball (income >> spend in baselines) ---
  add("econ-nerf-kill50", "economy", {
    slugs: {
      scout: { speed: 50, health: 10, damage_to_pumpkin: 2, reward_points: 10, kill_reward: 2 },
      marvin: { speed: 50, health: 20, damage_to_pumpkin: 5, reward_points: 20, kill_reward: 5 },
      gerald: { speed: 30, health: 100, damage_to_pumpkin: 20, reward_points: 50, kill_reward: 15 },
      dell: { speed: 0, health: 10, damage_to_pumpkin: 0, reward_points: 100, kill_reward: 25 },
    },
  })
  add("econ-cramer100", "economy", {
    pumpkins: {
      cramer: { fire_rate: 0, health: 10, damage_per_shot: 0, projectile_speed: 0, cost: 100, coin_interval_s: 6, coins_per_tick: 1 },
    },
  })

  // --- Combined: forgiving early + pressuring mid + steep late + leaner economy ---
  add("combined-v1", "all", {
    starting_coins: 40,
    ...mergeRounds(earlyEdits, midEdits, lateEdits),
    ...steepScaling,
    slugs: {
      scout: { speed: 50, health: 10, damage_to_pumpkin: 2, reward_points: 10, kill_reward: 3 },
      marvin: { speed: 50, health: 20, damage_to_pumpkin: 5, reward_points: 20, kill_reward: 6 },
      gerald: { speed: 30, health: 100, damage_to_pumpkin: 20, reward_points: 50, kill_reward: 18 },
      dell: { speed: 0, health: 10, damage_to_pumpkin: 0, reward_points: 100, kill_reward: 30 },
    },
  })

  // --- Combined v2: easy early pools + lean economy (compensate R1 income
  // loss with fewer R1/R2 slugs). Toughness + late curve to follow once the
  // snowball is broken. ---
  const leanSlugs = {
    scout: { speed: 50, health: 10, damage_to_pumpkin: 2, reward_points: 10, kill_reward: 2 },
    marvin: { speed: 50, health: 20, damage_to_pumpkin: 5, reward_points: 20, kill_reward: 5 },
    gerald: { speed: 30, health: 100, damage_to_pumpkin: 20, reward_points: 50, kill_reward: 15 },
    dell: { speed: 0, health: 10, damage_to_pumpkin: 0, reward_points: 100, kill_reward: 25 },
  }
  add("v2-easyearly-econ50", "all", {
    starting_coins: 30,
    ...mergeRounds(earlyEdits),
    slugs: leanSlugs,
  })
  const toughSlugs = {
    scout: { speed: 50, health: 10, damage_to_pumpkin: 2, reward_points: 10, kill_reward: 2 },
    marvin: { speed: 55, health: 30, damage_to_pumpkin: 6, reward_points: 20, kill_reward: 5 },
    gerald: { speed: 32, health: 130, damage_to_pumpkin: 22, reward_points: 50, kill_reward: 15 },
    dell: { speed: 0, health: 10, damage_to_pumpkin: 0, reward_points: 100, kill_reward: 25 },
  }
  add("v3-v2-toughmid", "all", {
    starting_coins: 30,
    ...mergeRounds(earlyEdits, midEdits),
    slugs: toughSlugs,
  })
  add("v4-v3-steeplate", "all", {
    starting_coins: 30,
    ...mergeRounds(earlyEdits, midEdits, lateEdits),
    ...steepScaling,
    slugs: toughSlugs,
  })

  // --- v5/v6: one-time early boost (starting coins don't snowball) + very
  // lean kill income + line-breaking geralds. Early pools stay easy so R1 is
  // forgiving; mid/late toughness provides the attrition.
  const starveSlugs = {
    scout: { speed: 50, health: 10, damage_to_pumpkin: 2, reward_points: 10, kill_reward: 2 },
    marvin: { speed: 55, health: 30, damage_to_pumpkin: 6, reward_points: 20, kill_reward: 4 },
    gerald: { speed: 32, health: 130, damage_to_pumpkin: 30, reward_points: 50, kill_reward: 12 },
    dell: { speed: 0, health: 10, damage_to_pumpkin: 0, reward_points: 100, kill_reward: 20 },
  }
  const brutalSlugs = {
    scout: { speed: 50, health: 10, damage_to_pumpkin: 3, reward_points: 10, kill_reward: 2 },
    marvin: { speed: 55, health: 35, damage_to_pumpkin: 7, reward_points: 20, kill_reward: 4 },
    gerald: { speed: 32, health: 150, damage_to_pumpkin: 30, reward_points: 50, kill_reward: 12 },
    dell: { speed: 0, health: 10, damage_to_pumpkin: 0, reward_points: 100, kill_reward: 20 },
  }
  add("v5-starve-brutal", "all", {
    starting_coins: 50,
    ...mergeRounds(earlyEdits, midEdits, lateEdits),
    ...steepScaling,
    slugs: starveSlugs,
  })
  add("v6-starve-brutal-plus", "all", {
    starting_coins: 50,
    ...mergeRounds(earlyEdits, midEdits, lateEdits),
    ...steepScaling,
    slugs: brutalSlugs,
  })

  return out
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback
}

function argOrNull(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null
}

export function main(): void {
  const games = parseInt(arg("--games", "60"), 10)
  const seed0 = parseInt(arg("--seed", "1"), 10)
  const preset = arg("--preset", "all")
  const trialsCap = parseInt(arg("--trials", String(Number.MAX_SAFE_INTEGER)), 10)
  const outPath = argOrNull("--out")

  let cands = candidates()
  if (preset !== "all") cands = cands.filter((c) => c.preset === preset || c.preset === "all")
  cands = cands.slice(0, trialsCap)
  if (cands.length === 0) {
    console.error(`no candidates for preset "${preset}"`)
    process.exit(1)
  }

  const base = defaultConfig()
  const rows: Array<{
    name: string
    heurPenalty: number
    randPenalty: number
    total: number
    heurP: Record<number, number>
    randP: Record<number, number>
  }> = []

  for (const c of cands) {
    const config = applyConfigOverride(base, JSON.stringify(c.patch))
    const wall0 = Date.now()
    const heur = []
    const rand = []
    for (let i = 0; i < games; i++) {
      heur.push(runSingleGame(config, new HeuristicPolicy(), seed0 + i))
      rand.push(runSingleGame(config, new RandomPolicy(), seed0 + i))
    }
    const hs = summarize(heur, Date.now() - wall0)
    const rs = summarize(rand, 0)
    // Snowball surcharge: infinite builds must rank badly even if bands shift.
    const surcharge = (hs.reachProb[12] ?? 0) * 2 + (rs.reachProb[12] ?? 0) * 2
    const total = hs.bandPenalty + rs.bandPenalty + surcharge * surcharge
    rows.push({
      name: c.name,
      heurPenalty: hs.bandPenalty,
      randPenalty: rs.bandPenalty,
      total,
      heurP: hs.reachProb,
      randP: rs.reachProb,
    })
    const fmt = (p: Record<number, number>, rounds: number[]) =>
      rounds.map((r) => `R${r}=${((p[r] ?? 0) * 100).toFixed(0)}%`).join(" ")
    console.log(
      `candidate=${c.name} total=${total.toFixed(4)} (heur=${hs.bandPenalty.toFixed(4)} rand=${rs.bandPenalty.toFixed(4)})`,
    )
    console.log(`  heur: ${fmt(hs.reachProb, [1, 2, 3, 4, 5, 6, 12])}`)
    console.log(`  rand: ${fmt(rs.reachProb, [1, 2, 3, 6, 12])}`)
  }

  rows.sort((a, b) => a.total - b.total)
  console.log("\n=== ranking (lower penalty is better) ===")
  rows.forEach((r, i) => {
    console.log(
      `${i + 1}. ${r.name} total=${r.total.toFixed(4)} (heur=${r.heurPenalty.toFixed(4)} rand=${r.randPenalty.toFixed(4)})`,
    )
  })

  const best = rows[0]
  const bestPatch = cands.find((c) => c.name === best.name)!.patch
  console.log(`\nbest: ${best.name} — apply with --config-override '${JSON.stringify(bestPatch)}'`)
  if (outPath) {
    writeFileSync(outPath, JSON.stringify({ name: best.name, patch: bestPatch, penalty: best.total }, null, 1))
    console.log(`wrote ${outPath}`)
  }
}
