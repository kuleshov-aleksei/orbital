// CLI entry. Run from this directory:
//   ../../frontend/node_modules/.bin/jiti ./run.cjs -- --games 30 --seed 1 --policy heuristic
// (jiti is already a frontend devDependency — no new installs.)
// The extra `--` separates jiti's own flags from ours.
//
// Useful flags:
//   --config-override '{"starting_coins":40}'   deep-merge patch (or @file.json)
//   --config-dump                               print effective config, then run
//   --check-gates                               exit 1 when legacy caps fail
//   --check-bands                               exit 1 when skill-aware bands fail
//   --json-summary                              print machine-readable summaries (for sweep.ts)
//
// System One decider policy (every decision via localhost:8000):
//   jiti ./run.cjs -- --games 5 --seed 1 --policy systemone --concurrency 5
//   --systemone-url http://localhost:8000/v1/systemone
//   --model jev-latest                          (optional; local decider injects its own)
//   --systemone-timeout 20000                   per-request ms (default 20000)
//   --decision-log decisions.jsonl              append every decider choice
// Any decider failure fails the whole run (no fallback).
import { writeFileSync } from "fs"
import { applyConfigOverride, defaultConfig } from "./config"
import type { HalloweenGameConfig } from "../../frontend/src/halloween/types"
import { runSingleGame, runSingleGameAsync, type GameResult } from "./driver"
import { printSummary, summarize, type BatchSummary } from "./metrics"
import { HeuristicPolicy, type Policy } from "./policies"
import { SystemOnePolicy } from "./policies-systemone"

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback
}

function argOrNull(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null
}

function has(name: string): boolean {
  return process.argv.includes(name)
}

export function main(): void | Promise<void> {
  const games = parseInt(arg("--games", "30"), 10)
  const seed0 = parseInt(arg("--seed", "1"), 10)
  const policyName = arg("--policy", "heuristic")
  const dt = parseFloat(arg("--dt", String(1 / 30)))

  let config = defaultConfig()
  const override = argOrNull("--config-override")
  if (override) {
    try {
      config = applyConfigOverride(config, override)
    } catch (e) {
      console.error(`invalid --config-override: ${(e as Error).message}`)
      process.exit(1)
    }
  }
  if (has("--config-dump")) console.log(JSON.stringify(config, null, 1))

  if (policyName === "systemone") {
    return mainSystemOne(config, games, seed0, dt)
  }

  // One policy: heuristic. The random bot was retired — it contributed
  // nothing but noise and an inflated sense of coverage.
  const makers: Array<() => Policy> = []
  if (policyName === "heuristic") makers.push(() => new HeuristicPolicy())
  else {
    console.error(`unknown policy "${policyName}" (available: heuristic, systemone)`)
    process.exit(1)
  }

  const summaries: BatchSummary[] = []
  let failed = false
  for (const makePolicy of makers) {
    const wall0 = Date.now()
    const results = []
    const policyLabel = makePolicy().name
    for (let i = 0; i < games; i++) {
      results.push(runSingleGame(config, makePolicy(), seed0 + i, { dt }))
      if ((i + 1) % 10 === 0) console.log(`... [${policyLabel}] ${i + 1}/${games} games done`)
    }
    const summary = summarize(results, Date.now() - wall0)
    printSummary(summary)
    summaries.push(summary)
    if (has("--json")) console.log(JSON.stringify(results, null, 1))
    if (has("--check-gates") && !summary.gatesPass) {
      console.error(`BALANCE GATES FAILED [${policyLabel}] (legacy caps, see above)`)
      failed = true
    }
    if (has("--check-bands") && !summary.bandsPass) {
      console.error(
        `BALANCE BANDS FAILED [${policyLabel}] penalty=${summary.bandPenalty.toFixed(4)} (see above)`,
      )
      failed = true
    }
  }
  if (has("--json-summary")) console.log(JSON.stringify(summaries, null, 1))
  if (failed) process.exit(1)
}

async function mainSystemOne(
  config: HalloweenGameConfig,
  games: number,
  seed0: number,
  dt: number,
): Promise<void> {
  const url = arg("--systemone-url", "http://localhost:8000/v1/systemone")
  const model = argOrNull("--model") ?? undefined
  const timeoutMs = parseInt(arg("--systemone-timeout", "20000"), 10)
  const concurrency = Math.min(Math.max(parseInt(arg("--concurrency", "1"), 10), 1), 10)
  const decisionLog = argOrNull("--decision-log")

  const wall0 = Date.now()
  const results: GameResult[] = new Array(games)
  const allDecisions: Array<Record<string, unknown>> = []
  let next = 0

  // Worker pool: sequential by default (--concurrency 1); raise for smoke
  // tests (5-10 max — the remote decider is shared, never 200). Any
  // rejection aborts everything and fails the run.
  const workers = Array.from({ length: Math.min(concurrency, games) }, async () => {
    while (true) {
      const i = next++
      if (i >= games) return
      const policy = new SystemOnePolicy({ url, model, timeoutMs })
      try {
        results[i] = await runSingleGameAsync(config, policy, seed0 + i, { dt })
      } catch (e) {
        ;(e as Error).message =
          `[systemone game seed=${seed0 + i} index=${i}] ${(e as Error).message}`
        throw e
      }
      for (const d of policy.decisions) allDecisions.push({ seed: seed0 + i, ...d })
      console.log(`... [systemone] ${i + 1}/${games} games done (seed=${seed0 + i})`)
    }
  })

  try {
    await Promise.all(workers)
  } catch (e) {
    console.error(`SYSTEMONE RUN FAILED: ${(e as Error).message}`)
    if ((e as Error).cause != null) console.error(String((e as Error).cause))
    const sys = e as { status?: unknown; body?: unknown }
    if (sys.status != null || sys.body != null) {
      console.error(`status=${String(sys.status)} body=${String(sys.body)}`)
    }
    if (decisionLog) {
      const partial = `${decisionLog}.partial`
      writeFileSync(
        partial,
        allDecisions.map((d) => JSON.stringify(d)).join("\n") + "\n",
      )
      console.log(`wrote partial decisions to ${partial} (${allDecisions.length} decisions)`)
    }
    process.exit(1)
  }

  const summary = summarize(results, Date.now() - wall0)
  printSummary(summary)
  if (has("--json")) console.log(JSON.stringify(results, null, 1))
  if (has("--json-summary")) console.log(JSON.stringify([summary], null, 1))
  if (decisionLog) {
    writeFileSync(
      decisionLog,
      allDecisions.map((d) => JSON.stringify(d)).join("\n") + "\n",
    )
    console.log(`wrote ${decisionLog} (${allDecisions.length} decisions)`)
  }
  if (has("--check-gates") && !summary.gatesPass) {
    console.error("BALANCE GATES FAILED [systemone] (legacy caps, see above)")
    process.exit(1)
  }
  if (has("--check-bands") && !summary.bandsPass) {
    console.error(
      `BALANCE BANDS FAILED [systemone] penalty=${summary.bandPenalty.toFixed(4)} (see above)`,
    )
    process.exit(1)
  }
}
