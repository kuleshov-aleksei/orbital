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
  KillSource,
  PumpkinType,
  SlugType,
} from "./types"
import {
  ABILITY_META,
  INVENTORY_CAPACITY,
  buildCardOffer,
  resolveSpawnTable,
  speedVariationForRound,
  startingPumpkinsForConfig,
} from "./balance"
import type { RandomFn } from "./balance"

export type GameEvent = "shooting" | "slug_destroyed" | "pumpkin_destroyed" | "item_used"

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
const DISTRACTION_DURATION = 5
const FREEZE_DURATION = 5
const GRENADE_FUSE = 3
const GRENADE_RADIUS = 300
const GRENADE_DAMAGE = 50
const BEER_RADIUS = 70
const BEER_DURATION = 30
const BEER_ATTRACT_RANGE = 200
const BEER_SLOW = 0.1 // permanent slow applied when a slug reaches the cup
const SALT_DURATION = 30
const SALT_WIDTH = 60
const SALT_SLOW = 0.3 // slow applied while a slug steps on the line
const GWYN_BLAST_RADIUS = 70
// Shop inflation: each shop purchase of a type raises its future price as
// floor(base * 1.15^n), capped at 5x base. Counters snowballing (mass
// Ferdinand spam) while keeping the first few buys affordable. Refunds stay
// tied to the base cost so selling can never profit from inflation.
export const SHOP_PRICE_GROWTH = 1.15
export const SHOP_PRICE_CAP_MULT = 5

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
  // Shop purchases per pumpkin type — drives rising shop prices.
  private purchaseCounts: Record<string, number> = {}

  pumpkins: GamePumpkin[] = []
  slugs: GameSlug[] = []
  projectiles: GameProjectile[] = []
  grenades: GameGrenade[] = []
  beerCups: GameBeerCup[] = []
  saltLines: GameSaltLine[] = []

  inventory: GameInventoryItem[] = []
  private kills: GameKill[] = []
  private usedItems: Record<string, number> = {}
  private spawnedPumpkins: Record<string, number> = {}

  private cards: CardOffer | null = null
  private popupIndex = 0
  private popupTotal = 0

  mode: GameInputMode = "none"
  private pendingAbility: PendingAbility | null = null
  hoveredPumpkinId: number | null = null
  prompt: string | null = null
  gameOverReason: string | null = null

  private spawnQueue: SlugType[] = []
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
      shopPrices: this.shopPrices(),
      inventory: this.inventory.map((i) => ({ ...i })),
      cards: this.cards,
      popupIndex: this.popupIndex,
      popupTotal: this.popupTotal,
      mode: this.mode,
      pendingAbility: this.pendingAbility?.abilityId ?? null,
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
      for (let i = 0; i < table.pool[type]; i++) this.spawnQueue.push(type)
    }
    // Random spawn order
    for (let i = this.spawnQueue.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1))
      ;[this.spawnQueue[i], this.spawnQueue[j]] = [this.spawnQueue[j], this.spawnQueue[i]]
    }
    this.spawnTimer = table.interval
    this.prompt = `Round ${round} — ${this.spawnQueue.length} slugs incoming`
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
    this.onEvent?.("item_used")
    if (this.alivePumpkinCount() === 0) {
      this.phase = "gameover"
      this.gameOverReason = "All pumpkins were sold"
    }
    return true
  }

  // ---- Input -------------------------------------------------------------

  selectInventoryItem(index: number) {
    const item = this.inventory[index]
    if (!item || this.phase !== "playing") return

    // Clicking a slot while aiming cancels the current placement and reselects.
    if (this.mode !== "none") {
      this.clearInteraction()
    }

    if (item.kind === "pumpkin") {
      this.mode = "place-pumpkin"
      this.prompt = `Click the battlefield to place a ${item.pumpkinType} pumpkin`
    } else {
      const meta = ABILITY_META[item.abilityId]
      if (meta.target === "none") {
        this.applyInstantAbility(item.abilityId)
        this.consumeInventoryItem(index)
      } else {
        this.pendingAbility = { abilityId: item.abilityId }
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
    const item = this.inventory.find((i) => i.kind === "pumpkin")
    if (!item || item.kind !== "pumpkin") {
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
    const index = this.inventory.indexOf(item)
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
    const cfg = this.config.pumpkins[type]
    const health = cfg?.health ?? 10
    this.pumpkins.push({
      id: this.nextId++,
      type,
      x,
      y,
      health,
      maxHealth: health,
      radius: PUMPKIN_RADIUS,
      fireTimer: 0,
      fireInterval: cfg?.fire_rate && cfg.fire_rate > 0 ? 1 / cfg.fire_rate : Infinity,
      damage: cfg?.damage_per_shot ?? 0,
      projectileSpeed: cfg?.projectile_speed ?? 0,
      fireRateMul: 1,
      coinTimer: 0,
    })
    this.spawnedPumpkins[type] = (this.spawnedPumpkins[type] ?? 0) + 1
  }

  private spawnSlug(type: SlugType, x: number, y: number, speedMul = 1) {
    const cfg = this.config.slugs[type]
    this.slugs.push({
      id: this.nextId++,
      type,
      x,
      y,
      lane: laneForY(y),
      health: cfg?.health ?? 10,
      maxHealth: cfg?.health ?? 10,
      speed: (cfg?.speed ?? 0) * speedMul,
      damage: cfg?.damage_to_pumpkin ?? 0,
      rewardPoints: cfg?.reward_points ?? 0,
      radius: SLUG_RADII[type],
      attackTimer: 0,
      attackingPumpkinId: null,
      direction: -1,
      frozenFor: 0,
      distractionFor: 0,
      spawnTimer: 0,
    })
  }

  // ---- Abilities ---------------------------------------------------------

  private applyInstantAbility(abilityId: AbilityId) {
    this.trackUse(abilityId)
    this.onEvent?.("item_used")
    switch (abilityId) {
      case "annihilation": {
        const target = [...this.slugs].sort((a, b) => b.health - a.health)[0]
        if (target) this.killSlug(target, "annihilation")
        break
      }
      case "freeze":
        for (const s of this.slugs) s.frozenFor = FREEZE_DURATION
        break
      case "distraction":
        for (const s of this.slugs) {
          if (s.speed > 0) s.distractionFor = DISTRACTION_DURATION
        }
        break
      default:
        break
    }
  }

  private applyPointAbility(x: number, y: number) {
    const abilityId = this.pendingAbility?.abilityId
    if (!abilityId) return
    this.trackUse(abilityId)
    this.onEvent?.("item_used")

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
          radius: BEER_RADIUS,
          attracted: new Set(),
        })
        break
      case "salt_line":
        this.saltLines.push({ id: this.nextId++, x, duration: SALT_DURATION, width: SALT_WIDTH })
        break
      default:
        break
    }

    const item = this.inventory.find((i) => i.kind === "ability" && i.abilityId === abilityId)
    if (item) this.consumeInventoryItem(this.inventory.indexOf(item))
    this.clearInteraction()
  }

  private applyPumpkinAbility(pumpkinId: number) {
    const abilityId = this.pendingAbility?.abilityId
    if (!abilityId) return
    const pumpkin = this.pumpkins.find((p) => p.id === pumpkinId)
    if (!pumpkin || pumpkin.health <= 0) return

    this.trackUse(abilityId)
    this.onEvent?.("item_used")

    if (abilityId === "do_not_stop_daddy") {
      pumpkin.fireRateMul *= 2
      pumpkin.fireInterval /= 2
    } else if (abilityId === "wide_pumpkin") {
      pumpkin.maxHealth *= 2
      pumpkin.health += pumpkin.maxHealth / 2
    }

    const item = this.inventory.find((i) => i.kind === "ability" && i.abilityId === abilityId)
    if (item) this.consumeInventoryItem(this.inventory.indexOf(item))
    this.clearInteraction()
  }

  private consumeInventoryItem(index: number) {
    this.inventory.splice(index, 1)
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

    if (this.phase === "playing") this.checkRoundEnd()
    if (this.phase === "playing") this.checkGameOver()
  }

  private updateSlugSpawns(dt: number) {
    if (this.spawnQueue.length === 0) return
    this.spawnTimer -= dt
    if (this.spawnTimer <= 0) {
      const type = this.spawnQueue.shift()!
      const variation = speedVariationForRound(this.round, this.config)
      const speedMul = 1 + (this.rng() * 2 - 1) * variation
      const lanes = this.activeLanes()
      const lane = lanes[Math.floor(this.rng() * lanes.length)]
      this.spawnSlug(type, this.width + 20, laneCenterY(lane), speedMul)
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
      if (slug.distractionFor > 0) slug.distractionFor -= dt

      const direction = slug.distractionFor > 0 ? 1 : -1

      // Dr. Dell Conagher doesn't move; spawns Marvins.
      if (slug.type === "dell" && slug.health > 0) {
        slug.spawnTimer += dt
        if (slug.spawnTimer >= DELL_SPAWN_INTERVAL) {
          slug.spawnTimer = 0
          this.spawnSlug("marvin", slug.x + 10, slug.y)
        }
        continue
      }

      // Attack the pumpkin we've reached on our lane.
      const attacked = this.findAttackTarget(slug)
      if (attacked) {
        const justEngaged = slug.attackingPumpkinId !== attacked.id
        slug.attackingPumpkinId = attacked.id
        if (justEngaged) {
          // First bite lands immediately; subsequent bites every interval.
          slug.attackTimer = SLUG_ATTACK_INTERVAL
        }
        slug.attackTimer += dt
        if (slug.attackTimer >= SLUG_ATTACK_INTERVAL) {
          slug.attackTimer = 0
          attacked.health -= slug.damage
          if (attacked.health <= 0) {
            this.onEvent?.("pumpkin_destroyed")
          }
        }
        continue
      }

      slug.attackingPumpkinId = null

      // Beer attraction: slugs behind a cup are lured toward it; reaching it
      // permanently slows the slug by 10%.
      let moveDir = direction
      for (const cup of this.beerCups) {
        if (cup.attracted.has(slug.id)) continue
        if (slug.x > cup.x && Math.abs(slug.x - cup.x) < BEER_ATTRACT_RANGE) {
          if (Math.hypot(slug.x - cup.x, slug.y - cup.y) <= cup.radius + slug.radius) {
            slug.speed *= 1 - BEER_SLOW
            cup.attracted.add(slug.id)
            continue
          }
          moveDir = slug.x > cup.x ? -1 : 1
        }
      }

      // Salt line: slugs stepping on the line move 30% slower.
      let moveSpeed = slug.speed
      for (const line of this.saltLines) {
        if (Math.abs(slug.x - line.x) <= line.width / 2 + slug.radius) {
          moveSpeed *= 1 - SALT_SLOW
        }
      }
      slug.x += moveSpeed * moveDir * dt

      // Reaching the left border punishes the player: the slug deals its full
      // damage to every pumpkin, then escapes without a reward.
      if (slug.x < -slug.radius) {
        for (const p of this.pumpkins) {
          if (p.health <= 0) continue
          p.health -= slug.damage
          if (p.health <= 0) this.onEvent?.("pumpkin_destroyed")
        }
        escaped.push(slug.id)
        continue
      }
    }
    if (escaped.length > 0) {
      this.slugs = this.slugs.filter((s) => !escaped.includes(s.id))
    }
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
      return (
        this.pumpkins.some((p) => p.health > 0 && p.health < p.maxHealth) ||
        this.nearestSlugOnLane(pumpkin) !== null
      )
    }
    return this.nearestSlugOnLane(pumpkin) !== null
  }

  // Cramer produces seeds (coins) every coin_interval_s seconds.
  private updateCramers(dt: number) {
    for (const pumpkin of this.pumpkins) {
      if (pumpkin.type !== "cramer" || pumpkin.health <= 0) continue
      const cfg = this.config.pumpkins["cramer"]
      const interval = cfg?.coin_interval_s ?? 0
      const amount = cfg?.coins_per_tick ?? 0
      if (interval <= 0 || amount <= 0) continue
      pumpkin.coinTimer += dt
      while (pumpkin.coinTimer >= interval) {
        pumpkin.coinTimer -= interval
        this.addCoins(amount)
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
        this.makeProjectile(
          "missile",
          pumpkin,
          point,
          null,
          cfg.damage_per_shot,
          GWYN_BLAST_RADIUS,
        ),
      )
      this.onEvent?.("shooting")
      return
    }

    if (pumpkin.type === "herbert") {
      // Heal the most damaged pumpkin; otherwise shoot the nearest slug.
      let lowest: GamePumpkin | null = null
      for (const p of this.pumpkins) {
        if (p.health <= 0 || p.health >= p.maxHealth) continue
        if (!lowest || p.health / p.maxHealth < lowest.health / lowest.maxHealth) lowest = p
      }
      if (lowest) {
        this.projectiles.push(
          this.makeProjectile("heal", pumpkin, null, lowest.id, cfg.damage_per_shot, 0),
        )
        this.onEvent?.("shooting")
        return
      }
    }

    // Normal pumpkins shoot straight horizontally along their own lane.
    const target = this.nearestSlugOnLane(pumpkin)
    if (!target) return
    this.projectiles.push(this.makeProjectile("seed", pumpkin, null, null, cfg.damage_per_shot, 0))
    this.onEvent?.("shooting")
  }

  private makeProjectile(
    kind: GameProjectile["kind"],
    pumpkin: GamePumpkin,
    targetPoint: { x: number; y: number } | null,
    targetId: number | null,
    damage: number,
    blastRadius: number,
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
    for (const slug of laneSlugs) {
      const lx = interceptFor(slug)
      const arrival = (lx - x0) / v
      let count = 0
      for (const s of laneSlugs) {
        const w = s.distractionFor > 0 ? s.speed : -s.speed
        const sx = s.x + w * arrival
        if (Math.abs(sx - lx) <= GWYN_BLAST_RADIUS) count++
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

      // Collision vs any slug — a seed damages the first slug it reaches.
      let hit = false
      for (const slug of this.slugs) {
        if (Math.hypot(proj.x - slug.x, proj.y - slug.y) <= proj.radius + slug.radius) {
          slug.health -= proj.damage
          if (slug.health <= 0) this.killSlug(slug, "pumpkin")
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
        slug.health -= damage
        if (slug.health <= 0) this.killSlug(slug, source)
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

  // ---- Kills / scoring ---------------------------------------------------

  private killSlug(slug: GameSlug, source: KillSource) {
    slug.health = 0
    this.kills.push({ type: slug.type, x: slug.x, source })
    this.score += this.killScore(slug, source)
    this.addCoins(this.config.slugs[slug.type]?.kill_reward ?? 0)
    this.slugs = this.slugs.filter((s) => s.id !== slug.id)
    this.onEvent?.("slug_destroyed")
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
