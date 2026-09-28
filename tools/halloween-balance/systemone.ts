// System One decider client + structured game-state builder for the
// balance test harness. Every gameplay decision in the `systemone` policy
// goes through this client (POST localhost:8000/v1/systemone). Any failure
// throws — the run must fail, never silently fall back to heuristics.
import {
  LANE_COUNT,
  PLACEMENT_COLUMNS,
  columnForX,
  laneForY,
  type HalloweenGameEngine,
} from "../../frontend/src/halloween/game/engine"
import { ABILITY_META } from "../../frontend/src/halloween/game/balance"
import type { AbilityId, PumpkinType } from "../../frontend/src/halloween/game/types"
import type { HalloweenGameConfig } from "../../frontend/src/halloween/types"

export class SystemOneError extends Error {
  readonly status: number | null
  readonly body: string | null
  constructor(message: string, status: number | null = null, body: string | null = null) {
    super(message)
    this.name = "SystemOneError"
    this.status = status
    this.body = body
  }
}

export interface SystemOneClientOptions {
  url: string
  /** Only sent when set — the local decider injects its own model. */
  model?: string
  timeoutMs?: number
  maxRetries?: number
}

export interface ChoiceQuestion {
  type: "choice"
  instructions: string | Record<string, unknown>
  criteria: Record<string, string | null>
}

