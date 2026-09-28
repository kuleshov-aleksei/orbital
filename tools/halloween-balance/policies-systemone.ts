// System One decider policy: every gameplay decision is made by the
// remote System One API (localhost:8000/v1/systemone). Fully independent —
// no imports from ./policies.ts, no heuristic fallback. Any decider failure
// throws and fails the whole run.
import {
  LANE_COUNT,
  PLACEMENT_COLUMNS,
  columnForX,
  columnX,
  laneCenterY,
  laneForY,
  type HalloweenGameEngine,
} from "../../frontend/src/halloween/game/engine"
import { ABILITY_META } from "../../frontend/src/halloween/game/balance"
import type { CardDefinition } from "../../frontend/src/halloween/game/balance"
import type { AbilityId, PumpkinType } from "../../frontend/src/halloween/game/types"
import type { HalloweenGameConfig } from "../../frontend/src/halloween/types"
import {
  askChoice,
  buildSystemOneState,
  fieldDps,
  pumpkinDps,
  type ChoiceQuestion,
  type SystemOneClientOptions,
} from "./systemone"
import type { CardContext, Policy } from "./policies"
import type { Rng } from "./rng"

export interface DecisionRecord {
  phase: string
  question: string
  choice: string
  /** Card offer that the choice was made from (pickCard only) — cheap
   * diagnostics for skipped pearcer-class misses. */
  offer?: string[]
  /** Full decider request (state + question). Only populated when the
   * `recordDetails` policy option is on (dev visualizer) — never in
   * headless runs, to keep decision logs small. */
  request?: { state: unknown; question: ChoiceQuestion }
  /** The decider's reported uncertainty for this answer (same gating). */
  confidence?: number
  probabilities?: Record<string, number>
}

export interface SystemOnePolicyOptions extends SystemOneClientOptions {
  /** Act once per N sim ticks (default 15, ~2x per sim-second). */
  actEveryNTicks?: number
  /** Attach the full request payload to every DecisionRecord. */
  recordDetails?: boolean
}

function parseId(pattern: RegExp, choice: string): number {
  const m = choice.match(pattern)
  if (!m) throw new Error(`cannot parse id from choice "${choice}"`)
  return parseInt(m[1], 10)
}

/** Free (col, lane) cells from live pumpkins + currently active lanes. */
function freeCells(engine: HalloweenGameEngine): Array<{ col: number; lane: number }> {
  const taken = new Set<string>()
  for (const p of engine.pumpkins) {
    if (p.health <= 0) continue
    taken.add(`${columnForX(p.x)}:${laneForY(p.y)}`)
  }
  const lanes = new Set(engine.activeLanes())
  const out: Array<{ col: number; lane: number }> = []
  for (let col = 0; col < PLACEMENT_COLUMNS; col++) {
    for (let lane = 0; lane < LANE_COUNT; lane++) {
      if (!lanes.has(lane)) continue
      if (!taken.has(`${col}:${lane}`)) out.push({ col, lane })
    }
  }
  return out
}

/** Point-ability aim candidates derived from live slug clusters. */
function pointCandidates(
  engine: HalloweenGameEngine,
): Array<{ key: string; x: number; y: number; label: string }> {
  const live = engine.slugs.filter((s) => s.health > 0)
  const byLane = new Map<number, typeof live>()
  for (const s of live) {
    const arr = byLane.get(s.lane) ?? []
    arr.push(s)
    byLane.set(s.lane, arr)
  }
  return [...byLane.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 8)
    .map(([lane, slugs]) => {
      const xs = slugs.map((s) => s.x).sort((a, b) => a - b)
      const x = Math.round(xs[Math.floor(xs.length / 2)])
      return {
        key: `point_l${lane}_x${x}`,
        x,
        y: laneCenterY(lane),
        label: `Lane ${lane} at x=${x}: ${slugs.length} slug(s), nearest x=${Math.round(Math.min(...xs))}` +
          (slugs.some((s) => s.shields > 0) ? ", shielded present" : ""),
      }
    })
}

export class SystemOnePolicy implements Policy {
  readonly name = "systemone"
  readonly decisions: DecisionRecord[] = []
  private readonly opts: SystemOneClientOptions
  private readonly actEvery: number
  private readonly recordDetails: boolean
  private tick = 0
  /** Last tick an abilityId was asked about (spam guard for held answers). */
  private readonly lastAsked = new Map<AbilityId, number>()
  /** Alive-field signature seen at the last buff-ability ask. */
  private readonly buffSig = new Map<AbilityId, string>()
  /** Ticks between repeat asks for combat abilities (~10 decision windows). */
  private static readonly ASK_COOLDOWN_TICKS = 150
  /** Tick of the last `place_which` hold answer (spam guard). */
  private placeHoldTick = -Infinity
  /** Ticks to wait before re-asking place_which after a hold answer
   * (~4 decision windows, ~2 sim-seconds: cuts decider spam while staying
   * reactive to leaks). */
  private static readonly PLACE_HOLD_COOLDOWN_TICKS = 60
  /** Tick of the last `buy_decision` hold answer (spam guard). A buy hold
   * means "saving coins" — re-asking every window while coins sit idle
   * burned ~500 calls in one stalled round with zero effect. */
  private buyHoldTick = -Infinity
  private static readonly BUY_HOLD_COOLDOWN_TICKS = 60
  /** Consecutive `place_which` holds. Pocketed pumpkins deal zero DPS —
   * after 3 straight holds the decider is paralyzed (seen: 24 holds while
   * R5 collapsed), so the 4th window force-places the first pocket body
   * through the normal coverage path instead of asking again. */
  private consecutiveWhichHolds = 0
  private static readonly WHICH_HOLD_LIMIT = 3

