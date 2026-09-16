// CLI entry. Run from this directory:
//   ../../frontend/node_modules/.bin/jiti ./run.cjs -- --games 30 --seed 1 --policy random
// (jiti is already a frontend devDependency — no new installs.)
// The extra `--` separates jiti's own flags from ours.
//
// Useful flags:
//   --config-override '{"starting_coins":40}'   deep-merge patch (or @file.json)
//   --config-dump                               print effective config, then run
//   --check-gates                               exit 1 when heuristic gates fail
import { applyConfigOverride, defaultConfig } from "./config"
import { runSingleGame } from "./driver"
import { printSummary, summarize } from "./metrics"
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

  let makePolicy: () => Policy
  if (policyName === "random") makePolicy = () => new RandomPolicy()
  else if (policyName === "heuristic") makePolicy = () => new HeuristicPolicy()
  else {
    console.error(`unknown policy "${policyName}" (available: random, heuristic)`)
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

  const wall0 = Date.now()
  const results = []
  for (let i = 0; i < games; i++) {
    results.push(runSingleGame(config, makePolicy(), seed0 + i, { dt }))
    if ((i + 1) % 10 === 0) console.log(`... ${i + 1}/${games} games done`)
  }
  const summary = summarize(results, Date.now() - wall0)
  printSummary(summary)
  if (has("--json")) console.log(JSON.stringify(results, null, 1))
  if (has("--check-gates") && !summary.gatesPass) {
    console.error("BALANCE GATES FAILED (heuristic targets, see above)")
    process.exit(1)
  }
}
