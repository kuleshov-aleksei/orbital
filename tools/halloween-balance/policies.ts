// Bot policies that play the game through the same public API as the UI
// (selectInventoryItem / onWorldClick / buyPumpkin / pickCard).
import {
  LANE_COUNT,
  PLACEMENT_COLUMNS,
  columnForX,
  columnX,
  laneCenterY,
  laneForY,
  type HalloweenGameEngine,
} from "../../frontend/src/halloween/game/engine"
import type { CardDefinition } from "../../frontend/src/halloween/game/balance"
import type { GameInputMode, PumpkinType } from "../../frontend/src/halloween/game/types"
import type { HalloweenGameConfig } from "../../frontend/src/halloween/types"
import { pick, randInt, type Rng } from "./rng"
export interface Policy {
  readonly name: string
  /** Called every sim tick while phase === "playing". */
  onTick(engine: HalloweenGameEngine, config: HalloweenGameConfig, rng: Rng): void
  /** Return card index, or -1 to skip. Called once per popup. */
  pickCard(cards: CardDefinition[], rng: Rng, ctx: CardContext): number
}

/** What the bot knows when a card popup appears. */
export interface CardContext {
  cramerCount: number
  damagedAny: boolean
}

/** Free (col, lane) cells derived from live pumpkins, restricted to the
 * engine's currently active lanes (round 1 = 3 center lanes only). */
export function freeCells(engine: HalloweenGameEngine): Array<{ col: number; lane: number }> {
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

/** Read round through a function boundary (widens literal narrowing). */
function snapRound(engine: HalloweenGameEngine): number {
  return engine.snapshot().round
}

/** Read input mode through a function boundary (widens literal narrowing). */
function currentMode(engine: HalloweenGameEngine): GameInputMode {
  return engine.mode
}

/** Place the first pumpkin-type inventory item onto the given cell. */
export function placeFirstPumpkin(
  engine: HalloweenGameEngine,
  col: number,
  lane: number,
): boolean {
  const idx = engine.inventory.findIndex((i) => i.kind === "pumpkin")
  if (idx < 0) return false
  engine.selectInventoryItem(idx)
  if (engine.mode !== "place-pumpkin") return false
  engine.onWorldClick(columnX(col), laneCenterY(lane))
  return currentMode(engine) === "none" // true when placement succeeded
}

/** Use the ability at inventory index on a random valid target. */
export function useAbilityAt(
  engine: HalloweenGameEngine,
  index: number,
  rng: Rng,
): void {
  const item = engine.inventory[index]
  if (!item || item.kind !== "ability") return
  engine.selectInventoryItem(index)
  if (engine.mode === "ability-point") {
    const lanes = engine.activeLanes()
    const lane = lanes[randInt(rng, lanes.length)]
    const x = engine.getWidth() * (0.3 + rng() * 0.6)
    engine.onWorldClick(x, laneCenterY(lane))
  } else if (engine.mode === "ability-pumpkin") {
    const alive = engine.pumpkins.filter((p) => p.health > 0)
    if (alive.length === 0) return
    const target = pick(rng, alive)
    engine.onWorldClick(target.x, target.y)
  }
  // mode "none" here means it was instant — already applied + consumed.
}

/** Slugs per lane, for lane-priority decisions. */
function slugsPerLane(engine: HalloweenGameEngine): number[] {
  const counts = new Array<number>(LANE_COUNT).fill(0)
  for (const s of engine.slugs) {
    if (s.health > 0) counts[laneForY(s.y)]++
  }
  return counts
}

function aliveByType(engine: HalloweenGameEngine): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const p of engine.pumpkins) {
    if (p.health > 0) counts[p.type] = (counts[p.type] ?? 0) + 1
  }
  return counts
}

/**
 * Phase-2 baseline: a "reasonable player". Spreads DPS across threatened
 * lanes, parks tanks on the right (closest to incoming slugs), keeps one
 * Cramer for economy, saves AoE/burst abilities for Gerald packs and leaks.
 */
export class HeuristicPolicy implements Policy {
  readonly name = "heuristic"
  private tick = 0

  onTick(engine: HalloweenGameEngine, config: HalloweenGameConfig, rng: Rng): void {
    this.tick++
    if (this.tick % 15 !== 0) return // act ~2x per sim-second
    this.placeAll(engine);
    this.buy(engine, config);
    this.abilities(engine, rng);
  }