  constructor(opts: SystemOnePolicyOptions) {
    const { actEveryNTicks, recordDetails, ...client } = opts
    this.opts = client
    this.actEvery = actEveryNTicks ?? 15
    this.recordDetails = recordDetails ?? false
  }

  private async decide(
    engine: HalloweenGameEngine,
    config: HalloweenGameConfig,
    questionId: string,
    instructions: string,
    criteria: Record<string, string | null>,
  ): Promise<string> {
    const state = buildSystemOneState(engine, config)
    const question: ChoiceQuestion = {
      type: "choice",
      instructions,
      criteria,
    }
    const { choice, confidence, probabilities } = await askChoice(
      this.opts,
      state,
      questionId,
      question,
    )
    this.decisions.push({
      phase: `R${engine.snapshot().round}/${engine.snapshot().phase}`,
      question: questionId,
      choice,
      ...(this.recordDetails ? { request: { state, question }, confidence, probabilities } : {}),
    })
    return choice
  }

  private playing(engine: HalloweenGameEngine): boolean {
    return engine.snapshot().phase === "playing"
  }

  /** Target selection where the candidate set can shrink to one. A single
   * candidate is not a decision — apply it directly without a decider call
   * (the API also rejects single-option choice questions). */
  private async decideTarget(
    engine: HalloweenGameEngine,
    config: HalloweenGameConfig,
    questionId: string,
    instructions: string,
    criteria: Record<string, string | null>,
  ): Promise<string> {
    const keys = Object.keys(criteria)
    if (keys.length === 1) {
      this.decisions.push({
        phase: `R${engine.snapshot().round}/${engine.snapshot().phase}`,
        question: `${questionId} (auto: sole candidate)`,
        choice: keys[0],
      })
      return keys[0]
    }
    return this.decide(engine, config, questionId, instructions, criteria)
  }

  async onTick(engine: HalloweenGameEngine, config: HalloweenGameConfig): Promise<void> {
    this.tick++
    if (this.tick % this.actEvery !== 0) return
    // Sequential decider loop — as many calls as needed. Each call sees a
    // freshly built state, so earlier actions in this same tick are visible.
    // (Selling is disabled in this harness — every placed pumpkin fights
    // until it dies, so there is no sell phase.)
    await this.buyPhase(engine, config)
    if (!this.playing(engine)) return
    await this.placePhase(engine, config)
    if (!this.playing(engine)) return
    await this.levelPhase(engine, config)
    if (!this.playing(engine)) return
    await this.abilityPhase(engine, config)
  }

