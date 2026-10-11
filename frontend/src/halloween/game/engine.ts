import type { HalloweenGameConfig } from "../types"
import type {
  AbilityId,
  CardOffer,
  GameBeerCup,
  GameGrenade,
  GameInputMode,
  GameInventoryItem,
  GameKill,
  GamePumpkin,
  GameSaltLine,
  GameSnapshot,
  GameSlug,
  GameProjectile,
  GameThornPatch,
  KillSource,
  PumpkinType,
  SlugType,
} from "./types"
import {
  ABILITY_META,
  INVENTORY_CAPACITY,
  MAX_PUMPKIN_LEVEL,
  buildCardOffer,
  levelStatsFor,
  levelUpCost,
  resolveSpawnTable,
  speedVariationForRound,
  startingPumpkinsForConfig,
} from "./balance"
import type { RandomFn } from "./balance"

// Events the engine emits for presentation (renderer animations + SFX). Each
// carries the entity it concerns so the renderer can animate exactly that
// object — no heuristics, no guessing by diffing state.
export type GameEvent =
  | { type: "pumpkin_placed"; pumpkinId: number; kind: PumpkinType }
  | { type: "pumpkin_sold"; pumpkinId: number }
  | { type: "pumpkin_damaged"; pumpkinId: number; amount: number }
  | { type: "pumpkin_destroyed"; pumpkinId: number }
  | { type: "pumpkin_leveled"; pumpkinId: number; level: number }
  | { type: "fire"; pumpkinId: number }
  | { type: "cramer_produce"; pumpkinId: number; amount: number }
  | { type: "slug_spawned"; slugId: number; slugType: SlugType }
  | {
      type: "slug_destroyed"
      slugId: number
      slugType: SlugType
      x: number
      y: number
      source: KillSource
    }
  | { type: "shield_break"; slugId: number }
  | { type: "slug_damaged"; slugId: number }
  | { type: "slug_attacked"; slugId: number }
  | { type: "item_used"; abilityId: AbilityId }
  | { type: "dell_retired"; slugId: number }

export const FIELD_HEIGHT = 600
const PUMPKIN_RADIUS = 28
const SLUG_RADII: Record<SlugType, number> = {
  scout: 10,
  marvin: 14,
  gerald: 26,
  dell: 16,
}
// Battleground grid: 5 horizontal stripes, 6 placement columns on the left.
export const LANE_COUNT = 5
export const LANE_HEIGHT = FIELD_HEIGHT / LANE_COUNT
export const PLACEMENT_COLUMNS = 6
export const COLUMN_START_X = 80
export const COLUMN_SPACING = 80
const SLUG_ATTACK_INTERVAL = 3
const DELL_SPAWN_INTERVAL = 5
// Dr. Dell Conagher retires after this many Marvins — an immortal Dell would
// otherwise be an infinite XP/coin farm (each Marvin is 3 XP + kill reward).
const DELL_MAX_SPAWNS = 20
// A retired Dell with nothing left to spawn converts into a Gerald with this
// health multiplier. Punish mechanic, and only for the truly stale case: a
// capped Dell converts only once the spawn queue is drained AND no live
// pumpkin shares his lane (lane fire would still kill him, queued slugs
// still progress the round). A Dell parked in an undefended lane after the
// queue drains would otherwise stall the round forever — nothing can reach
// him, nothing new spawns — so he walks the lane himself instead.
const DELL_RETIRED_HP_MUL = 1.5
const DISTRACTION_DURATION = 5
const FREEZE_DURATION = 8
const GRENADE_FUSE = 3
const GRENADE_RADIUS = 300
const GRENADE_DAMAGE = 50
// Beer puddle: a sticky trap. Slugs inside the puddle radius are dragged
// toward the cup (both directions) and slowed; reaching the center sticks
// them briefly. Generous radius so near-lane aim still connects.
const BEER_DURATION = 30
const BEER_PUDDLE_RADIUS = 130
const BEER_PUDDLE_SLOW = 0.4 // slow applied while a slug wades through the puddle
const BEER_STICK_RADIUS = 26 // reaching the center sticks the slug...
const BEER_STICK_TIME = 2 // ...for this long (once per slug per cup)
const SALT_DURATION = 30
const SALT_WIDTH = 120
const SALT_SLOW = 0.3 // slow applied while a slug steps on the line
// Tailwind: global fire-rate buff, reverted when the timer expires.
const TAILWIND_DURATION = 10
const TAILWIND_MUL = 1.5
// Thorn patch: salt's evil twin — same x-footprint as a salt line (all
// lanes), but damage instead of slow. Tuned so healthy slugs walk through
// irritated, not dead: a 10-HP scout needs ~1.25s inside to die.
const THORN_DURATION = 20
const THORN_WIDTH = 120
const THORN_DPS = 8
// Seed rain: a clutch-or-dead card. 100 buys a Ferdinand outright or closes
// half the gap to a Cramer/Gwynevere — about half a round's income.
const SEED_RAIN_COINS = 100
const GWYN_BLAST_RADIUS = 70
// Shop inflation: each shop purchase of a type raises its future price as
// floor(base * 1.15^n), capped at 5x base. Counters snowballing (mass
// Ferdinand spam) while keeping the first few buys affordable. Refunds stay
// tied to the base cost so selling can never profit from inflation.
export const SHOP_PRICE_GROWTH = 1.15
export const SHOP_PRICE_CAP_MULT = 5

// PEARcer is a piercing sniper: each seed passes through this many slugs.
// More than enough — if you need more than 8, you're showing off.
export const PEARCER_PIERCE = 8

export function laneForY(y: number): number {
  return Math.max(0, Math.min(LANE_COUNT - 1, Math.floor(y / LANE_HEIGHT)))
}

export function laneCenterY(lane: number): number {
  return LANE_HEIGHT * (lane + 0.5)
}

export function columnForX(x: number): number {
  return Math.max(
    0,
    Math.min(PLACEMENT_COLUMNS - 1, Math.round((x - COLUMN_START_X) / COLUMN_SPACING)),
  )
}

export function columnX(col: number): number {
  return COLUMN_START_X + col * COLUMN_SPACING
}

interface PendingAbility {
  abilityId: AbilityId
  index: number
}

export class HalloweenGameEngine {
  private config: HalloweenGameConfig
  private width: number

  phase: GameSnapshot["phase"] = "playing"
  private round = 1
  private completedRounds = 0
  private score = 0
  private coins = 0
  private coinsEarned = 0
  private coinsSpent = 0
  // Global level-up pool: every slug kill grants xp_reward, spendable on
  // any pumkin via levelUpPumpkin. Selling never refunds spent XP.
  private xp = 0
  private xpEarned = 0
  // Shop purchases per pumpkin type — drives rising shop prices.
  private purchaseCounts: Record<string, number> = {}

  pumpkins: GamePumpkin[] = []
  slugs: GameSlug[] = []
  projectiles: GameProjectile[] = []
  grenades: GameGrenade[] = []
  beerCups: GameBeerCup[] = []
  saltLines: GameSaltLine[] = []
  thornPatches: GameThornPatch[] = []
  private tailwindTimer = 0
  private tailwindIds = new Set<number>() // live-boosted pumpkin ids (reverted on expiry)

