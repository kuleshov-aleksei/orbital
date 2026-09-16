// Balance gates: heuristic-only survival caps agreed with the user.
// P(complete >= r) = fraction of games with completedRounds >= r.
// Gates are upper bounds: actual survival must be <= maxProb.
// A snowballing build that survives endlessly must FAIL early gates
// (e.g. R1 survival > 95% fails), forcing difficulty up, not down.
export interface Gate {
  round: number
  maxProb: number
}

export const DEFAULT_GATES: Gate[] = [
  { round: 1, maxProb: 0.95 },
  { round: 2, maxProb: 0.7 },
  { round: 3, maxProb: 0.4 },
  { round: 4, maxProb: 0.25 },
  { round: 5, maxProb: 0.1 },
  { round: 6, maxProb: 0.01 },
]

export interface GateResult {
  round: number
  maxProb: number
  actual: number
  pass: boolean
}

export function checkGates(
  reachProb: Record<number, number>,
  games: number,
  gates: Gate[] = DEFAULT_GATES,
): GateResult[] {
  return gates.map((g) => {
    const actual = games > 0 ? (reachProb[g.round] ?? 0) : 0
    return { round: g.round, maxProb: g.maxProb, actual, pass: actual <= g.maxProb + 1e-9 }
  })
}

export function formatGateReport(results: GateResult[]): string {
  return results
    .map(
      (r) =>
        `${r.pass ? "PASS" : "FAIL"} R${r.round}: P(>=${r.round})=${(r.actual * 100).toFixed(1)}% (need <=${(r.maxProb * 100).toFixed(0)}%)`,
    )
    .join("\n")
}

export function gatesPass(results: GateResult[]): boolean {
  return results.every((r) => r.pass)
}