  private async buyPhase(
    engine: HalloweenGameEngine,
    config: HalloweenGameConfig,
  ): Promise<void> {
    const buyable = (Object.keys(config.pumpkins) as PumpkinType[]).filter(
      (t) => !config.pumpkins[t]?.draft_only,
    )
    for (let i = 0; i < 8; i++) {
      if (!this.playing(engine)) return
      const snap = engine.snapshot()
      if (snap.inventory.length >= 6) return
      // Economy timing is mechanical, not judgment: from round 4 the first
      // affordable cramer is bought outright (proven heuristic rule — the
      // mint funds round-5 mass). No decider call.
      const ownsCramer =
        engine.pumpkins.some((p) => p.health > 0 && p.type === "cramer") ||
        snap.inventory.some((it) => it.kind === "pumpkin" && it.pumpkinType === "cramer")
      if (
        snap.round >= 4 &&
        !ownsCramer &&
        buyable.includes("cramer") &&
        snap.coins >= engine.costFor("cramer")
      ) {
        if (!engine.buyPumpkin("cramer")) return
        this.decisions.push({
          phase: `R${snap.round}/${snap.phase}`,
          question: "buy_decision (auto: economy)",
          choice: `buy_cramer_${engine.costFor("cramer")}`,
        })
        continue
      }
      // Coverage-first buying: an undefended lane with an empty pocket and
      // affordable coins means a body NOW — holding there stalls coverage
      // (seen: 165 idle coins, empty lane 0, a dell walking in untouched).
      // Drop the hold option so the decider picks WHAT, not WHETHER.
      const pocketEmpty =
        !snap.inventory.some((it) => it.kind === "pumpkin")
      const lanesCovered = (() => {
        const defended = new Set<string>()
        for (const p of engine.pumpkins) {
          if (p.health > 0) defended.add(String(laneForY(p.y)))
        }
        return engine.activeLanes().every((l) => defended.has(String(l)))
      })()
      const mustBuy = pocketEmpty && !lanesCovered
      const criteria: Record<string, string | null> = {}
      if (!mustBuy) criteria.hold = "Buy nothing. Save coins for later."
      for (const t of buyable) {
        const price = engine.costFor(t)
        if (snap.coins < price) continue
        // Tactical blurb per type — the decider buys what it understands.
        // Doctrine mirrors the proven heuristic: DPS bodies first, artillery
        // only behind a front line, tanks from round 3, economy from round 4.
        const aliveCount =
          engine.pumpkins.filter((p) => p.health > 0 && p.type === t).length +
          snap.inventory.filter((it) => it.kind === "pumpkin" && it.pumpkinType === t).length
        let blurb = `Buy ${t} for ${price} coins (base ${config.pumpkins[t]?.cost}, you own ${aliveCount}).`
        if (t === "ferdinand") {
          blurb += " Cheap DPS body — the default buy in rounds 1-3."
        } else if (t === "gwynevere") {
          blurb +=
            aliveCount >= 2
              ? " AoE artillery — but you already own 2, more is luxury."
              : " AoE artillery (5 HP!): only behind a LIVE front line in its lane, else a donation to slugs."
        } else if (t === "chunky") {
          blurb +=
            snap.round >= 3
              ? " Tank wall (50+ HP, no attack): parks frontline-right and HOLDS a lane while DPS burns — essential from round 3, keep 2+."
              : " Tank wall (50+ HP, no attack): rounds 1-2 are won with DPS bodies, tanks can wait."
        } else if (t === "cramer") {
          blurb +=
            snap.round >= 4
              ? " Economy: mints coins once the mid-game is survivable."
              : " Economy: rounds 1-3 are won with bodies, not interest — wait."
        } else if (t === "herbert") {
          // Data-driven nudge: exactly one healer is enough while it lives
          // (herberts cannot heal themselves or each other).
          const haveHealer =
            engine.pumpkins.some((p) => p.health > 0 && p.type === "herbert") ||
            snap.inventory.some((it) => it.kind === "pumpkin" && it.pumpkinType === "herbert")
          blurb += haveHealer
            ? " Healer — but you already own one, and a second can't heal the first, so it's wasted coins."
            : " Healer (5 HP/shot to most-damaged ally, any lane): worth it once 3+ fighters bleed."
        }
        criteria[`buy_${t}_${price}`] = blurb
      }
      if (Object.keys(criteria).length <= (mustBuy ? 0 : 1)) return // nothing affordable — no query
      if (
        !mustBuy &&
        this.tick - this.buyHoldTick < SystemOnePolicy.BUY_HOLD_COOLDOWN_TICKS
      ) {
        return // recent hold — coins accrue per kill, save a call
      }
      const choice = await this.decideTarget(
        engine,
        config,
        "buy_decision",
        mustBuy
          ? `Lane coverage is BROKEN (an active lane has no defender) and the pocket is empty — you MUST buy a body now; coins in the pocket kill nothing. ` +
            `Which pumpkin should be bought into the inventory (max 6 slots, ${snap.inventory.length} used)? ` +
            `Cheap ferdinand first unless a tank (chunky) or artillery (gwynevere) fits the gap.`
          : `You have ${snap.coins} coins. Which pumpkin should be bought into the inventory (max 6 slots, ${snap.inventory.length} used), if any? ` +
            `Bodies win rounds 1-3: ferdinand first, gwynevere only on top of 4+ ferdinands and behind a live front line (max 2). ` +
            `From round 3 keep 2+ chunky tanks — they hold lanes DPS alone can't. Cramer from round 4. ` +
            `Exactly one herbert while one lives. `,
        criteria,
      )
      if (choice === "hold") {
        this.buyHoldTick = this.tick
        return
      }
      const m = choice.match(/^buy_([a-z]+)_\d+$/)
      if (!m) throw new Error(`cannot parse type from choice "${choice}"`)
      if (!engine.buyPumpkin(m[1] as PumpkinType)) return // engine rejected — resync next tick
    }
  }

