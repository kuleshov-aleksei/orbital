// Balance gates: heuristic-only survival targets agreed with the user.
// P(complete >= r) = fraction of games with completedRounds >= r.
export interface Gate {
  round: number
  minProb: number
}

export const DEFAULT_GATES: Gate[] = [
  { round: 1, minProb: 0.95 },
  { round: 2, minProb: 0.7 },
  { round: 3, minProb: 0.4 },
  { round: 4, minProb: 0.25 },
  { round: 5, minProb: 0.1 },
  { round: 6, minProb: 0.01 },
]

export interface GateResult {
  round: number
  minProb: number
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
    return { round: g.round, minProb: g.minProb, actual, pass: actual + 1e-9 >= g.minProb }
  })
}

export function formatGateReport(results: GateResult[]): string {
  return results
    .map(
      (r) =>
        `${r.pass ? "PASS" : "FAIL"} R${r.round}: P(>=${r.round})=${(r.actual * 100).toFixed(1)}% (need >=${(r.minProb * 100).toFixed(0)}%)`,
    )
    .join("\n")
}

export function gatesPass(results: GateResult[]): boolean {
  return results.every((r) => r.pass)
}
