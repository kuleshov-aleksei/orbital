// Aggregation + ASCII report for a batch of sim results.
import type { GameResult } from "./driver"

export interface BatchSummary {
  games: number
  policy: string
  roundsMean: number
  roundsStd: number
  roundsMin: number
  roundsMax: number
  roundsHist: Record<number, number>
  reachProb: Record<number, number> // P(completedRounds >= r)
  scoreMean: number
  scoreStd: number
  scoreMax: number
  killsMean: number
  coinsEarnedMean: number
  coinsSpentMean: number
  killsByTypeMean: Record<string, number>
  wallMs: number
  simSecondsTotal: number
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length
}

function std(xs: number[], m: number): number {
  if (xs.length === 0) return 0
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length)
}

export function summarize(results: GameResult[], wallMs: number): BatchSummary {
  const rounds = results.map((r) => r.completedRounds)
  const scores = results.map((r) => r.score)
  const rm = mean(rounds)
  const sm = mean(scores)
  const hist: Record<number, number> = {}
  for (const r of rounds) hist[r] = (hist[r] ?? 0) + 1
  const maxR = Math.max(0, ...rounds)
  const reachProb: Record<number, number> = {}
  for (let r = 1; r <= maxR + 1; r++) {
    reachProb[r] = results.filter((x) => x.completedRounds >= r).length / results.length
  }
  const killsByTypeMean: Record<string, number> = {}
  for (const res of results) {
    for (const [k, v] of Object.entries(res.killsByType)) {
      killsByTypeMean[k] = (killsByTypeMean[k] ?? 0) + v / results.length
    }
  }
  return {
    games: results.length,
    policy: results[0]?.policy ?? "?",
    roundsMean: rm,
    roundsStd: std(rounds, rm),
    roundsMin: Math.min(...rounds),
    roundsMax: maxR,
    roundsHist: hist,
    reachProb,
    scoreMean: sm,
    scoreStd: std(scores, sm),
    scoreMax: Math.max(...scores),
    killsMean: mean(results.map((r) => r.kills)),
    coinsEarnedMean: mean(results.map((r) => r.coinsEarned)),
    coinsSpentMean: mean(results.map((r) => r.coinsSpent)),
    killsByTypeMean,
    wallMs,
    simSecondsTotal: results.reduce((a, r) => a + r.simSeconds, 0),
  }
}

export function printSummary(s: BatchSummary): void {
  const f1 = (n: number) => n.toFixed(1)
  console.log(`\n=== policy=${s.policy} games=${s.games} ===`)
  console.log(
    `completedRounds: mean ${f1(s.roundsMean)} ± ${f1(s.roundsStd)}  min ${s.roundsMin}  max ${s.roundsMax}`,
  )
  const hist = Object.keys(s.roundsHist)
    .map(Number)
    .sort((a, b) => a - b)
    .map((r) => {
      const c = s.roundsHist[r]
      return `${r}:${c} ${"#".repeat(Math.round((c / s.games) * 30))}`
    })
    .join("\n  ")
  console.log(`  hist(rounds):\n  ${hist}`)
  const reach = Object.keys(s.reachProb)
    .map(Number)
    .sort((a, b) => a - b)
    .map((r) => `P(>=${r})=${(s.reachProb[r] * 100).toFixed(0)}%`)
    .join("  ")
  console.log(`  survival: ${reach}`)
  console.log(
    `score: mean ${Math.round(s.scoreMean)} ± ${Math.round(s.scoreStd)}  max ${s.scoreMax}`,
  )
  console.log(
    `kills/game: ${f1(s.killsMean)}  by type: ${Object.entries(s.killsByTypeMean)
      .map(([k, v]) => `${k}=${f1(v)}`)
      .join(" ")}`,
  )
  console.log(
    `coins/game: earned ${f1(s.coinsEarnedMean)}  spent ${f1(s.coinsSpentMean)}`,
  )
  const speedup = s.simSecondsTotal / Math.max(s.wallMs / 1000, 1e-3)
  console.log(
    `perf: ${(s.wallMs / 1000).toFixed(1)}s wall for ${Math.round(s.simSecondsTotal)} sim-seconds (${Math.round(speedup)}x realtime)`,
  )
}