  private async placePhase(
    engine: HalloweenGameEngine,
    config: HalloweenGameConfig,
  ): Promise<void> {
    for (let i = 0; i < 12; i++) {
      if (!this.playing(engine)) return
      const snap = engine.snapshot()
      const held = snap.inventory
        .map((item, index) => ({ item, index }))
        .filter((e) => e.item.kind === "pumpkin")
      if (held.length === 0) return
      const free = freeCells(engine)
      if (free.length === 0) return
      // Indecision breaker: 3 straight which-holds means the decider is
      // paralyzed while pocketed bodies sit at zero DPS — force-place the
      // first pocket body through the normal lane/cell path, bypassing the
      // hold throttle and the which question.
      const breaker =
        this.consecutiveWhichHolds >= SystemOnePolicy.WHICH_HOLD_LIMIT
      if (!breaker && this.tick - this.placeHoldTick < SystemOnePolicy.PLACE_HOLD_COOLDOWN_TICKS) {
        return // recent hold — the answer can't change this fast, save a call
      }
      // Round-1 lookahead: only lanes 1-3 are active now, but next round
      // opens 2 more lanes (0 and 4) — the decider should keep reserves.
      const roundNote =
        snap.round <= 1
          ? " Note: this is round 1, which uses only lanes 1-3 — next round opens 2 more lanes (0 and 4), so keep some coins and pumpkins in reserve to defend them."
          : ""
      // The hold justification is only true in round 1. From round 2 all
      // lanes are open, so holding must be argued on coverage instead.
      const laneHold =
        snap.round <= 1
          ? "Hold this pumpkin in the inventory — saving defenders for lanes 0 and 4 opening in round 2."
          : "Hold only if every lane already has a defender. An undefended lane with slugs inside needs a pumpkin now — holding there loses the lane."

      const whichCriteria: Record<string, string | null> = {
        hold: "Place nothing. Keep pumpkins in the inventory.",
      }
      for (const { item, index } of held) {
        if (item.kind !== "pumpkin") continue
        whichCriteria[`place_inv${index}_${item.pumpkinType}`] =
          `Place inventory slot ${index} (${item.pumpkinType}).`
      }
      // All held pumpkins share one type — which slot is irrelevant, so
      // skip the question and save a decider call.
      const heldTypes = new Set(
        held.map(({ item }) => (item.kind === "pumpkin" ? item.pumpkinType : "?")),
      )
      let invIndex: number
      if (breaker) {
        invIndex = held[0].index
        this.decisions.push({
          phase: `R${snap.round}/${snap.phase}`,
          question: "place_which (auto: indecision-breaker)",
          choice: `place_inv${invIndex}_${held[0].item.kind === "pumpkin" ? held[0].item.pumpkinType : "?"}`,
        })
      } else if (heldTypes.size === 1) {
        invIndex = held[0].index
        this.decisions.push({
          phase: `R${snap.round}/${snap.phase}`,
          question: "place_which (auto: identical type)",
          choice: `place_inv${invIndex}_${[...heldTypes][0]}`,
        })
      } else {
        const which = await this.decide(
          engine,
          config,
          "place_which",
          "Which pumpkin from the inventory should be placed onto the battlefield, if any? " +
            "Tanks belong on the right (high columns, close to incoming slugs); DPS and economy belong on the left (low columns). " +
            "Herbert and cramer are fragile support — keep them in safe left columns; herbert heals every lane from anywhere. " +
            "Every lane with slugs needs a defender." +
            roundNote,
          whichCriteria,
        )
        if (which === "hold") {
          this.placeHoldTick = this.tick
          this.consecutiveWhichHolds++
          return
        }
        invIndex = parseId(/^place_inv(\d+)_/, which)
      }

      // Stage 1: pick the lane (≤5 options + hold). One option per lane
      // replaces the old ~30-cell guess — a choice this small the decider
      // can actually make. Undefended lanes sort first.
      const laneStats = engine
        .activeLanes()
        .filter((lane) => free.some((c) => c.lane === lane))
        .map((lane) => {
          const defenders = engine.pumpkins.filter(
            (p) => p.health > 0 && laneForY(p.y) === lane,
          )
          const laneSlugs = engine.slugs.filter((s) => s.health > 0 && s.lane === lane)
          const nearestX =
            laneSlugs.length > 0 ? Math.round(Math.min(...laneSlugs.map((s) => s.x))) : null
          const dps =
            Math.round(
              defenders.reduce((a, p) => a + pumpkinDps(p), 0) * 10,
            ) / 10
          const hpTotal = defenders.reduce((a, p) => a + Math.round(p.health), 0)
          const frontCol =
            defenders.length > 0 ? Math.max(...defenders.map((p) => columnForX(p.x))) : null
          // Fragile garrison: little HP with the front sitting close to the
          // slug spawn — one hit from collapse despite having a defender.
          const exposed = defenders.length > 0 && hpTotal < 20 && (frontCol ?? 0) >= 3
          return { lane, defenders: defenders.length, slugs: laneSlugs.length, nearestX, dps, hpTotal, frontCol, exposed }
        })
        .sort(
          (a, b) =>
            Number(a.defenders > 0) - Number(b.defenders > 0) || a.dps - b.dps,
        )
      const heldEntry = held.find((h) => h.index === invIndex)
      const heldType =
        heldEntry && heldEntry.item.kind === "pumpkin" ? heldEntry.item.pumpkinType : "pumpkin"
      // Coverage-first: while lanes stand UNDEFENDED, covering them is
      // mechanical, not a judgment call — offer ONLY those lanes (no hold,
      // no doubling). A sole uncovered lane auto-applies with zero decider
      // calls. Doubling and holding unlock once every lane has a defender.
      const uncovered = laneStats.filter((s) => s.defenders === 0)
      const laneCriteria: Record<string, string | null> = {}
      if (uncovered.length === 0) laneCriteria.hold = laneHold
      for (const s of uncovered.length > 0 ? uncovered : laneStats) {
        laneCriteria[`place_lane_${s.lane}`] =
          `Lane ${s.lane}: ${s.defenders} defender(s)` +
          (s.defenders === 0 ? " — UNDEFENDED" : "") +
          `, ${s.hpTotal} total HP` +
          (s.exposed ? `, front at col ${s.frontCol} — EXPOSED` : "") +
          `, ${s.slugs} slug(s)` +
          (s.defenders === 0 && s.nearestX != null ? ` already inside (nearest x=${s.nearestX})!` : "") +
          `, ${s.dps} DPS.`
      }
      // Quiet board: no slugs anywhere, so the next wave can come down any
      // lane — countermand the reinforce-the-strongest-lane guess.
      const quietBoard = engine.slugs.every((s) => s.health <= 0)
      const quietNote = quietBoard
        ? " No slugs are on the field — the next wave can come down any lane, so balance coverage toward the fewest defenders / lowest total HP instead of reinforcing the strongest lane."
        : ""
      const laneChoice = await this.decideTarget(
        engine,
        config,
        "place_lane",
        uncovered.length > 0
          ? `Lane(s) ${uncovered.map((s) => s.lane).join(", ")} have NO defender — slugs there walk through untouched. ` +
            `Which uncovered lane should inventory slot ${invIndex} (${heldType}) cover first? ` +
            `Prefer the lane with slugs already inside it.` +
            roundNote
          : `Every lane has a defender. Which lane should inventory slot ${invIndex} (${heldType}) reinforce — the weakest defended lane (lowest DPS vs slugs)? ` +
            `You may also hold the pumpkin instead of placing it.` +
            quietNote +
            roundNote,
        laneCriteria,
      )
      if (laneChoice === "hold") {
        this.placeHoldTick = this.tick // same spam guard as place_which holds
        this.consecutiveWhichHolds = 0 // deliberate lane call — reset paralysis count
        return
      }
      const lane = parseId(/^place_lane_(\d+)$/, laneChoice)

      // Stage 2: pick the cell within that lane (≤6 cells + hold).
      // Stage 2: pick the cell within that lane. Cells only — the hold
      // decision lives at lane level (stage 1), so a chosen lane always
      // gets its pumpkin.
      const laneFree = free.filter((c) => c.lane === lane)
      if (laneFree.length === 0) return // filled since stage 1 — resync next tick
      const laneStat = laneStats.find((s) => s.lane === lane)
      const cols = laneFree.map((c) => c.col)
      const leftmost = Math.min(...cols)
      const rightmost = Math.max(...cols)
      // Tactical annotation per cell: the model under-weights the bare
      // column numbers, so spell out what each end means. DPS dies forward.
      const whereCriteria: Record<string, string | null> = {}
      for (const c of laneFree) {
        const laneSlugs = engine.slugs.filter((s) => s.health > 0 && s.lane === c.lane).length
        const tag =
          c.col === leftmost && c.col === rightmost
            ? " (only free cell)"
            : c.col === leftmost
              ? " (SAFE-LEFT: longest firing time, last to take contact)"
              : c.col === rightmost
                ? " (FRONTLINE-RIGHT: first contact with slugs)"
                : ""
        whereCriteria[`cell_c${c.col}_l${c.lane}`] =
          `Column ${c.col}, lane ${c.lane}${tag} (${laneSlugs} slug(s) in this lane).`
      }
      // Hard column rule per type — ported from the proven heuristic: DPS
      // and support live left, tanks live right. No judgment call needed.
      const columnRule =
        heldType === "chunky"
          ? ` ${heldType} is a no-attack tank: pick the HIGHEST free column (frontline) to shield the lane.`
          : ` ${heldType} ${heldType === "cramer" ? "is economy that must survive" : heldType === "herbert" ? "is a healer that must survive" : heldType === "gwynevere" ? "has 5 HP and dies to contact" : "dies fast in contact"}: pick the LOWEST free column (safe-left).`
      const laneUrgent =
        laneStat && laneStat.defenders === 0 && laneStat.nearestX != null
          ? ` A slug is already inside this undefended lane (nearest x=${laneStat.nearestX}) — it reaches the backline unopposed, so favor a safe left column that shoots the longest.`
          : ""
      const where = await this.decideTarget(
        engine,
        config,
        "place_where",
        `In which column of lane ${lane} should inventory slot ${invIndex} (${heldType}) be placed? Column 0 is leftmost (safest, longest firing time), column 5 is rightmost (closest to slugs).` +
          columnRule +
          laneUrgent +
          roundNote,
        whereCriteria,
      )
      const cm = where.match(/^cell_c(\d+)_l(\d+)$/)
      if (!cm) throw new Error(`cannot parse cell from choice "${where}"`)
      engine.selectInventoryItem(invIndex)
      if (engine.mode !== "place-pumpkin") return // stale slot — resync next tick
      engine.onWorldClick(columnX(parseInt(cm[1], 10)), laneCenterY(parseInt(cm[2], 10)))
      if (engine.mode !== "none") return // placement rejected (occupied) — resync next tick
      this.consecutiveWhichHolds = 0 // a body hit the field — pocket is flowing again
    }
  }

