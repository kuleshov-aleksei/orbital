// CLI entry. Run from this directory:
//   ../../frontend/node_modules/.bin/jiti ./run.cjs -- --games 30 --seed 1 --policy random
// (jiti is already a frontend devDependency — no new installs.)
// The extra `--` separates jiti's own flags from ours.
//
// Useful flags:
//   --config-override '{"starting_coins":40}'   deep-merge patch (or @file.json)
//   --config-dump                               print effective config, then run
//   --policy both                               run heuristic + random (for band checks)
//   --check-gates                               exit 1 when legacy caps fail
//   --check-bands                               exit 1 when skill-aware bands fail
//   --json-summary                              print machine-readable summaries (for sweep.ts)
import { applyConfigOverride, defaultConfig } from "./config"
import { runSingleGame } from "./driver"
import { printSummary, summarize, type BatchSummary } from "./metrics"
import { HeuristicPolicy, RandomPolicy, type Policy } from "./policies"

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

export function main(): void {
  const games = parseInt(arg("--games", "30"), 10)
  const seed0 = parseInt(arg("--seed", "1"), 10)
  const policyName = arg("--policy", "random")
  const dt = parseFloat(arg("--dt", String(1 / 30)))

  const makers: Array<() => Policy> = []
  if (policyName === "random") makers.push(() => new RandomPolicy())
  else if (policyName === "heuristic") makers.push(() => new HeuristicPolicy())
  else if (policyName === "both") makers.push(() => new HeuristicPolicy(), () => new RandomPolicy())
  else {
    console.error(`unknown policy "${policyName}" (available: random, heuristic, both)`)
    process.exit(1)
  }

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