interface SystemOneResponse {
  answers?: Record<string, { type?: string; choice?: string }>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** POST one `choice` question and return the winning option key. Throws on
 * any failure (network, timeout, non-2xx, unknown choice). Retries with
 * backoff only on 429/529, per the System One docs. */
export async function askChoice(
  opts: SystemOneClientOptions,
  state: unknown,
  questionId: string,
  question: ChoiceQuestion,
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 20000
  const maxRetries = opts.maxRetries ?? 3
  const body: Record<string, unknown> = {
    state,
    questions: { [questionId]: question },
  }
  if (opts.model) body.model = opts.model

  let lastError: unknown = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(opts.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
      const text = await res.text()
      if (res.status === 429 || res.status === 529) {
        lastError = new SystemOneError(
          `systemone overloaded (status ${res.status}), attempt ${attempt + 1}`,
          res.status,
          text.slice(0, 500),
        )
        await sleep(500 * Math.pow(2, attempt))
        continue
      }
      if (!res.ok) {
        throw new SystemOneError(
          `systemone request failed: status ${res.status} for question "${questionId}"`,
          res.status,
          text.slice(0, 1000),
        )
      }
      let parsed: SystemOneResponse
      try {
        parsed = JSON.parse(text) as SystemOneResponse
      } catch {
        throw new SystemOneError(
          `systemone returned invalid JSON for question "${questionId}"`,
          res.status,
          text.slice(0, 500),
        )
      }
      const answer = parsed.answers?.[questionId]
      if (!answer || answer.type !== "choice" || typeof answer.choice !== "string") {
        throw new SystemOneError(
          `systemone answer missing/invalid for question "${questionId}"`,
          res.status,
          text.slice(0, 500),
        )
      }
      if (!(answer.choice in question.criteria)) {
        throw new SystemOneError(
          `systemone returned unknown option "${answer.choice}" for question "${questionId}"`,
          res.status,
          text.slice(0, 500),
        )
      }
      return answer.choice
    } catch (e) {
      if (e instanceof SystemOneError && e.status !== 429 && e.status !== 529) throw e
      if (e instanceof SystemOneError) {
        lastError = e
        continue
      }
      const aborted =
        (e as Error).name === "AbortError" || (e as Error).name === "TimeoutError"
      throw new SystemOneError(
        aborted
          ? `systemone request timed out after ${timeoutMs}ms for question "${questionId}"`
          : `systemone request failed for question "${questionId}": ${(e as Error).message}`,
      )
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new SystemOneError(`systemone exhausted retries for question "${questionId}"`)
}

// ---- Structured state ------------------------------------------------------
// Object state per https://docs.typesafe.ai/concepts/state: named fields so
// each part of the battlefield keeps its relationships clear. Rebuilt fresh
// before every decider call since the engine mutates between calls.

export interface FieldPumpkinState {
  id: number
  type: PumpkinType
  level: number
  health: number
  max_health: number
  hp_pct: number
  col: number
  lane: number
  damage: number
  level_cost: number | null
  /** Anti-slug DPS = damage / live fireInterval (buffs included). 0 for
   * tanks, economy and Herbert (pure healer — see role). */
  dps: number
  role: string
  /** Slugs currently chewing on this pumpkin (engine attackingPumpkinId). */
  attackers: number
  /** incoming slug damage per second (slug damage lands every 3s — engine
   * SLUG_ATTACK_INTERVAL — divided across victims with falloff). */
  incoming_dps: number
}

const SLUG_ATTACK_INTERVAL_S = 3 // mirrors engine.ts SLUG_ATTACK_INTERVAL

const PUMPKIN_ROLES: Record<PumpkinType, string> = {
  ferdinand: "dps",
  pearcer: "dps-pierce",
  gwynevere: "artillery-aoe",
  chunky: "tank",
  herbert: "support-healer",
  cramer: "economy",
}

/** Live anti-slug DPS of one pumpkin. Uses the engine's live fireInterval
 * so rate buffs (do_not_stop_daddy) are included. AoE/pierce multiply this
 * against grouped slugs — reported separately via role + blast_radius. */
export function pumpkinDps(p: {
  type: PumpkinType
  damage: number
  fireInterval: number
}): number {
  if (p.type === "herbert" || p.type === "chunky" || p.type === "cramer") return 0
  if (!Number.isFinite(p.fireInterval) || p.fireInterval <= 0) return 0
  return Math.round((p.damage / p.fireInterval) * 10) / 10
}

/** Total anti-slug DPS of every live pumpkin on the field. */
export function fieldDps(engine: HalloweenGameEngine): number {
  let total = 0
  for (const p of engine.pumpkins) {
    if (p.health > 0) total += pumpkinDps(p)
  }
  return Math.round(total * 10) / 10
}

export interface SlugLaneState {
  lane: number
  count: number
  nearest_x: number | null
  shielded: number
  types: Record<string, number>
}

function slugSummary(s: { type: string; x: number; shields: number }): string {
  return `${s.type}@x${Math.round(s.x)}${s.shields > 0 ? `(${s.shields}sh)` : ""}`
}

export function buildSystemOneState(
  engine: HalloweenGameEngine,
  config: HalloweenGameConfig,
): Record<string, unknown> {
  const snap = engine.snapshot()
  const alive = engine.pumpkins.filter((p) => p.health > 0)
  const liveSlugs = engine.slugs.filter((s) => s.health > 0)

  const field: FieldPumpkinState[] = alive.map((p) => {
    const attackers = liveSlugs.filter((s) => s.attackingPumpkinId === p.id)
    const incoming = attackers.reduce((a, s) => a + s.damage, 0) / SLUG_ATTACK_INTERVAL_S
    return {
      id: p.id,
      type: p.type,
      level: p.level,
      health: Math.round(p.health),
      max_health: p.maxHealth,
      hp_pct: Math.round((p.health / Math.max(1, p.maxHealth)) * 100),
      col: columnForX(p.x),
      lane: laneForY(p.y),
      damage: p.damage,
      level_cost: engine.levelUpCostFor(p),
      dps: pumpkinDps(p),
      role: PUMPKIN_ROLES[p.type],
      attackers: attackers.length,
      incoming_dps: Math.round(incoming * 10) / 10,
    }
  })

  // Per-lane firepower vs per-lane slug HP. Shooters only hit their own
  // lane ahead of them (engine nearestSlugOnLane / gwynevereTarget), so a
  // lane with HP but no DPS is undefended. TTK is a rough estimate —
  // kills, overkill and slug movement aren't modeled.
  const total = fieldDps(engine)
  const totalSlugHp = Math.round(liveSlugs.reduce((a, s) => a + s.health, 0))
  const lanes = engine.activeLanes().map((lane) => {
    const laneDps = Math.round(
      field.filter((p) => p.lane === lane).reduce((a, p) => a + p.dps, 0) * 10,
    ) / 10
    const laneHp = Math.round(
      liveSlugs.filter((s) => s.lane === lane).reduce((a, s) => a + s.health, 0),
    )
    return {
      lane,
      lane_dps: laneDps,
      lane_slug_hp: laneHp,
      lane_ttk_s: laneDps > 0 && laneHp > 0 ? Math.round((laneHp / laneDps) * 10) / 10 : null,
    }
  })

  const taken = new Set(field.map((p) => `${p.col}:${p.lane}`))
  const activeLanes = engine.activeLanes()
  const freeCells: Array<{ col: number; lane: number }> = []
  for (let col = 0; col < PLACEMENT_COLUMNS; col++) {
    for (let lane = 0; lane < LANE_COUNT; lane++) {
      if (!activeLanes.includes(lane)) continue
      if (!taken.has(`${col}:${lane}`)) freeCells.push({ col, lane })
    }
  }

  const byLane: SlugLaneState[] = activeLanes.map((lane) => {
    const inLane = liveSlugs.filter((s) => s.lane === lane)
    const types: Record<string, number> = {}
    for (const s of inLane) types[s.type] = (types[s.type] ?? 0) + 1
    return {
      lane,
      count: inLane.length,
      nearest_x: inLane.length > 0 ? Math.round(Math.min(...inLane.map((s) => s.x))) : null,
      shielded: inLane.filter((s) => s.shields > 0).length,
      types,
    }
  })
  // Nearest individual threats for leak assessment (bounded list).
  const nearest = [...liveSlugs]
    .sort((a, b) => a.x - b.x)
    .slice(0, 20)
    .map((s) => ({
      type: s.type,
      x: Math.round(s.x),
      lane: s.lane,
      hp: Math.round(s.health),
      shields: s.shields,
    }))

  const shop = Object.keys(config.pumpkins).map((t) => {
    const type = t as PumpkinType
    const base = config.pumpkins[type]?.cost ?? 0
    return {
      type,
      price: engine.costFor(type),
      base_cost: base,
      affordable: snap.coins >= engine.costFor(type),
      draft_only: config.pumpkins[type]?.draft_only ?? false,
      refund: engine.sellRefundFor(type),
    }
  })

  const inventory = snap.inventory.map((item, index) => {
    if (item.kind === "pumpkin") {
      const base = config.pumpkins[item.pumpkinType]
      return {
        index,
        kind: "pumpkin",
        pumpkin_type: item.pumpkinType,
        base_health: base?.health ?? null,
        base_damage: base?.damage_per_shot ?? null,
        base_fire_rate: base?.fire_rate ?? null,
      }
    }
    const meta = ABILITY_META[item.abilityId as AbilityId]
    return {
      index,
      kind: "ability",
      ability_id: item.abilityId,
      target: meta?.target ?? "none",
      description: meta?.description ?? "",
    }
  })

  return {
    game: {
      round: snap.round,
      phase: snap.phase,
      score: snap.score,
      active_lanes: activeLanes,
      battlefield_width: engine.getWidth(),
    },
    economy: {
      coins: snap.coins,
      xp: snap.xp,
      inventory_used: snap.inventory.length,
      inventory_capacity: 6,
      shop,
    },
    inventory,
    battlefield: {
      columns: PLACEMENT_COLUMNS,
      lanes: LANE_COUNT,
      field,
      free_cells: freeCells,
      firepower: {
        field_dps_total: total,
        total_slug_hp: totalSlugHp,
        ttk_s_estimate: total > 0 && totalSlugHp > 0 ? Math.round((totalSlugHp / total) * 10) / 10 : null,
        lanes,
      },
    },
    slugs: {
      total: liveSlugs.length,
      by_lane: byLane,
      nearest,
      leaking: nearest.filter((s) => s.x < 450).length,
      heaviest: slugSummary(
        liveSlugs.length > 0
          ? [...liveSlugs].sort((a, b) => b.health - a.health)[0]
          : { type: "none", x: 0, shields: 0 },
      ),
    },
    rules: [
      "Goal: survive as many rounds as possible. You lose when every pumpkin on the field is dead. Score grows per round survived and per slug killed.",
      "Round 1 uses only lanes 1-3; round 2+ opens all 5 lanes (0-4).",
      "Coins buy pumpkins from the shop into the inventory (max 6 slots); shop prices inflate per purchase of that type.",
      "XP levels up pumpkins already on the field (max level 3). Level-up costs are fixed.",
      "Pumpkins in the inventory must be placed onto a free cell (col 0-5, active lane) to fight. Unplaced pumpkins do nothing.",
      "Selling is disabled in this battle — every placed pumpkin fights until it dies.",
      "Slugs crawl left toward your pumpkins; slugs with x < 450 are close to breaking through.",
      "dps is damage per second against slugs in the pumpkin's own lane — shooters only hit their own lane ahead of them, so a lane with slug HP but no DPS is undefended. Artillery-aoe and dps-pierce multiply base DPS against grouped slugs. ttk_s_estimate is rough: it ignores overkill, movement and shields.",
      "A damaged pumpkin deals full damage until it dies — HP is only a survival buffer, so a bloodied shooter is still worth healing, buffing and leveling.",
    ],
  }
}