  private async levelPhase(
    engine: HalloweenGameEngine,
    config: HalloweenGameConfig,
  ): Promise<void> {
    // Level-ups are automatic, not a decider question: XP buys permanent
    // stats at fixed costs, so there is no reason to hoard — spend greedily
    // the moment a level is affordable. Asking the decider here only produced
    // fatal holds (XP stranded while the field died). Priority mirrors the
    // proven heuristic order: pearcer -> ferdinand -> herbert -> cramer ->
    // chunky -> gwynevere; lowest level first, weakest first.
    void config
    const order = ["pearcer", "ferdinand", "herbert", "cramer", "chunky", "gwynevere"]
    for (let i = 0; i < 12; i++) {
      if (!this.playing(engine)) return
      const xp = engine.snapshot().xp
      const candidates = engine.pumpkins.filter(
        (p) => p.health > 0 && engine.levelUpCostFor(p) != null,
      )
      if (candidates.length === 0) return
      candidates.sort(
        (a, b) =>
          order.indexOf(a.type) - order.indexOf(b.type) ||
          a.level - b.level ||
          a.health / a.maxHealth - b.health / b.maxHealth,
      )
      const target = candidates[0]
      const cost = engine.levelUpCostFor(target)
      if (cost == null || xp < cost) return
      if (!engine.levelUpPumpkin(target.id)) return
      this.decisions.push({
        phase: `R${engine.snapshot().round}/${engine.snapshot().phase}`,
        question: "levelup_decision (auto: greedy)",
        choice: `lvl_${target.id}_${target.type}_L${target.level}`,
      })
    }
  }