  inventory: GameInventoryItem[] = []
  private kills: GameKill[] = []
  private usedItems: Record<string, number> = {}
  private spawnedPumpkins: Record<string, number> = {}

  private cards: CardOffer | null = null
  private popupIndex = 0
  private popupTotal = 0

  mode: GameInputMode = "none"
  private pendingAbility: PendingAbility | null = null
  private pendingPlacementIndex: number | null = null
  hoveredPumpkinId: number | null = null
  prompt: string | null = null
  gameOverReason: string | null = null

  private spawnQueue: Array<{ type: SlugType; shielded: boolean }> = []
  private spawnTimer = 0

  private nextId = 1
  private reportSubmitted = false

  onEvent: ((event: GameEvent) => void) | null = null

  // Injectable RNG for seeded headless sims. Defaults to Math.random so the
  // live game is unaffected.
  private rng: RandomFn

  constructor(config: HalloweenGameConfig, rng: RandomFn = Math.random) {
    this.config = config
    this.rng = rng
    this.width = config.battlefield_length
    this.coins = config.starting_coins
    for (const pumpkinType of startingPumpkinsForConfig(config)) {
      this.inventory.push({ kind: "pumpkin", pumpkinType })
    }
    this.startRound(1)
  }

  snapshot(): GameSnapshot {
    return {
      phase: this.phase,
      round: this.round,
      completedRounds: this.completedRounds,
      score: this.score,
      coins: this.coins,
      xp: this.xp,
      shopPrices: this.shopPrices(),
      inventory: this.inventory.map((i) => ({ ...i })),
      cards: this.cards,
      popupIndex: this.popupIndex,
      popupTotal: this.popupTotal,
      mode: this.mode,
      pendingAbility: this.pendingAbility?.abilityId ?? null,
      selectedInventoryIndex:
        this.mode === "place-pumpkin"
          ? this.pendingPlacementIndex
          : (this.pendingAbility?.index ?? null),
      prompt: this.prompt,
      gameOverReason: this.gameOverReason,
    }
  }

  alivePumpkinCount(): number {
    return this.pumpkins.filter((p) => p.health > 0).length
  }

  getWidth(): number {
    return this.width
  }

  get pendingAbilityId(): AbilityId | null {
    return this.pendingAbility?.abilityId ?? null
  }

  get selectedInventoryIndex(): number | null {
    if (this.mode === "place-pumpkin") return this.pendingPlacementIndex
    if (this.pendingAbility) return this.pendingAbility.index
    return null
  }

  aliveSlugCount(): number {
    return this.slugs.length
  }

  // ---- Line availability -------------------------------------------------
  // Hardcoded: round 1 restricts play to the 3 center lanes so an unlucky
  // spawn lane can't ruin the run before the player has coverage. Round 2+
  // opens all 5 lanes. Applies to both pumpkin placement and slug spawns.
  activeLanes(): number[] {
    if (this.round <= 1) return [1, 2, 3]
    return Array.from({ length: LANE_COUNT }, (_, i) => i)
  }

  // ---- Rounds ------------------------------------------------------------

