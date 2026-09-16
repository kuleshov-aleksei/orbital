// CLI entry. Run from this directory:
//   ../../frontend/node_modules/.bin/jiti ./run.cjs -- --games 30 --seed 1 --policy random
// (jiti is already a frontend devDependency — no new installs.)
// The extra `--` separates jiti's own flags from ours.
import { defaultConfig } from "./config"
import { runSingleGame } from "./driver"
import { printSummary, summarize } from "./metrics"
import { HeuristicPolicy, RandomPolicy, type Policy } from "./policies"

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback
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

  const config = defaultConfig()
  const wall0 = Date.now()
  const results = []
  for (let i = 0; i < games; i++) {
    results.push(runSingleGame(config, makePolicy(), seed0 + i, { dt }))
    if ((i + 1) % 10 === 0) console.log(`... ${i + 1}/${games} games done`)
  }
  const summary = summarize(results, Date.now() - wall0)
  printSummary(summary)
  if (has("--json")) console.log(JSON.stringify(results, null, 1))
}