  /** Ability asks are gated on combat triggers — the decider still makes
   * every use/hold and targeting call, but is only consulted when something
   * happened that could change the answer. Returns false when there is no
   * real decision right now (no query is sent). */
  private abilityTrigger(engine: HalloweenGameEngine, abilityId: AbilityId): boolean {
    // Seed rain converts pocket lint to coins — answerable with an empty
    // field, unlike every combat ability below.
    if (abilityId === "seed_rain") return engine.snapshot().coins < 20
    const slugs = engine.slugs.filter((s) => s.health > 0)
    if (slugs.length === 0) return false
    const leak = slugs.some((s) => s.x < 450)
    const boss = slugs.some((s) => s.type === "gerald" || s.type === "dell")
    switch (abilityId) {
      case "annihilation": {
        // Single-target delete: worth considering vs bosses, shielded
        // heavies, or big mid-game crowds.
        const round = engine.snapshot().round
        return boss || (round >= 3 && (slugs.some((s) => s.shields > 0) || slugs.length > 10))
      }
      case "freeze":
      case "distraction":
      case "tailwind":
        // Crowd control: leaks and pre-contact crowds, not single scouts.
        // Tailwind rides the same trigger — global haste wants max bodies firing.
        return (leak && slugs.length > 4) || slugs.length > 8
      case "holy_grenade":
        return slugs.length >= 4
      case "beer":
      case "salt_line":
      case "thorn_patch":
        return slugs.length >= 3
      case "do_not_stop_daddy":
      case "wide_pumpkin": {
        // Permanent buffs: re-ask only when the candidate set changed
        // (placements, deaths, level-ups) — the answer can't change else.
        // (Signature is compared at ask time in abilityPhase.)
        return this.buffSigOf(engine) !== ""
      }
    }
  }

  private buffSigOf(engine: HalloweenGameEngine): string {
    return engine.pumpkins
      .filter((p) => p.health > 0)
      .map((p) => `${p.id}:${p.type}:L${p.level}`)
      .sort()
      .join("|")
  }