  private placeAll(engine: HalloweenGameEngine): void {
    // NOTE: the engine always places the FIRST pumpkin-kind inventory item,
    // so cell choice is driven by that item's type.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const first = engine.inventory.find((i) => i.kind === "pumpkin")
      if (!first || first.kind !== "pumpkin") break
      const cell = this.cellFor(engine, first.pumpkinType)
      if (!cell) break
      const idx = engine.inventory.indexOf(first)
      engine.selectInventoryItem(idx)
      if (engine.mode !== "place-pumpkin") break
      engine.onWorldClick(columnX(cell.col), laneCenterY(cell.lane))
      if (currentMode(engine) !== "none") break // occupied (stale view) — retry next act
    }
  }

  private cellFor(
    engine: HalloweenGameEngine,
    type: PumpkinType,
  ): { col: number; lane: number } | null {
    const free = freeCells(engine)
    if (free.length === 0) return null
    const perLane = slugsPerLane(engine)
    const lanePumpkins = new Array<number>(LANE_COUNT).fill(0)
    for (const p of engine.pumpkins) {
      if (p.health > 0) lanePumpkins[laneForY(p.y)]++
    }
    // Most threatened lane first, then the emptiest one — except a lane with
    // no defender at all jumps the queue. An empty lane is a free highway to
    // the end zone: every slug there leaks for falloff damage instead of
    // taking fire. Coverage first, depth second.
    const empty = [...Array(LANE_COUNT).keys()].filter(
      (l) => lanePumpkins[l] === 0 && free.some((c) => c.lane === l),
    )
    const lanes =
      empty.length > 0
        ? empty.sort((a, b) => perLane[b] - perLane[a])
        : [...Array(LANE_COUNT).keys()].sort(
            (a, b) => perLane[b] - perLane[a] || lanePumpkins[a] - lanePumpkins[b],
          )
    if (type === "chunky") {
      // Meat shield: rightmost free cell in the most threatened lane.
      for (const lane of lanes) {
        const cols = free
          .filter((c) => c.lane === lane)
          .map((c) => c.col)
          .sort((a, b) => b - a)
        if (cols.length > 0) return { col: cols[0], lane }
      }
      return null
    }
    if (type === "cramer") {
      // Economy: safest spot — leftmost free cell in the emptiest lane.
      const byEmpty = [...Array(LANE_COUNT).keys()].sort(
        (a, b) => lanePumpkins[a] - lanePumpkins[b],
      )
      for (const lane of byEmpty) {
        const cols = free
          .filter((c) => c.lane === lane)
          .map((c) => c.col)
          .sort((a, b) => a - b)
        if (cols.length > 0) return { col: cols[0], lane }
      }
      return null
    }
    // DPS/healer/artillery: leftmost free cell (max firing time) in the
    // most threatened lane.
    for (const lane of lanes) {
      const cols = free
        .filter((c) => c.lane === lane)
        .map((c) => c.col)
        .sort((a, b) => a - b)
      if (cols.length > 0) return { col: cols[0], lane }
    }
    return null
  }

  private buy(engine: HalloweenGameEngine, config: HalloweenGameConfig): void {
    void config // prices come from engine.costFor (inflated); base config unused
    const snap = engine.snapshot()
    if (snap.inventory.length >= 6) return
    const coins = snap.coins
    const alive = aliveByType(engine)
    // Use live inflated shop prices so sims feel the same rising costs as
    // the game (config.pumpkins cost is only the base).
    const cost = (t: PumpkinType) => engine.costFor(t)
    const afford = (t: PumpkinType) => coins >= cost(t)

    // 1. Economy can wait — rounds 1-3 are won with bodies, not interest.
    // A Cramer costs almost 4 Ferdinands; buy it once the mid-game is survivable.
    if ((alive.cramer ?? 0) < 1 && snap.round >= 4 && afford("cramer")) {
      engine.buyPumpkin("cramer")
      return
    }
    // 2. Core DPS line. Cheap bodies first, always.
    if ((alive.ferdinand ?? 0) < 5 && afford("ferdinand")) {
      engine.buyPumpkin("ferdinand")
      return
    }
    // 3. Artillery only on top of an established line — a 5-HP Gwynevere
    // alone in round 2 is a donation to the slugs.
    if ((alive.gwynevere ?? 0) < 2 && (alive.ferdinand ?? 0) >= 4 && afford("gwynevere")) {
      engine.buyPumpkin("gwynevere")
      return
    }
    // 4. Healer when the line is bleeding.
    const damaged = engine.pumpkins.some((p) => p.health > 0 && p.health < p.maxHealth * 0.6)
    if (damaged && (alive.herbert ?? 0) < 2 && afford("herbert")) {
      engine.buyPumpkin("herbert")
      return
    }
    // 5. Tanks to plug gaps.
    if ((alive.chunky ?? 0) < 3 && afford("chunky")) {
      engine.buyPumpkin("chunky")
      return
    }
    // 6. Fallback: more cheap DPS.
    if (afford("ferdinand")) engine.buyPumpkin("ferdinand")
  }

  private abilities(engine: HalloweenGameEngine, rng: Rng): void {
    const idx = engine.inventory.findIndex((i) => i.kind === "ability")
    if (idx < 0) return
    const item = engine.inventory[idx]
    if (item.kind !== "ability") return
    const slugs = engine.slugs.filter((s) => s.health > 0)
    const leak = slugs.some((s) => s.x < 450)
    const gerald = slugs.some((s) => s.type === "gerald" || s.type === "dell")

    switch (item.abilityId) {
      case "annihilation":
        // Shielded heavies eat entire volleys; delete one instead. But don't
        // waste it on round-2 shielded scouts — a free annihilation is for
        // Geralds, Dells, and round-3+ crowds.
        if (gerald || (snapRound(engine) >= 3 && (slugs.some((s) => s.shields > 0) || slugs.length > 10)))
          engine.selectInventoryItem(idx)
        break
      case "freeze":
      case "distraction":
        // Don't wait for the leak: freezing a crowded field keeps marvins off
        // the col-0 line, which is where ferdinands lose 1v1s. Leak = use it
        // now; crowd = use it before contact.
        if ((leak && slugs.length > 4) || slugs.length > 8) engine.selectInventoryItem(idx)
        break
      case "holy_grenade": {
        if (slugs.length < 4) break
        const perLane = slugsPerLane(engine)
        const lane = perLane.indexOf(Math.max(...perLane))
        const xs = slugs
          .filter((s) => laneForY(s.y) === lane)
          .map((s) => s.x)
          .sort((a, b) => a - b)
        const x = xs[Math.floor(xs.length / 2)]
        engine.selectInventoryItem(idx)
        if (engine.mode === "ability-point") engine.onWorldClick(x, laneCenterY(lane))
        break
      }
      case "beer":
      case "salt_line": {
        if (slugs.length < 3) break
        const perLane = slugsPerLane(engine)
        const lane = perLane.indexOf(Math.max(...perLane))
        engine.selectInventoryItem(idx)
        if (engine.mode === "ability-point") engine.onWorldClick(550, laneCenterY(lane))
        break
      }
      case "do_not_stop_daddy": {
        const dps = engine.pumpkins.find(
          (p) => p.health > 0 && (p.type === "ferdinand" || p.type === "gwynevere"),
        )
        if (!dps) break
        engine.selectInventoryItem(idx)
        if (engine.mode === "ability-pumpkin") engine.onWorldClick(dps.x, dps.y)
        break
      }
      case "wide_pumpkin": {
        const tank =
          engine.pumpkins.find((p) => p.health > 0 && p.type === "chunky") ??
          engine.pumpkins.find((p) => p.health > 0)
        if (!tank) break
        engine.selectInventoryItem(idx)
        if (engine.mode === "ability-pumpkin") engine.onWorldClick(tank.x, tank.y)
        break
      }
    }
    void rng // targeted policy; rng unused by design
  }

  pickCard(cards: CardDefinition[], _rng: Rng, ctx: CardContext): number {
    let best = -1
    let bestScore = -Infinity
    cards.forEach((card, i) => {
      let score = 0
      if (card.kind === "pumpkin") {
        switch (card.pumpkinType) {
          case "ferdinand":
            score = 5
            break
          case "gwynevere":
            score = 4.5
            break
          case "herbert":
            score = ctx.damagedAny ? 3.5 : 2
            break
          case "chunky":
            score = 3
            break
          case "cramer":
            score = ctx.cramerCount < 2 ? 2.5 : 0.5
            break
          case "silas":
            score = 5 // card-exclusive pierce DPS — take it every time
            break
        }
      } else {
        switch (card.abilityId) {
          case "annihilation":
            score = 4
            break
          case "freeze":
          case "holy_grenade":
            score = 3
            break
          case "distraction":
          case "do_not_stop_daddy":
          case "wide_pumpkin":
            score = 2.5
            break
          default:
            score = 1.5
        }
      }
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    })
    return best
  }
}
