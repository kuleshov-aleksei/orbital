// Balance bands: skill-aware survival targets agreed with the user.
// Calibrated 2026-09-28 from a 200-game heuristic run (seed sweep):
//   P(>=1)=100% >=2=100% >=3=89% >=4=70% >=5=61% >=6=53% >=7=40% >=8=26%
//   >=9=7% >=10=1% >=11=0%. Bands below are those observations with
//   ~±8pp margin for sampling noise — the current balance IS the target.
//   Early game near-certain, long decaying tail to R10, R12 ~0 (no snowball).
//
// P(complete >= r) = fraction of games with completedRounds >= r.
// Each band is [minProb, maxProb] for the heuristic ("reasonable player",
// skill ceiling proxy). The random bot was deleted — it kept passing away
// from natural causes and taught us nothing.
export interface Band {
  round: number
  policy: "heuristic"
  minProb: number
  maxProb: number
}

export const DEFAULT_BANDS: Band[] = [
  // Calibrated to the 200-game reference run (see header) ± noise margin.
  { round: 1, policy: "heuristic", minProb: 0.95, maxProb: 1.0 },
  { round: 2, policy: "heuristic", minProb: 0.95, maxProb: 1.0 },
  { round: 3, policy: "heuristic", minProb: 0.8, maxProb: 0.95 },
  { round: 4, policy: "heuristic", minProb: 0.6, maxProb: 0.8 },
  { round: 5, policy: "heuristic", minProb: 0.5, maxProb: 0.7 },
  { round: 6, policy: "heuristic", minProb: 0.4, maxProb: 0.6 },
  { round: 7, policy: "heuristic", minProb: 0.3, maxProb: 0.5 },
  { round: 8, policy: "heuristic", minProb: 0.15, maxProb: 0.35 },
  { round: 12, policy: "heuristic", minProb: 0.0, maxProb: 0.05 },
]

export interface BandResult {
  round: number
  policy: string
  minProb: number
  maxProb: number
  actual: number
  pass: boolean
  /** Distance outside the band (0 when inside). Used as tuner objective. */
  miss: number
}

export function checkBands(
  reachProb: Record<number, number>,
  policy: string,
  bands: Band[] = DEFAULT_BANDS,
): BandResult[] {
  return bands
    .filter((b) => b.policy === policy)
    .map((b) => {
      const actual = reachProb[b.round] ?? 0
      const miss =
        actual < b.minProb ? b.minProb - actual : actual > b.maxProb ? actual - b.maxProb : 0
      return {
        round: b.round,
        policy: b.policy,
        minProb: b.minProb,
        maxProb: b.maxProb,
        actual,
        pass: miss <= 1e-9,
        miss,
      }
    })
}

/** Sum of squared misses — the tuner objective (0 = all bands met). */
export function bandPenalty(results: BandResult[]): number {
  return results.reduce((a, r) => a + r.miss * r.miss, 0)
}

export function formatBandReport(results: BandResult[]): string {
  return results
    .map(
      (r) =>
        `${r.pass ? "PASS" : "FAIL"} [${r.policy}] R${r.round}: P(>=${r.round})=${(r.actual * 100).toFixed(1)}% (need ${(r.minProb * 100).toFixed(0)}-${(r.maxProb * 100).toFixed(0)}%)`,
    )
    .join("\n")
}

export function bandsPass(results: BandResult[]): boolean {
  return results.every((r) => r.pass)
}

// --- Legacy upper-bound gates (kept for --check-gates back-compat) ---
// P(complete >= r) must be <= maxProb. Caps sit just above the band maxima
// so a snowballing build that survives endlessly still FAILs, while the
// calibrated balance passes. (R1/R2 survival is legitimately certain, so
// those caps are vacuous by design.)
export interface Gate {
  round: number
  maxProb: number
}

export const DEFAULT_GATES: Gate[] = [
  { round: 1, maxProb: 1.0 },
  { round: 2, maxProb: 1.0 },
  { round: 3, maxProb: 0.95 },
  { round: 4, maxProb: 0.8 },
  { round: 5, maxProb: 0.7 },
  { round: 6, maxProb: 0.6 },
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