  private async abilityPhase(
    engine: HalloweenGameEngine,
    config: HalloweenGameConfig,
  ): Promise<void> {
    for (let i = 0; i < 6; i++) {
      if (!this.playing(engine)) return
      const snap = engine.snapshot()
      const held = snap.inventory.find((it) => it.kind === "ability")
      if (!held || held.kind !== "ability") return // no ability held — no query
      const abilityId = held.abilityId as AbilityId
      if (!this.abilityTrigger(engine, abilityId)) return // no trigger — no query
      if (
        (abilityId === "do_not_stop_daddy" || abilityId === "wide_pumpkin") &&
        this.buffSig.get(abilityId) === this.buffSigOf(engine)
      ) {
        return // same candidates as last ask — answer can't change
      }
      const sinceAsk = this.tick - (this.lastAsked.get(abilityId) ?? -Infinity)
      if (sinceAsk < SystemOnePolicy.ASK_COOLDOWN_TICKS) return
      this.lastAsked.set(abilityId, this.tick)
      this.buffSig.set(abilityId, this.buffSigOf(engine))
      const meta = ABILITY_META[abilityId]

      // The old neutral "now or later?" question conserved 30 straight
      // holds while R5 collapsed — the model needs the trigger facts and
      // the cost of waiting spelled out. Heuristic uses at these same
      // triggers unconditionally; the question should recommend USE.
      const liveSlugs = engine.slugs.filter((s) => s.health > 0)
      const boss = liveSlugs.find((s) => s.type === "gerald" || s.type === "dell")
      const inside = liveSlugs.filter((s) => s.x < 450).length
      const fieldN = engine.pumpkins.filter((p) => p.health > 0).length
      const dps = fieldDps(engine)
      let triggerFact: string
      switch (abilityId) {
        case "annihilation":
          triggerFact = boss
            ? `a ${boss.type} with ${Math.round(boss.health)} HP is marching down lane ${boss.lane} (x=${Math.round(boss.x)}) — field DPS is ${dps}, it will NOT burn down before contact`
            : `${liveSlugs.length} slugs on field, ${liveSlugs.filter((s) => s.shields > 0).length} shielded — volleys are being eaten`
          break
        case "freeze":
        case "distraction":
        case "tailwind":
          triggerFact =
            `${liveSlugs.length} slugs on field` +
            (inside > 0 ? `, ${inside} already past x=450 (INSIDE)` : "") +
            ` vs ${fieldN} bodies — contact is happening now`
          break
        case "holy_grenade":
        case "beer":
        case "salt_line":
        case "thorn_patch": {
          const perLane = new Map<number, number>()
          for (const s of liveSlugs) perLane.set(s.lane, (perLane.get(s.lane) ?? 0) + 1)
          const [lane, count] = [...perLane.entries()].sort((a, b) => b[1] - a[1])[0] ?? [-1, 0]
          triggerFact = `${liveSlugs.length} slugs on field, densest pack is ${count} in lane ${lane} vs ${fieldN} bodies`
          break
        }
        default:
          triggerFact = `${liveSlugs.length} slugs on field vs ${fieldN} bodies at ${dps} DPS`
      }
      const useChoice = await this.decide(
        engine,
        config,
        "ability_use",
        `You hold ${abilityId} (${meta?.description ?? ""}). USE IT NOW: ${triggerFact}. ` +
          `Abilities kill nothing in the pocket — every hold while bodies die trades a permanent body for a temporary saving.`,
        {
          hold: `Save ${abilityId} for a bigger peak (risks losing bodies now).`,
          [`use_${abilityId}`]: `Use ${abilityId} NOW — ${triggerFact}.`,
        },
      )
      if (useChoice === "hold") return
      // Re-resolve the ability slot (indexes may have shifted after buys).
      const liveIdx = engine
        .snapshot()
        .inventory.findIndex(
          (it) => it.kind === "ability" && (it as { abilityId?: string }).abilityId === abilityId,
        )
      if (liveIdx < 0) return
      engine.selectInventoryItem(liveIdx)
      if (engine.mode === "none") continue // instant ability applied — check for more
      if (engine.mode === "ability-pumpkin") {
        const alive = engine.pumpkins.filter((p) => p.health > 0)
        if (alive.length === 0) return
        const criteria: Record<string, string | null> = {}
        for (const p of alive) {
          criteria[`tgt_${p.id}_${p.type}_L${p.level}`] =
            `Pumpkin #${p.id} (${p.type}, level ${p.level}, HP ${Math.round(p.health)}/${p.maxHealth}).`
        }
        const target = await this.decideTarget(
          engine,
          config,
          "ability_target",
          `Which pumpkin should ${abilityId} be applied to?`,
          criteria,
        )
        const id = parseId(/^tgt_(\d+)_/, target)
        const pumpkin = engine.pumpkins.find((p) => p.id === id)
        if (!pumpkin) return
        engine.onWorldClick(pumpkin.x, pumpkin.y)
      } else if (engine.mode === "ability-point") {
        const points = pointCandidates(engine)
        if (points.length === 0) return
        const criteria: Record<string, string | null> = {}
        for (const pt of points) criteria[pt.key] = pt.label
        const target = await this.decideTarget(
          engine,
          config,
          "ability_target",
          `Where should ${abilityId} be aimed?`,
          criteria,
        )
        const pt = points.find((p) => p.key === target)
        if (!pt) throw new Error(`unknown point target "${target}"`)
        engine.onWorldClick(pt.x, pt.y)
      }
    }
  }