  private startRound(round: number) {
    this.round = round
    const table = resolveSpawnTable(round, this.config)
    this.spawnQueue = []
    for (const type of Object.keys(table.pool) as SlugType[]) {
      for (let i = 0; i < table.pool[type]; i++) this.spawnQueue.push({ type, shielded: false })
    }
    // Random spawn order
    for (let i = this.spawnQueue.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1))
      ;[this.spawnQueue[i], this.spawnQueue[j]] = [this.spawnQueue[j], this.spawnQueue[i]]
    }
    // The first N in the shuffled queue get shields. Random slugs, random
    // count of 3-6 each at spawn time. Yes, your scout can have 6 shields.
    const shielded = Math.min(table.shielded ?? 0, this.spawnQueue.length)
    for (let i = 0; i < shielded; i++) this.spawnQueue[i].shielded = true
    this.spawnTimer = table.interval
    this.prompt =
      shielded > 0
        ? `Round ${round} — ${this.spawnQueue.length} slugs incoming (${shielded} shielded)`
        : `Round ${round} — ${this.spawnQueue.length} slugs incoming`
  }

  private completeRound() {
    this.completedRounds = this.round
    this.score += this.round * this.config.round_bonus
    this.popupTotal = Math.min(this.round, 3)
    this.popupIndex = 0
    this.cards = { cards: buildCardOffer(this.rng) }
    this.phase = "cards"
    this.prompt = null
    this.mode = "none"
  }

  pickCard(index: number) {
    if (this.phase !== "cards" || !this.cards) return
    if (index >= 0 && index < this.cards.cards.length) {
      const card = this.cards.cards[index]
      if (card.kind === "pumpkin")
        this.addInventoryItem({ kind: "pumpkin", pumpkinType: card.pumpkinType })
      else this.addInventoryItem({ kind: "ability", abilityId: card.abilityId })
    }
    this.popupIndex += 1
    if (this.popupIndex >= this.popupTotal) {
      this.cards = null
      this.phase = "playing"
      this.startRound(this.round + 1)
    } else {
      this.cards = { cards: buildCardOffer(this.rng) }
    }
  }

  private addInventoryItem(item: GameInventoryItem) {
    if (this.inventory.length >= INVENTORY_CAPACITY) {
      this.inventory.shift()
      // The oldest slot vanished — shift armed indexes so they still point
      // at the same item.
      if (this.pendingPlacementIndex != null) {
        this.pendingPlacementIndex -= 1
        if (this.pendingPlacementIndex < 0) this.clearInteraction()
      }
      if (this.pendingAbility) {
        this.pendingAbility.index -= 1
        if (this.pendingAbility.index < 0) this.clearInteraction()
      }
    }
    this.inventory.push(item)
  }

  // ---- Shop --------------------------------------------------------------

  // Current shop price for a type: floor(base * 1.15^purchases), capped at
  // 5x base. Only shop buys count — free card pumpkins don't inflate prices.
  costFor(type: PumpkinType): number {
    const base = this.config.pumpkins[type]?.cost ?? 0
    if (base <= 0) return base
    const n = this.purchaseCounts[type] ?? 0
    const inflated = Math.floor(base * Math.pow(SHOP_PRICE_GROWTH, n))
    return Math.min(inflated, base * SHOP_PRICE_CAP_MULT)
  }

  private shopPrices(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const type of Object.keys(this.config.pumpkins)) {
      out[type] = this.costFor(type as PumpkinType)
    }
    return out
  }

  // buyPumpkin spends seeds to place a pumpkin directly into the inventory.
  // Costs are server-authoritative base prices (config.pumpkins[type].cost)
  // plus per-type inflation from costFor(); refunds stay at base cost.
  buyPumpkin(type: PumpkinType): boolean {
    if (this.phase !== "playing") return false
    // Draft-only pumpkins aren't for sale. The shop has standards. So does PEARcer.
    if (this.config.pumpkins[type]?.draft_only) return false
    const cost = this.costFor(type)
    if (this.coins < cost) return false
    this.coins -= cost
    this.coinsSpent += cost
    this.purchaseCounts[type] = (this.purchaseCounts[type] ?? 0) + 1
    this.addInventoryItem({ kind: "pumpkin", pumpkinType: type })
    return true
  }

  private addCoins(amount: number) {
    if (amount <= 0) return
    this.coins += amount
    this.coinsEarned += amount
  }

  // ---- Hover & selling ---------------------------------------------------

  setHover(x: number, y: number) {
    this.hoveredPumpkinId = this.findPumpkinAt(x, y)?.id ?? null
  }

  clearHover() {
    this.hoveredPumpkinId = null
  }

  get hoveredPumpkin(): GamePumpkin | null {
    if (this.hoveredPumpkinId == null) return null
    return this.pumpkins.find((p) => p.id === this.hoveredPumpkinId) ?? null
  }

  sellRefundFor(type: PumpkinType): number {
    // Refund stays at 50% of the BASE cost so inflation can never be
    // arbitraged (buy low, sell at inflated refund).
    return Math.floor((this.config.pumpkins[type]?.cost ?? 0) * 0.5)
  }

  // Selling removes the pumpkin from the field and refunds 50% of its cost.
  sellPumpkin(id: number): boolean {
    if (this.phase !== "playing") return false
    const index = this.pumpkins.findIndex((p) => p.id === id)
    if (index < 0 || this.pumpkins[index].health <= 0) return false
    const pumpkin = this.pumpkins[index]
    this.pumpkins.splice(index, 1)
    if (this.hoveredPumpkinId === id) this.hoveredPumpkinId = null
    this.coins += this.sellRefundFor(pumpkin.type)
    this.onEvent?.({ type: "pumpkin_sold", pumpkinId: pumpkin.id })
    if (this.alivePumpkinCount() === 0) {
      this.phase = "gameover"
      this.gameOverReason = "All pumpkins were sold"
    }
    return true
  }

  // Removes a destroyed pumpkin once its death presentation has finished.
  // Unlike sellPumpkin this refunds nothing — it is corpse cleanup, not a sale.
  removePumpkin(id: number): boolean {
    const index = this.pumpkins.findIndex((p) => p.id === id)
    if (index < 0) return false
    this.pumpkins.splice(index, 1)
    if (this.hoveredPumpkinId === id) this.hoveredPumpkinId = null
    return true
  }

  // ---- Input -------------------------------------------------------------

  selectInventoryItem(index: number) {
    const item = this.inventory[index]
    if (!item || this.phase !== "playing") return

    // Clicking the armed slot again cancels aiming (toggle-off).
    if (this.mode !== "none" && this.selectedInventoryIndex === index) {
      this.clearInteraction()
      return
    }

    // Clicking another slot while aiming cancels the current placement and reselects.
    if (this.mode !== "none") {
      this.clearInteraction()
    }

    if (item.kind === "pumpkin") {
      this.mode = "place-pumpkin"
      this.pendingPlacementIndex = index
      this.prompt = `Click the battlefield to place a ${item.pumpkinType} pumpkin`
    } else {
      const meta = ABILITY_META[item.abilityId]
      if (meta.target === "none") {
        this.applyInstantAbility(item.abilityId)
        this.consumeInventoryItem(index)
      } else {
        this.pendingAbility = { abilityId: item.abilityId, index }
        if (meta.target === "point") {
          this.mode = "ability-point"
          this.prompt = `Click the battlefield to use ${meta.name}`
        } else {
          this.mode = "ability-pumpkin"
          this.prompt = `Click a pumpkin to use ${meta.name}`
        }
      }
    }
  }

  onWorldClick(x: number, y: number) {
    if (this.phase !== "playing") return

    switch (this.mode) {
      case "place-pumpkin":
        this.tryPlacePumpkinFromInventory(x, y)
        break
      case "ability-point":
        this.applyPointAbility(x, y)
        break
      case "ability-pumpkin": {
        const pumpkin = this.findPumpkinAt(x, y)
        if (pumpkin) this.applyPumpkinAbility(pumpkin.id)
        else this.prompt = "No pumpkin there — click one of your pumpkins"
        break
      }
      case "none":
        // Clicks on empty battlefield do nothing; Gwynevere always autotargets.
        break
    }
  }

  private tryPlacePumpkinFromInventory(x: number, y: number) {
    // Use the exact slot the player armed — not the first pumpkin in the
    // inventory. Inventory can shift (shop buys, card picks) while aiming,
    // so validate the stored index before using it.
    const index = this.pendingPlacementIndex
    const item =
      index != null && index >= 0 && index < this.inventory.length
        ? this.inventory[index]
        : undefined
    if (index == null || !item || item.kind !== "pumpkin") {
      this.clearInteraction()
      return
    }
    const lane = laneForY(y)
    const col = columnForX(x)
    if (!this.activeLanes().includes(lane)) {
      this.prompt = "That lane opens in round 2 — pick a glowing lane"
      return
    }
    if (this.pumpkinAtCell(col, lane)) {
      this.prompt = "That spot is already taken — pick another"
      return
    }
    this.spawnPumpkin(item.pumpkinType, columnX(col), laneCenterY(lane))
    this.consumeInventoryItem(index)
    this.clearInteraction()
  }

  private pumpkinAtCell(col: number, lane: number): boolean {
    return this.pumpkins.some(
      (p) => p.health > 0 && laneForY(p.y) === lane && columnForX(p.x) === col,
    )
  }

  private findPumpkinAt(x: number, y: number): GamePumpkin | null {
    for (const p of this.pumpkins) {
      if (p.health <= 0) continue
      const dx = p.x - x
      const dy = p.y - y
      if (Math.hypot(dx, dy) <= p.radius + 6) return p
    }
    return null
  }

  private clearInteraction() {
    this.mode = "none"
    this.pendingAbility = null
    this.pendingPlacementIndex = null
    this.prompt = null
  }

  endGame() {
    if (this.phase === "ended" || this.phase === "gameover") return
    this.phase = "ended"
    this.gameOverReason = "You ended the battle"
    this.clearInteraction()
  }

  // ---- Entities ----------------------------------------------------------

  private spawnPumpkin(type: PumpkinType, x: number, y: number) {
    const stats = levelStatsFor(type, 1, this.config)
    const health = stats?.health ?? this.config.pumpkins[type]?.health ?? 10
    const fireRate = stats?.fire_rate ?? this.config.pumpkins[type]?.fire_rate ?? 0
    const id = this.nextId++
    this.pumpkins.push({
      id,
      type,
      x,
      y,
      level: 1,
      health,
      maxHealth: health,
      radius: PUMPKIN_RADIUS,
      fireTimer: 0,
      fireInterval: fireRate > 0 ? 1 / fireRate : Infinity,
      damage: stats?.damage_per_shot ?? this.config.pumpkins[type]?.damage_per_shot ?? 0,
      projectileSpeed: stats?.projectile_speed ?? this.config.pumpkins[type]?.projectile_speed ?? 0,
      blastRadius: stats?.blast_radius || GWYN_BLAST_RADIUS,
      fireRateMul: 1,
      coinTimer: 0,
    })
    this.spawnedPumpkins[type] = (this.spawnedPumpkins[type] ?? 0) + 1
    this.onEvent?.({ type: "pumpkin_placed", pumpkinId: id, kind: type })
  }

  // ---- Level-ups ---------------------------------------------------------

  // levelUpCostFor returns the XP price of leveling the given pumpkin,
  // or null when it is already maxed.
  levelUpCostFor(pumpkin: GamePumpkin): number | null {
    return levelUpCost(pumpkin.level, this.config)
  }

  // levelUpPreview returns the next level number, its XP cost, and its
  // balance row for tooltip diffs. Null when the pumpkin is maxed.
  levelUpPreview(pumpkinId: number): {
    level: number
    cost: number
    stats: {
      health: number
      fireRate: number
      damage: number
      blastRadius: number
      coinInterval: number
    }
  } | null {
    const pumpkin = this.pumpkins.find((p) => p.id === pumpkinId)
    if (!pumpkin || pumpkin.health <= 0) return null
    const cost = this.levelUpCostFor(pumpkin)
    if (cost == null) return null
    const stats = levelStatsFor(pumpkin.type, pumpkin.level + 1, this.config)
    if (!stats) return null
    return {
      level: pumpkin.level + 1,
      cost,
      stats: {
        health: stats.health,
        fireRate: stats.fire_rate,
        damage: stats.damage_per_shot,
        blastRadius: stats.blast_radius || GWYN_BLAST_RADIUS,
        coinInterval: stats.coin_interval_s,
      },
    }
  }

  // levelUpPumpkin spends global XP to level a pumpkin (playing phase only).
  // Max-HP buffs (wide_pumpkin x2) are preserved proportionally; current
  // health gains exactly the max-HP delta — no free full heal.
  levelUpPumpkin(id: number): boolean {
    if (this.phase !== "playing") return false
    const pumpkin = this.pumpkins.find((p) => p.id === id)
    if (!pumpkin || pumpkin.health <= 0) return false
    if (pumpkin.level >= MAX_PUMPKIN_LEVEL) return false
    const cost = this.levelUpCostFor(pumpkin)
    if (cost == null || this.xp < cost) return false
    const stats = levelStatsFor(pumpkin.type, pumpkin.level + 1, this.config)
    if (!stats) return false
    const prevBase =
      levelStatsFor(pumpkin.type, pumpkin.level, this.config)?.health ?? pumpkin.maxHealth
    this.xp -= cost
    pumpkin.level += 1
    const oldMax = pumpkin.maxHealth
    // Preserve proportional max-HP buffs (e.g. wide_pumpkin x2) by scaling
    // the buff multiplier, not the absolute bonus.
    const buffMul = prevBase > 0 ? oldMax / prevBase : 1
    const newMax = Math.max(1, Math.round(stats.health * buffMul))
    pumpkin.maxHealth = newMax
    pumpkin.health += newMax - oldMax
    if (stats.fire_rate > 0) {
      pumpkin.fireInterval = 1 / stats.fire_rate / pumpkin.fireRateMul
    } else {
      pumpkin.fireInterval = Infinity
    }
    pumpkin.damage = stats.damage_per_shot
    pumpkin.projectileSpeed = stats.projectile_speed
    if (stats.blast_radius > 0) pumpkin.blastRadius = stats.blast_radius
    pumpkin.fireTimer = Math.min(pumpkin.fireTimer, pumpkin.fireInterval)
    this.onEvent?.({ type: "pumpkin_leveled", pumpkinId: pumpkin.id, level: pumpkin.level })
    return true
  }

  private spawnSlug(type: SlugType, x: number, y: number, speedMul = 1, shields = 0) {
    const cfg = this.config.slugs[type]
    // Slugs compound HP every round; pumpkins don't. Round 1 is exempt —
    // exponent is round-1, so the tutorial round stays exactly at base.
    // Dell-spawned marvins come through here too. No free rides.
    const baseHP = cfg?.health ?? 10
    const hpMul = Math.pow(this.config.slug_hp_growth ?? 1, Math.max(0, this.round - 1))
    const health = Math.max(1, Math.round(baseHP * hpMul))
    const id = this.nextId++
    this.slugs.push({
      id,
      type,
      x,
      y,
      lane: laneForY(y),
      health,
      maxHealth: health,
      speed: (cfg?.speed ?? 0) * speedMul,
      damage: cfg?.damage_to_pumpkin ?? 0,
      rewardPoints: cfg?.reward_points ?? 0,
      radius: SLUG_RADII[type],
      attackTimer: 0,
      attackingPumpkinId: null,
      direction: -1,
      frozenFor: 0,
      stuckFor: 0,
      distractionFor: 0,
      spawnTimer: 0,
      spawnedCount: 0,
      shields,
      maxShields: shields,
    })
    this.onEvent?.({ type: "slug_spawned", slugId: id, slugType: type })
  }

  // Shields absorb hits, not HP. One hit strips exactly one shield no matter
  // how much damage the shot deals — PEARcer's 25-damage tracers are worth
  // precisely as much as a spitball here. Annihilation bypasses shields
  // entirely (it doesn't deal damage; it just deletes).
  private damageSlug(slug: GameSlug, damage: number, source: KillSource): void {
    if (slug.shields > 0) {
      slug.shields--
      this.onEvent?.({ type: "shield_break", slugId: slug.id })
      return
    }
    slug.health -= damage
    if (slug.health <= 0) {
      this.killSlug(slug, source)
    } else {
      this.onEvent?.({ type: "slug_damaged", slugId: slug.id })
    }
  }

  // ---- Abilities ---------------------------------------------------------

  private applyInstantAbility(abilityId: AbilityId) {
    this.trackUse(abilityId)
    this.onEvent?.({ type: "item_used", abilityId })
    switch (abilityId) {
      case "annihilation": {
        const target = [...this.slugs].sort((a, b) => b.health - a.health)[0]
        if (target) this.killSlug(target, "annihilation")
        break
      }
      case "freeze":
        for (const s of this.slugs) s.frozenFor = FREEZE_DURATION
        break
      case "tailwind": {
        // Global haste: boost every live pumpkin not already boosted (recasts
        // extend the timer without stacking). Placed-mid-effect pumpkins join
        // on the next cast; level-ups preserve the multiplier via fireRateMul.
        this.tailwindTimer = TAILWIND_DURATION
        for (const p of this.pumpkins) {
          if (p.health <= 0 || this.tailwindIds.has(p.id)) continue
          p.fireRateMul *= TAILWIND_MUL
          p.fireInterval /= TAILWIND_MUL
          p.fireTimer = Math.min(p.fireTimer, p.fireInterval)
          this.tailwindIds.add(p.id)
        }
        break
      }
      case "distraction":
        for (const s of this.slugs) {
          if (s.speed > 0) s.distractionFor = DISTRACTION_DURATION
        }
        break
      case "seed_rain":
        this.addCoins(SEED_RAIN_COINS)
        break
      default:
        break
    }
  }

  // Consume the exact armed slot; fall back to first matching ability only
  // if the stored index went stale (inventory shifted while aiming).
  private consumePendingAbility(): void {
    const pending = this.pendingAbility
    if (!pending) return
    const item = this.inventory[pending.index]
    if (item && item.kind === "ability" && item.abilityId === pending.abilityId) {
      this.consumeInventoryItem(pending.index)
      return
    }
    const fallback = this.inventory.find(
      (i) => i.kind === "ability" && i.abilityId === pending.abilityId,
    )
    if (fallback) this.consumeInventoryItem(this.inventory.indexOf(fallback))
  }

  private applyPointAbility(x: number, y: number) {
    const abilityId = this.pendingAbility?.abilityId
    if (!abilityId) return
    this.trackUse(abilityId)
    this.onEvent?.({ type: "item_used", abilityId })

    switch (abilityId) {
      case "holy_grenade":
        this.grenades.push({
          id: this.nextId++,
          x,
          y,
          fuse: GRENADE_FUSE,
          blastRadius: GRENADE_RADIUS,
          damage: GRENADE_DAMAGE,
        })
        break
      case "beer":
        this.beerCups.push({
          id: this.nextId++,
          x,
          y,
          duration: BEER_DURATION,
          radius: BEER_PUDDLE_RADIUS,
          attracted: new Set(),
        })
        break
      case "salt_line":
        this.saltLines.push({ id: this.nextId++, x, duration: SALT_DURATION, width: SALT_WIDTH })
        break
      case "thorn_patch":
        this.thornPatches.push({
          id: this.nextId++,
          x,
          duration: THORN_DURATION,
          width: THORN_WIDTH,
        })
        break
      default:
        break
    }

    this.consumePendingAbility()
    this.clearInteraction()
  }

  private applyPumpkinAbility(pumpkinId: number) {
    const abilityId = this.pendingAbility?.abilityId
    if (!abilityId) return
    const pumpkin = this.pumpkins.find((p) => p.id === pumpkinId)
    if (!pumpkin || pumpkin.health <= 0) return

    this.trackUse(abilityId)
    this.onEvent?.({ type: "item_used", abilityId })

    if (abilityId === "do_not_stop_daddy") {
      pumpkin.fireRateMul *= 2
      pumpkin.fireInterval /= 2
    } else if (abilityId === "wide_pumpkin") {
      pumpkin.maxHealth *= 2
      pumpkin.health += pumpkin.maxHealth / 2
    }

    this.consumePendingAbility()
    this.clearInteraction()
  }

  private consumeInventoryItem(index: number) {
    if (index < 0 || index >= this.inventory.length) return
    this.inventory.splice(index, 1)
    // Keep armed indexes valid when an earlier slot is consumed (e.g. an
    // instant ability used while aiming a placement).
    if (this.pendingPlacementIndex != null && index < this.pendingPlacementIndex) {
      this.pendingPlacementIndex -= 1
    }
    if (this.pendingAbility && index < this.pendingAbility.index) {
      this.pendingAbility.index -= 1
    }
  }

  private trackUse(abilityId: AbilityId) {
    this.usedItems[abilityId] = (this.usedItems[abilityId] ?? 0) + 1
  }

  // ---- Update ------------------------------------------------------------

  update(dt: number) {
    if (this.phase === "ended" || this.phase === "gameover") return
    const dtClamped = Math.min(dt, 0.25)

    this.updateSlugSpawns(dtClamped)
    this.updateSlugs(dtClamped)
    this.updatePumpkins(dtClamped)
    this.updateCramers(dtClamped)
    this.updateProjectiles(dtClamped)
    this.updateGrenades(dtClamped)
    this.updateBeerCups(dtClamped)
    this.updateSaltLines(dtClamped)
    this.updateThornPatches(dtClamped)
    this.updateTailwind(dtClamped)

    if (this.phase === "playing") this.checkRoundEnd()
    if (this.phase === "playing") this.checkGameOver()
  }

  private updateSlugSpawns(dt: number) {
    if (this.spawnQueue.length === 0) return
    this.spawnTimer -= dt
    if (this.spawnTimer <= 0) {
      const { type, shielded } = this.spawnQueue.shift()!
      const variation = speedVariationForRound(this.round, this.config)
      const speedMul = 1 + (this.rng() * 2 - 1) * variation
      const lanes = this.activeLanes()
      const lane = lanes[Math.floor(this.rng() * lanes.length)]
      // Shielded slugs roll 3-6 shields (config shield_min/max). Dell's
      // mid-round marvins arrive unshielded — even elites have standards.
      const min = this.config.shield_min ?? 0
      const max = this.config.shield_max ?? 0
      const shields = shielded && max > 0 ? min + Math.floor(this.rng() * (max - min + 1)) : 0
      this.spawnSlug(type, this.width + 20, laneCenterY(lane), speedMul, shields)
      this.spawnTimer = resolveSpawnTable(this.round, this.config).interval
    }
  }

  private updateSlugs(dt: number) {
    const escaped: number[] = []
    for (const slug of this.slugs) {
      if (slug.frozenFor > 0) {
        slug.frozenFor -= dt
        continue
      }
      if (slug.stuckFor > 0) {
        slug.stuckFor -= dt
        continue
      }
      if (slug.distractionFor > 0) slug.distractionFor -= dt

      const direction = slug.distractionFor > 0 ? 1 : -1

      // Dr. Dell Conagher doesn't move; spawns Marvins (capped per Dell).
      // Once stale (capped, queue drained, nobody engaging him) he converts
      // to a buffed Gerald and walks the lane — no sitting still, no stalls.
      if (slug.type === "dell" && slug.health > 0) {
        slug.spawnTimer += dt
        if (slug.spawnTimer >= DELL_SPAWN_INTERVAL && slug.spawnedCount < DELL_MAX_SPAWNS) {
          slug.spawnTimer = 0
          slug.spawnedCount += 1
          this.spawnSlug("marvin", slug.x + 10, slug.y)
        }
        if (slug.spawnedCount >= DELL_MAX_SPAWNS && this.isDellStale(slug)) {
          this.retireDell(slug)
        } else {
          continue
        }
      }

      // Attack the pumpkin we've reached on our lane.
      const attacked = this.findAttackTarget(slug)
      if (attacked) {
        const justEngaged = slug.attackingPumpkinId !== attacked.id
        slug.attackingPumpkinId = attacked.id
        if (justEngaged) {
          // First bite lands immediately; subsequent bites every interval.
          slug.attackTimer = SLUG_ATTACK_INTERVAL
          this.onEvent?.({ type: "slug_attacked", slugId: slug.id })
        }
        slug.attackTimer += dt
        if (slug.attackTimer >= SLUG_ATTACK_INTERVAL) {
          slug.attackTimer = 0
          attacked.health -= slug.damage
          this.onEvent?.({ type: "slug_attacked", slugId: slug.id })
          this.onEvent?.({
            type: "pumpkin_damaged",
            pumpkinId: attacked.id,
            amount: slug.damage,
          })
          if (attacked.health <= 0) {
            this.onEvent?.({ type: "pumpkin_destroyed", pumpkinId: attacked.id })
          }
        }
        continue
      }

      slug.attackingPumpkinId = null

      // Beer puddle: slugs wading through the puddle are dragged toward the
      // cup in x (both directions — including ones that already walked past)
      // and slowed. Reaching the center sticks them briefly, once per slug.
      let moveDir = direction
      let moveMul = 1
      for (const cup of this.beerCups) {
        if (cup.attracted.has(slug.id)) continue
        const dx = cup.x - slug.x
        const dist = Math.hypot(dx, slug.y - cup.y)
        if (dist > cup.radius + slug.radius) continue
        if (dist <= BEER_STICK_RADIUS + slug.radius) {
          slug.stuckFor = BEER_STICK_TIME
          cup.attracted.add(slug.id)
          continue
        }
        moveDir = dx > 0 ? 1 : -1
        moveMul *= 1 - BEER_PUDDLE_SLOW
      }
      if (slug.stuckFor > 0) continue // stuck this tick — no attack, no move

      // Salt line: slugs stepping on the line move 30% slower.
      let moveSpeed = slug.speed * moveMul
      for (const line of this.saltLines) {
        if (Math.abs(slug.x - line.x) <= line.width / 2 + slug.radius) {
          moveSpeed *= 1 - SALT_SLOW
        }
      }
      slug.x += moveSpeed * moveDir * dt

      // Reaching the left border punishes the player: the slug lashes out at
      // the 4 closest pumpkins with falloff (100/75/50/25%), then escapes
      // without a reward. Death by a thousand papercuts, not a firing squad.
      if (slug.x < -slug.radius) {
        const falloff = [1, 0.75, 0.5, 0.25]
        const targets = this.pumpkins
          .filter((p) => p.health > 0)
          .sort(
            (a, b) =>
              Math.hypot(a.x - slug.x, a.y - slug.y) - Math.hypot(b.x - slug.x, b.y - slug.y),
          )
          .slice(0, falloff.length)
        targets.forEach((p, i) => {
          const amount = Math.round(slug.damage * falloff[i])
          p.health -= amount
          this.onEvent?.({ type: "pumpkin_damaged", pumpkinId: p.id, amount })
          if (p.health <= 0) {
            this.onEvent?.({ type: "pumpkin_destroyed", pumpkinId: p.id })
          }
        })
        escaped.push(slug.id)
        continue
      }
    }
    if (escaped.length > 0) {
      this.slugs = this.slugs.filter((s) => !escaped.includes(s.id))
    }
  }

  // A capped Dell is stale only when nothing can ever change his state: the
  // spawn queue is drained, no live pumpkin shares his lane, and the pocket
  // holds no dell-answer (annihilation, holy grenade). Anything else — lane
  // fire, queued slugs, a banked answer — still resolves him unconverted.
  private isDellStale(slug: GameSlug): boolean {
    if (this.spawnQueue.length > 0) return false
    if (this.pumpkins.some((p) => p.health > 0 && laneForY(p.y) === slug.lane)) return false
    return !this.inventory.some(
      (i) =>
        i.kind === "ability" && (i.abilityId === "annihilation" || i.abilityId === "holy_grenade"),
    )
  }

  // A Dell out of Marvins becomes a buffed Gerald (1.5x round-scaled health,
  // Gerald speed/damage) at full health and keeps his shields and position.
  // Distraction is cleared so he walks toward the pumpkins instead of away.
  private retireDell(slug: GameSlug) {
    const cfg = this.config.slugs["gerald"]
    const baseHP = cfg?.health ?? 10
    const hpMul = Math.pow(this.config.slug_hp_growth ?? 1, Math.max(0, this.round - 1))
    const health = Math.max(1, Math.round(baseHP * hpMul * DELL_RETIRED_HP_MUL))
    slug.type = "gerald"
    slug.health = health
    slug.maxHealth = health
    slug.speed = cfg?.speed ?? 0
    slug.damage = cfg?.damage_to_pumpkin ?? 0
    slug.rewardPoints = cfg?.reward_points ?? 0
    slug.radius = SLUG_RADII["gerald"]
    slug.attackTimer = 0
    slug.attackingPumpkinId = null
    slug.distractionFor = 0
    this.onEvent?.({ type: "dell_retired", slugId: slug.id })
  }

  private findAttackTarget(slug: GameSlug): GamePumpkin | null {
    let best: GamePumpkin | null = null
    let bestX = -Infinity
    for (const p of this.pumpkins) {
      if (p.health <= 0) continue
      if (laneForY(p.y) !== slug.lane) continue
      if (Math.hypot(p.x - slug.x, p.y - slug.y) <= p.radius + slug.radius) {
        if (p.x > bestX) {
          bestX = p.x
          best = p
        }
      }
    }
    return best
  }

  private updatePumpkins(dt: number) {
    for (const pumpkin of this.pumpkins) {
      if (pumpkin.health <= 0 || !Number.isFinite(pumpkin.fireInterval)) continue
      // Stay cocked while nothing is in range so the first shot fires the
      // moment a target appears — Gwynevere reacts across its whole row.
      if (!this.pumpkinHasTarget(pumpkin)) {
        pumpkin.fireTimer = pumpkin.fireInterval
        continue
      }
      pumpkin.fireTimer += dt
      while (pumpkin.fireTimer >= pumpkin.fireInterval) {
        pumpkin.fireTimer -= pumpkin.fireInterval
        this.firePumpkin(pumpkin)
      }
    }
  }

  private pumpkinHasTarget(pumpkin: GamePumpkin): boolean {
    if (pumpkin.type === "gwynevere") {
      return this.slugs.some((s) => laneForY(s.y) === laneForY(pumpkin.y))
    }
    if (pumpkin.type === "herbert") {
      // Herbert is a pure healer: only damaged non-Herbert allies count.
      // No self-heal, no Herbert-to-Herbert healing (balance), never slugs.
      return this.pumpkins.some(
        (p) =>
          p.id !== pumpkin.id && p.type !== "herbert" && p.health > 0 && p.health < p.maxHealth,
      )
    }
    return this.nearestSlugOnLane(pumpkin) !== null
  }

  // Cramer produces seeds (coins) on its level's coin tick.
  // Diminishing returns: the nth alive cramer works at 1/2^(n-1) rate.
  // Infinite money printers are a bug, not a strategy.
  private updateCramers(dt: number) {
    let seen = 0
    for (const pumpkin of this.pumpkins) {
      if (pumpkin.type !== "cramer" || pumpkin.health <= 0) continue
      const stats = levelStatsFor(pumpkin.type, pumpkin.level, this.config)
      const interval =
        stats?.coin_interval_s ?? this.config.pumpkins["cramer"]?.coin_interval_s ?? 0
      const amount = stats?.coins_per_tick ?? this.config.pumpkins["cramer"]?.coins_per_tick ?? 0
      if (interval <= 0 || amount <= 0) continue
      const rate = 1 / Math.pow(2, seen)
      seen++
      pumpkin.coinTimer += dt * rate
      while (pumpkin.coinTimer >= interval) {
        pumpkin.coinTimer -= interval
        this.addCoins(amount)
        this.onEvent?.({ type: "cramer_produce", pumpkinId: pumpkin.id, amount })
      }
    }
  }

  private firePumpkin(pumpkin: GamePumpkin) {
    const cfg = this.config.pumpkins[pumpkin.type]
    if (!cfg) return

    if (pumpkin.type === "gwynevere") {
      const point = this.gwynevereTarget(pumpkin)
      if (!point) return
      this.projectiles.push(
        this.makeProjectile("missile", pumpkin, point, null, pumpkin.damage, pumpkin.blastRadius),
      )
      this.onEvent?.({ type: "fire", pumpkinId: pumpkin.id })
      return
    }

    if (pumpkin.type === "herbert") {
      // Pure healer: heal the most damaged non-Herbert ally (never self,
      // never another Herbert, never slugs). No heal target → hold fire.
      let lowest: GamePumpkin | null = null
      for (const p of this.pumpkins) {
        if (p.id === pumpkin.id || p.type === "herbert") continue
        if (p.health <= 0 || p.health >= p.maxHealth) continue
        if (!lowest || p.health / p.maxHealth < lowest.health / lowest.maxHealth) lowest = p
      }
      if (lowest) {
        this.projectiles.push(
          this.makeProjectile("heal", pumpkin, null, lowest.id, pumpkin.damage, 0),
        )
        this.onEvent?.({ type: "fire", pumpkinId: pumpkin.id })
      }
      return
    }

    // Normal pumpkins shoot straight horizontally along their own lane.
    // PEARcer's seeds pierce: they pass through up to PEARCER_PIERCE slugs,
    // hitting each one once. Subtlety is for pumpkins that can't aim.
    const target = this.nearestSlugOnLane(pumpkin)
    if (!target) return
    this.projectiles.push(
      this.makeProjectile(
        "seed",
        pumpkin,
        null,
        null,
        pumpkin.damage,
        0,
        pumpkin.type === "pearcer" ? PEARCER_PIERCE : 0,
      ),
    )
    this.onEvent?.({ type: "fire", pumpkinId: pumpkin.id })
  }

  private makeProjectile(
    kind: GameProjectile["kind"],
    pumpkin: GamePumpkin,
    targetPoint: { x: number; y: number } | null,
    targetId: number | null,
    damage: number,
    blastRadius: number,
    pierce = 0,
  ): GameProjectile {
    let vx = 0
    const vy = 0
    let arcStart: { x: number; y: number } | null = null
    let arcPeak = 0
    if (kind === "seed") {
      vx = pumpkin.projectileSpeed
    } else if (kind === "missile" && targetPoint) {
      const dist = Math.max(targetPoint.x - pumpkin.x, 1)
      vx = pumpkin.projectileSpeed
      arcStart = { x: pumpkin.x, y: pumpkin.y }
      arcPeak = Math.min(dist, 240) * 0.25
    }
    return {
      id: this.nextId++,
      kind,
      x: pumpkin.x,
      y: pumpkin.y,
      vx,
      vy,
      speed: pumpkin.projectileSpeed,
      damage,
      radius: kind === "missile" ? 6 : 4,
      targetId,
      targetPoint,
      arcStart,
      arcPeak,
      blastRadius,
      sourcePumpkinId: pumpkin.id,
      life: 2,
      dead: false,
      pierce,
      hitIds: [],
    }
  }

  private nearestSlugOnLane(pumpkin: GamePumpkin): GameSlug | null {
    let best: GameSlug | null = null
    let bestDist = Infinity
    for (const s of this.slugs) {
      if (s.health <= 0) continue
      if (laneForY(s.y) !== laneForY(pumpkin.y)) continue
      if (s.x <= pumpkin.x) continue
      const d = s.x - pumpkin.x
      if (d < bestDist) {
        bestDist = d
        best = s
      }
    }
    return best
  }

  private gwynevereTarget(pumpkin: GamePumpkin): { x: number; y: number } | null {
    const laneY = laneCenterY(laneForY(pumpkin.y))
    const laneSlugs = this.slugs.filter((s) => laneForY(s.y) === laneForY(pumpkin.y))
    if (laneSlugs.length === 0) return null
    const v = pumpkin.projectileSpeed
    if (v <= 0) return null
    const x0 = pumpkin.x

    // Landing point where a missile launched from the pumpkin would intercept a
    // slug (slug crawls toward the pumpkin while the missile flies toward it).
    // This keeps far-away slugs in range — the point is where their paths meet.
    const interceptFor = (slug: GameSlug): number => {
      const w = slug.distractionFor > 0 ? slug.speed : -slug.speed
      const t = (slug.x - x0) / (v - w)
      const l = t > 0 && Number.isFinite(t) ? x0 + v * t : slug.x
      return Math.max(x0 + 1, Math.min(this.width, l))
    }

    let bestPoint: { x: number; y: number } | null = null
    let bestCount = 0
    const blast = pumpkin.blastRadius || GWYN_BLAST_RADIUS
    for (const slug of laneSlugs) {
      const lx = interceptFor(slug)
      const arrival = (lx - x0) / v
      let count = 0
      for (const s of laneSlugs) {
        const w = s.distractionFor > 0 ? s.speed : -s.speed
        const sx = s.x + w * arrival
        if (Math.abs(sx - lx) <= blast) count++
      }
      if (count > bestCount) {
        bestCount = count
        bestPoint = { x: lx, y: laneY }
      }
    }
    return bestPoint
  }

  private updateProjectiles(dt: number) {
    for (const proj of this.projectiles) {
      if (proj.dead) continue

      // Heal projectiles home to a living pumpkin.
      if (proj.kind === "heal") {
        const target = this.pumpkins.find((p) => p.id === proj.targetId && p.health > 0)
        if (target) {
          this.homingStep(proj, target.x, target.y, dt)
          if (Math.hypot(proj.x - target.x, proj.y - target.y) <= proj.radius + target.radius) {
            target.health = Math.min(target.maxHealth, target.health + proj.damage)
            proj.dead = true
          }
        } else {
          // Heal target gone — coast a moment, then fade.
          proj.life -= dt
          if (proj.life <= 0) proj.dead = true
          else this.coast(proj, dt)
        }
        continue
      }

      // Gwynevere missiles follow a parabolic arc to a fixed landing point.
      if (proj.kind === "missile") {
        if (proj.targetPoint && proj.arcStart) {
          const dist = Math.max(proj.targetPoint.x - proj.arcStart.x, 1)
          proj.x += proj.vx * dt
          const u = Math.max(0, Math.min(1, (proj.x - proj.arcStart.x) / dist))
          proj.y = proj.arcStart.y - 4 * proj.arcPeak * u * (1 - u)
          if (u >= 1) {
            proj.dead = true
            this.explodeAt(proj.x, proj.y, proj.blastRadius, proj.damage, "pumpkin")
          }
        } else {
          this.coast(proj, dt)
        }
        continue
      }

      // Seeds fly straight horizontally along their lane.
      this.coast(proj, dt)

      // Collision vs any slug — a seed damages the first slug it reaches,
      // unless it pierces (pearcer): then it keeps going, one hit per slug.
      // Shielded slugs swallow the hit either way (see damageSlug).
      let hit = false
      for (const slug of this.slugs) {
        if (Math.hypot(proj.x - slug.x, proj.y - slug.y) <= proj.radius + slug.radius) {
          if (proj.pierce > 0 && !proj.hitIds.includes(slug.id)) {
            proj.hitIds.push(slug.id)
            proj.pierce--
            this.damageSlug(slug, proj.damage, "pumpkin")
            continue
          }
          if (proj.pierce > 0) continue // already tagged this one — fly through
          this.damageSlug(slug, proj.damage, "pumpkin")
          hit = true
          break
        }
      }
      if (hit) {
        proj.dead = true
        continue
      }

      // Seeds are only removed on a slug hit or when they leave the field.
      if (proj.x < -60 || proj.x > this.width + 60 || proj.y < -60 || proj.y > FIELD_HEIGHT + 60) {
        proj.dead = true
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead)
  }

  private coast(proj: GameProjectile, dt: number) {
    proj.x += proj.vx * dt
    proj.y += proj.vy * dt
  }

  private homingStep(proj: GameProjectile, tx: number, ty: number, dt: number) {
    const dx = tx - proj.x
    const dy = ty - proj.y
    const dist = Math.hypot(dx, dy) || 1
    proj.vx = (dx / dist) * proj.speed
    proj.vy = (dy / dist) * proj.speed
    proj.x += proj.vx * dt
    proj.y += proj.vy * dt
  }

  private explodeAt(x: number, y: number, radius: number, damage: number, source: KillSource) {
    for (const slug of [...this.slugs]) {
      if (Math.hypot(slug.x - x, slug.y - y) <= radius) {
        this.damageSlug(slug, damage, source)
      }
    }
  }

  private updateGrenades(dt: number) {
    for (const grenade of this.grenades) {
      grenade.fuse -= dt
      if (grenade.fuse <= 0) {
        this.explodeAt(grenade.x, grenade.y, grenade.blastRadius, grenade.damage, "holy_grenade")
      }
    }
    this.grenades = this.grenades.filter((g) => g.fuse > 0)
  }

  private updateBeerCups(dt: number) {
    for (const cup of this.beerCups) cup.duration -= dt
    this.beerCups = this.beerCups.filter((c) => c.duration > 0)
  }

  private updateSaltLines(dt: number) {
    for (const line of this.saltLines) line.duration -= dt
    this.saltLines = this.saltLines.filter((l) => l.duration > 0)
  }

  private updateThornPatches(dt: number) {
    for (const patch of this.thornPatches) {
      patch.duration -= dt
      if (patch.duration <= 0) continue
      // Same x-footprint check as salt (all lanes). Snapshot iteration +
      // health guard: damageSlug → killSlug swaps this.slugs, and overlapping
      // patches could otherwise double-kill a slug in one tick.
      for (const slug of [...this.slugs]) {
        if (slug.health <= 0) continue
        if (Math.abs(slug.x - patch.x) <= patch.width / 2 + slug.radius) {
          this.damageSlug(slug, THORN_DPS * dt, "thorn_patch")
        }
      }
    }
    this.thornPatches = this.thornPatches.filter((p) => p.duration > 0)
  }

  private updateTailwind(dt: number) {
    if (this.tailwindTimer <= 0) return
    this.tailwindTimer -= dt
    if (this.tailwindTimer > 0) return
    for (const id of this.tailwindIds) {
      const p = this.pumpkins.find((pp) => pp.id === id)
      if (!p || p.health <= 0) continue
      p.fireRateMul /= TAILWIND_MUL
      p.fireInterval *= TAILWIND_MUL
      p.fireTimer = Math.min(p.fireTimer, p.fireInterval)
    }
    this.tailwindIds.clear()
  }

  // ---- Kills / scoring ---------------------------------------------------

  private killSlug(slug: GameSlug, source: KillSource) {
    slug.health = 0
    this.kills.push({ type: slug.type, x: slug.x, source })
    this.score += this.killScore(slug, source)
    this.addCoins(this.config.slugs[slug.type]?.kill_reward ?? 0)
    // XP is granted for every kill regardless of source — including
    // Dell-spawned Marvins, which flow through here like any other kill.
    const xp = this.config.slugs[slug.type]?.xp_reward ?? 0
    if (xp > 0) {
      this.xp += xp
      this.xpEarned += xp
    }
    this.slugs = this.slugs.filter((s) => s.id !== slug.id)
    this.onEvent?.({
      type: "slug_destroyed",
      slugId: slug.id,
      slugType: slug.type,
      x: slug.x,
      y: slug.y,
      source,
    })
  }

  private killScore(slug: GameSlug, source: KillSource): number {
    const cfg = this.config.slugs[slug.type]
    const points = cfg?.reward_points ?? 0
    const abilities = this.config.abilities
    switch (source) {
      case "pumpkin":
        return Math.round(points * this.proximityFactor(slug.x))
      case "annihilation":
        return Math.round(points * ((abilities.annihilation?.score ?? 70) / 100))
      case "holy_grenade":
        return Math.round(points * ((abilities.holy_grenade?.score ?? 80) / 100))
      case "beer":
        return abilities.beer?.score ?? 0
      case "salt_line":
        return abilities.salt_line?.score ?? 0
      case "thorn_patch":
        return Math.round(points * ((abilities.thorn_patch?.score ?? 80) / 100))
      default:
        return points
    }
  }

  private proximityFactor(x: number): number {
    let factor = 1
    for (const t of this.config.proximity) {
      if (x >= t.min_x) {
        factor = t.factor
        break
      }
    }
    return factor
  }

  // ---- End conditions ----------------------------------------------------

  private checkRoundEnd() {
    if (this.spawnQueue.length === 0 && this.slugs.length === 0) {
      this.completeRound()
    }
  }

  private checkGameOver() {
    if (this.pumpkins.length > 0 && this.pumpkins.every((p) => p.health <= 0)) {
      this.phase = "gameover"
      this.gameOverReason = "All pumpkins were destroyed"
      this.clearInteraction()
    }
  }

  // ---- Report ------------------------------------------------------------

  buildReport(isIncomplete: boolean) {
    return {
      spawned_pumpkins: { ...this.spawnedPumpkins },
      kills: this.kills.map((k) => ({ ...k })),
      used_items: { ...this.usedItems },
      completed_rounds: this.completedRounds,
      score: this.score,
      coins_earned: this.coinsEarned,
      coins_spent: this.coinsSpent,
      xp_earned: this.xpEarned,
      is_incomplete: isIncomplete,
    }
  }

  get wasReportSubmitted(): boolean {
    return this.reportSubmitted
  }

  markReportSubmitted() {
    this.reportSubmitted = true
  }
}
