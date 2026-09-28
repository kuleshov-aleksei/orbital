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
      const criteria: Record<string, string | null> = {
        hold: "Buy nothing. Save coins for later.",
      }
      for (const t of buyable) {
        const price = engine.costFor(t)
        if (snap.coins < price) continue
        let blurb = `Buy ${t} for ${price} coins (base ${config.pumpkins[t]?.cost}).`
        if (t === "herbert") {
          // Data-driven nudge: exactly one healer is enough while it lives
          // (herberts cannot heal themselves or each other), so a second is
          // wasted coins. The instructions below carry the same rule.
          const haveHealer =
            engine.pumpkins.some((p) => p.health > 0 && p.type === "herbert") ||
            snap.inventory.some((it) => it.kind === "pumpkin" && it.pumpkinType === "herbert")
          blurb += haveHealer
            ? " Healer — but you already own one, and herberts cannot heal each other, so a second is wasted coins."
            : " Healer (5 HP per shot to the most-damaged ally, any lane): worth it once 3+ fighters are taking hits."
        }
        criteria[`buy_${t}_${price}`] = blurb
      }
      if (Object.keys(criteria).length <= 1) return // nothing affordable — no query
      const choice = await this.decide(
        engine,
        config,
        "buy_decision",
        `You have ${snap.coins} coins. Which pumpkin should be bought into the inventory (max 6 slots, ${snap.inventory.length} used), if any? ` +
          `Ferdinand is cheap DPS, chunky is a tank that cannot shoot, gwynevere is AoE artillery, cramer produces coins over time. ` +
          `Herbert is your only sustain: no attack, but heals the most-damaged ally for 5 HP per shot in any lane — one herbert keeps a whole front line alive once fighters start taking hits. ` +
          `Exactly one is enough while it lives (herberts cannot heal themselves or each other), so never stockpile healers.`,
        criteria,
      )
      if (choice === "hold") return
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
      if (this.tick - this.placeHoldTick < SystemOnePolicy.PLACE_HOLD_COOLDOWN_TICKS) {
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
      if (heldTypes.size === 1) {
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
          ).length
          const laneSlugs = engine.slugs.filter((s) => s.health > 0 && s.lane === lane)
          const nearestX =
            laneSlugs.length > 0 ? Math.round(Math.min(...laneSlugs.map((s) => s.x))) : null
          const dps =
            Math.round(
              engine.pumpkins
                .filter((p) => p.health > 0 && laneForY(p.y) === lane)
                .reduce((a, p) => a + pumpkinDps(p), 0) * 10,
            ) / 10
          return { lane, defenders, slugs: laneSlugs.length, nearestX, dps }
        })
        .sort((a, b) => Number(a.defenders > 0) - Number(b.defenders > 0) || a.dps - b.dps)
      const heldEntry = held.find((h) => h.index === invIndex)
      const heldType =
        heldEntry && heldEntry.item.kind === "pumpkin" ? heldEntry.item.pumpkinType : "pumpkin"
      const laneCriteria: Record<string, string | null> = {
        hold: laneHold,
      }
      for (const s of laneStats) {
        laneCriteria[`place_lane_${s.lane}`] =
          `Lane ${s.lane}: ${s.defenders} defender(s)` +
          (s.defenders === 0 ? " — UNDEFENDED" : "") +
          `, ${s.slugs} slug(s)` +
          (s.defenders === 0 && s.nearestX != null ? ` already inside (nearest x=${s.nearestX})!` : "") +
          `, ${s.dps} DPS.`
      }
      const laneChoice = await this.decide(
        engine,
        config,
        "place_lane",
        `Which lane should inventory slot ${invIndex} (${heldType}) defend? ` +
          `Prefer UNDEFENDED lanes — a lane with no pumpkin leaks as soon as slugs reach it. ` +
          `Otherwise reinforce the weakest defended lane (lowest DPS vs slugs). ` +
          `You may also hold the pumpkin instead of placing it.` +
          roundNote,
        laneCriteria,
      )
      if (laneChoice === "hold") {
        this.placeHoldTick = this.tick // same spam guard as place_which holds
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
      const whereCriteria: Record<string, string | null> = {}
      for (const c of laneFree) {
        const laneSlugs = engine.slugs.filter((s) => s.health > 0 && s.lane === c.lane).length
        whereCriteria[`cell_c${c.col}_l${c.lane}`] =
          `Column ${c.col}, lane ${c.lane} (${laneSlugs} slug(s) in this lane).`
      }
      const laneUrgent =
        laneStat && laneStat.defenders === 0 && laneStat.nearestX != null
          ? ` A slug is already inside this undefended lane (nearest x=${laneStat.nearestX}) — it reaches the backline unopposed, so favor a safe left column that shoots the longest.`
          : ""
      const where = await this.decideTarget(
        engine,
        config,
        "place_where",
        `In which column of lane ${lane} should inventory slot ${invIndex} (${heldType}) be placed? Column 0 is leftmost (safest, longest firing time), column 5 is rightmost (closest to slugs). ` +
          `Tanks belong on the right (high columns); DPS, economy and support belong on the left (low columns).` +
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
    }
  }

  private async levelPhase(
    engine: HalloweenGameEngine,
    config: HalloweenGameConfig,
  ): Promise<void> {
    for (let i = 0; i < 12; i++) {
      if (!this.playing(engine)) return
      const xp = engine.snapshot().xp
      const affordable = engine.pumpkins.filter(
        (p) => p.health > 0 && (engine.levelUpCostFor(p) ?? Infinity) <= xp,
      )
      if (affordable.length === 0) return // nothing to decide — no query
      const criteria: Record<string, string | null> = {
        hold: "Level up nothing. Save XP for later.",
      }
      for (const p of affordable) {
        const cost = engine.levelUpCostFor(p) ?? 0
        criteria[`lvl_${p.id}_${p.type}_L${p.level}`] =
          `Level pumpkin #${p.id} (${p.type}, level ${p.level}, HP ${Math.round(p.health)}/${p.maxHealth}, dmg ${p.damage}) for ${cost} XP.`
      }
      const choice = await this.decide(
        engine,
        config,
        "levelup_decision",
        `You have ${xp} XP. Which pumpkin should be leveled up, if any? Level-ups are permanent and never refunded.`,
        criteria,
      )
      if (choice === "hold") return
      const id = parseId(/^lvl_(\d+)_/, choice)
      if (!engine.levelUpPumpkin(id)) return // engine rejected — resync next tick
    }
  }

  /** Ability asks are gated on combat triggers — the decider still makes
   * every use/hold and targeting call, but is only consulted when something
   * happened that could change the answer. Returns false when there is no
   * real decision right now (no query is sent). */
  private abilityTrigger(engine: HalloweenGameEngine, abilityId: AbilityId): boolean {
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
        // Crowd control: leaks and pre-contact crowds, not single scouts.
        return (leak && slugs.length > 4) || slugs.length > 8
      case "holy_grenade":
        return slugs.length >= 4
      case "beer":
      case "salt_line":
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

      const useChoice = await this.decide(
        engine,
        config,
        "ability_use",
        `You hold ${abilityId} (${meta?.description ?? ""}). Should it be used right now, or saved for later?`,
        {
          hold: `Keep ${abilityId} for later.`,
          [`use_${abilityId}`]: `Use ${abilityId} now.`,
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
    // The card offer plus context IS the structured state here.
    const criteria: Record<string, string | null> = {
      skip: "Take nothing. Skip this card.",
    }
    cards.forEach((card, i) => {
      criteria[`card_${i}_${card.kind === "pumpkin" ? card.pumpkinType : card.abilityId}`] =
        card.kind === "pumpkin"
          ? `Card ${i}: ${card.pumpkinType} pumpkin goes to the inventory.`
          : `Card ${i}: ${card.abilityId} ability (${ABILITY_META[card.abilityId]?.description ?? ""}).`
    })
    const state = {
      cards: cards.map((c) =>
        c.kind === "pumpkin"
          ? { kind: "pumpkin", pumpkin_type: c.pumpkinType }
          : { kind: "ability", ability_id: c.abilityId },
      ),
      context: { cramer_count: ctx.cramerCount, any_damaged: ctx.damagedAny },
      rules: [
        "Ferdinand is cheap DPS, chunky is a tank that cannot shoot, herbert is the only healer (5 HP per shot to the most-damaged ally, any lane — take exactly one while none is owned; herberts cannot heal each other), gwynevere is AoE artillery, cramer produces coins, pearcer is card-exclusive piercing DPS.",
        "Annihilation and holy_grenade are the strongest abilities.",
        "Skipping is allowed and sometimes correct (e.g. nothing useful).",
      ],
    }
    const question: ChoiceQuestion = {
      type: "choice",
      instructions: "Which card should be picked, if any?",
      criteria,
    }
    const { choice, confidence, probabilities } = await askChoice(
      this.opts,
      state,
      "card_decision",
      question,
    )
    this.decisions.push({
      phase: "cards",
      question: "card_decision",
      choice,
      ...(this.recordDetails ? { request: { state, question }, confidence, probabilities } : {}),
    })
    if (choice === "skip") return -1
    return parseId(/^card_(\d+)_/, choice)
  }
}