  async pickCard(cards: CardDefinition[], _rng: Rng, ctx: CardContext): Promise<number> {
    // The card offer plus context IS the structured state here. Card value
    // follows the proven heuristic scoring: free pumpkin bodies are pure
    // upside in rounds 1-4 (they cost no coins), pearcer is card-exclusive,
    // and crowd-answer abilities beat a skip.
    // Full-field flip: near the 30-cell cap (24+ bodies) extra pumpkins
    // have nowhere to plant, while round-7 floods demand answers. Bodies
    // drop to near-zero value, crowd-answers jump to the top.
    const fieldFull = ctx.fieldCount >= 24
    const valueOf = (card: CardDefinition): { label: string; score: number } => {
      if (card.kind === "pumpkin") {
        if (fieldFull) {
          return { label: "FREE body — but the field is nearly full, nowhere to plant it", score: 1 }
        }
        switch (card.pumpkinType) {
          case "pearcer":
            return { label: "FREE pierce DPS (card-exclusive — never in shop)", score: 5 }
          case "ferdinand":
            return { label: "FREE cheap DPS body", score: 5 }
          case "gwynevere":
            return ctx.gwynevereCount >= 2
              ? { label: "FREE AoE artillery — but you already own 2, luxury", score: 0.5 }
              : { label: "FREE AoE artillery", score: 4.5 }
          case "herbert":
            return ctx.herbertCount >= 1
              ? { label: "FREE healer — but you already own one and they can't heal each other", score: 0.5 }
              : {
                label: ctx.damagedAny ? "FREE healer (line is bleeding)" : "FREE healer (nothing to heal yet)",
                score: ctx.damagedAny ? 3.5 : 2,
              }
          case "chunky":
            return { label: "FREE tank body", score: 3 }
          case "cramer":
            return {
              label: ctx.cramerCount < 2 ? "FREE economy (mid-game)" : "FREE economy (already have 2)",
              score: ctx.cramerCount < 2 ? 2.5 : 0.5,
            }
        }
      }
      switch (card.abilityId) {
        case "annihilation":
          return { label: "boss/crowd delete", score: fieldFull ? 5 : 4 }
        case "freeze":
        case "holy_grenade":
          return { label: "crowd answer", score: fieldFull ? 5 : 3 }
        case "distraction":
        case "do_not_stop_daddy":
        case "wide_pumpkin":
        case "tailwind":
          return { label: "situational buff/control", score: fieldFull ? 4 : 2.5 }
        default:
          return { label: "niche ability", score: fieldFull ? 3 : 1.5 }
      }
    }
    // From round 3, banking one crowd-answer beats a duplicate body: boss
    // packs (gerald/dell + escorts) out-trade DPS lines without removal.
    const bankAnswer =
      ctx.round >= 3 &&
      ctx.answerCount === 0 &&
      !ctx.inventoryFull
    const criteria: Record<string, string | null> = {}
    // The proven heuristic never skips a card, ever: shop coins buy bodies,
    // but cards are the ONLY source of abilities, so passing one up is pure
    // loss. From round 3 with pocket room, skipping is not offered.
    if (ctx.inventoryFull) {
      criteria.skip = "Take nothing — inventory is FULL, a pumpkin card would overflow."
    } else if (ctx.round < 3) {
      criteria.skip = "Take nothing — only correct if every offer is useless (it almost never is; cards are free)."
    }
    cards.forEach((card, i) => {
      const v = valueOf(card)
      const bankable =
        bankAnswer &&
        card.kind === "ability" &&
        (card.abilityId === "annihilation" ||
          card.abilityId === "freeze" ||
          card.abilityId === "holy_grenade")
      const score = bankable ? 4.5 : v.score
      const tag = bankable ? " (BANK IT: no crowd-answer in pocket and round 3+ packs need removal)" : ""
      criteria[`card_${i}_${card.kind === "pumpkin" ? card.pumpkinType : card.abilityId}`] =
        card.kind === "pumpkin"
          ? `Card ${i}: ${card.pumpkinType} pumpkin to the inventory — ${v.label} (value ${v.score}/5).`
          : `Card ${i}: ${card.abilityId} ability (${ABILITY_META[card.abilityId]?.description ?? ""}) — ${v.label}${tag} (value ${score}/5).`
    })
    const state = {
      cards: cards.map((c) =>
        c.kind === "pumpkin"
          ? { kind: "pumpkin", pumpkin_type: c.pumpkinType }
          : { kind: "ability", ability_id: c.abilityId },
      ),
      context: {
        round: ctx.round,
        cramer_count: ctx.cramerCount,
        any_damaged: ctx.damagedAny,
        inventory_full: ctx.inventoryFull,
        field_count: ctx.fieldCount,
      },
      rules: [
        "Cards are FREE — they cost no coins or XP. A pumpkin card is a free body on the field.",
        "Rounds 1-4 are won with bodies: take free ferdinand/gwynevere/chunky/pearcer over abilities.",
        "Pearcer never appears in the shop — a pearcer card is the only way to get one.",
        "Annihilation and holy_grenade answer crowds and bosses your DPS can't burn down. From round 3, bank one if the pocket has none.",
        "With 24+ bodies the field is nearly full — extra pumpkins have nowhere to plant, so take abilities over bodies.",
        "From round 3 skipping is not an option: cards are the only source of abilities, so always take something when the pocket has room.",
        "Skip only in rounds 1-2 when every offer is weak, or when the inventory is full.",
      ],
    }
    const question: ChoiceQuestion = {
      type: "choice",
      instructions:
        "Which card should be picked, if any? Cards are free — skipping a useful body or crowd-answer in rounds 1-4 just leaves strength on the table.",
      criteria,
    }
    const { choice, confidence, probabilities } = await askChoice(
      this.opts,
      state,
      "card_decision",
      question,
    )
    this.decisions.push({
      phase: `R${ctx.round}/cards`,
      question: "card_decision",
      choice,
      offer: cards.map((c) => (c.kind === "pumpkin" ? c.pumpkinType : c.abilityId)),
      ...(this.recordDetails ? { request: { state, question }, confidence, probabilities } : {}),
    })
    if (choice === "skip") return -1
    return parseId(/^card_(\d+)_/, choice)
  }
}
