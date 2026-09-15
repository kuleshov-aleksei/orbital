import type { HalloweenGameConfig } from "@/halloween/types"
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
import { ABILITY_META, INVENTORY_CAPACITY, buildCardOffer, spawnTableForRound } from "./balance"

export type GameEvent = "shooting" | "slug_destroyed" | "pumpkin_destroyed" | "item_used"

export const FIELD_HEIGHT = 600
const PUMPKIN_RADIUS = 28
const SLUG_RADII: Record<SlugType, number> = {
  scout: 10,
  marvin: 14,
  gerald: 26,
  dell: 16,
}
const PUMPKIN_MIN_X = 40
const PUMPKIN_MAX_X = 520
const SLUG_ATTACK_INTERVAL = 3
const DELL_SPAWN_INTERVAL = 5
const DISTRACTION_DURATION = 5
const FREEZE_DURATION = 5
const GRENADE_FUSE = 3
const GRENADE_RADIUS = 300
const GRENADE_DAMAGE = 50
const BEER_RADIUS = 70
const BEER_DURATION = 30
const SALT_DURATION = 30
const SALT_WIDTH = 14
const SALT_TICK = 5
const SALT_DAMAGE = 1
const GWYN_BLAST_RADIUS = 70

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
  selectedPumpkinId: number | null = null
  prompt: string | null = null
  gameOverReason: string | null = null

  private spawnQueue: SlugType[] = []
  private spawnTimer = 0

  private nextId = 1
  private reportSubmitted = false

  onEvent: ((event: GameEvent) => void) | null = null

  constructor(config: HalloweenGameConfig) {
    this.config = config
    this.width = config.battlefield_length
    this.inventory.push({ kind: "pumpkin", pumpkinType: "ferdinand" })
    this.inventory.push({ kind: "pumpkin", pumpkinType: "ferdinand" })
    this.startRound(1)
  }

  snapshot(): GameSnapshot {
    return {
      phase: this.phase,
      round: this.round,
      completedRounds: this.completedRounds,
      score: this.score,
      inventory: this.inventory.map((i) => ({ ...i })),
      cards: this.cards,
      popupIndex: this.popupIndex,
      popupTotal: this.popupTotal,
      mode: this.mode,
      selectedPumpkinId: this.selectedPumpkinId,
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

  // ---- Rounds ------------------------------------------------------------

  private startRound(round: number) {
    this.round = round
    const table = spawnTableForRound(round)
    this.spawnQueue = []
    for (const type of Object.keys(table.pool) as SlugType[]) {
      for (let i = 0; i < table.pool[type]; i++) this.spawnQueue.push(type)
    }
    // Random spawn order
    for (let i = this.spawnQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
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
    this.cards = { cards: buildCardOffer() }
    this.phase = "cards"
    this.prompt = null
    this.selectedPumpkinId = null
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
      this.cards = { cards: buildCardOffer() }
    }
  }

  private addInventoryItem(item: GameInventoryItem) {
    if (this.inventory.length >= INVENTORY_CAPACITY) {
      this.inventory.shift()
    }
    this.inventory.push(item)
  }

  // ---- Input -------------------------------------------------------------

  // Manual targeting: while a pumpkin is selected the override follows the
  // user's cursor. Clicking the pumpkin again clears it back to autotarget.
  setSelectedTarget(x: number, y: number) {
    if (this.mode !== "target-override" || this.selectedPumpkinId == null) return
    const pumpkin = this.pumpkins.find((p) => p.id === this.selectedPumpkinId && p.health > 0)
    if (pumpkin) pumpkin.override = { x, y }
  }

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
      case "target-override": {
        const pumpkin = this.findPumpkinAt(x, y)
        if (pumpkin) {
          if (pumpkin.id === this.selectedPumpkinId) {
            pumpkin.override = null
            this.selectedPumpkinId = null
            this.mode = "none"
            this.prompt = "Autotarget restored"
          } else {
            this.selectedPumpkinId = pumpkin.id
            this.prompt =
              "Aiming follows your cursor — click this pumpkin again to restore autotarget"
          }
        }
        break
      }
      case "none": {
        const pumpkin = this.findPumpkinAt(x, y)
        if (pumpkin) {
          this.selectedPumpkinId = pumpkin.id
          this.mode = "target-override"
          this.prompt =
            "Aiming follows your cursor — click this pumpkin again to restore autotarget"
        }
        break
      }
    }
  }

  private tryPlacePumpkinFromInventory(x: number, y: number) {
    const item = this.inventory.find((i) => i.kind === "pumpkin")
    if (!item || item.kind !== "pumpkin") {
      this.clearInteraction()
      return
    }
    if (
      x < PUMPKIN_MIN_X ||
      x > PUMPKIN_MAX_X ||
      y < PUMPKIN_RADIUS ||
      y > FIELD_HEIGHT - PUMPKIN_RADIUS
    ) {
      this.prompt = "Pumpkins can only be placed on the left side of the battlefield"
      return
    }
    const index = this.inventory.indexOf(item)
    this.spawnPumpkin(item.pumpkinType, x, y)
    this.consumeInventoryItem(index)
    this.clearInteraction()
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
      override: null,
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
      acidTick: 0,
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
      case "genocide":
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
      const variation = this.speedVariationForRound(this.round)
      const speedMul = 1 + (Math.random() * 2 - 1) * variation
      this.spawnSlug(type, this.width + 20, 40 + Math.random() * (FIELD_HEIGHT - 80), speedMul)
      this.spawnTimer = spawnTableForRound(this.round).interval
    }
  }

  private speedVariationForRound(round: number): number {
    if (round <= 4) return [0.01, 0.02, 0.04, 0.04][round - 1]
    return 0.04
  }

  private updateSlugs(dt: number) {
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
          this.spawnSlug("marvin", slug.x + 10, slug.y + (Math.random() * 40 - 20))
        }
        continue
      }

      // Attack the pumpkin we've reached.
      const attacked = this.findAttackTarget(slug)
      if (attacked) {
        slug.attackingPumpkinId = attacked.id
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

      // Beer attraction: slugs behind a cup are lured toward it.
      let moveDir = direction
      for (const cup of this.beerCups) {
        if (cup.attracted.has(slug.id)) continue
        if (slug.x > cup.x && Math.abs(slug.x - cup.x) < 200) {
          if (Math.hypot(slug.x - cup.x, slug.y - cup.y) <= cup.radius + slug.radius) {
            slug.health -= 1
            cup.attracted.add(slug.id)
            if (slug.health <= 0) {
              this.killSlug(slug, "beer")
            }
            continue
          }
          moveDir = slug.x > cup.x ? -1 : 1
        }
      }

      // Once a slug enters the pumpkin placement area it picks the nearest
      // pumpkin and steers toward it so it attacks instead of walking past.
      if (slug.distractionFor <= 0 && slug.x < 620) {
        const pursuit = this.nearestPumpkin(slug)
        if (pursuit) {
          const dy = pursuit.y - slug.y
          slug.y += Math.sign(dy) * Math.min(Math.abs(dy), slug.speed * 0.7 * dt)
        }
      }

      slug.x += slug.speed * moveDir * dt
      if (slug.x < 0) slug.x = 0

      // Genocide salt line damage.
      for (const line of this.saltLines) {
        if (Math.abs(slug.x - line.x) <= line.width / 2 + slug.radius) {
          slug.acidTick += dt
          if (slug.acidTick >= SALT_TICK) {
            slug.acidTick = 0
            slug.health -= SALT_DAMAGE
            if (slug.health <= 0) {
              this.killSlug(slug, "genocide")
            }
          }
        }
      }
    }
  }

  private findAttackTarget(slug: GameSlug): GamePumpkin | null {
    for (const p of this.pumpkins) {
      if (p.health <= 0) continue
      const dist = Math.hypot(p.x - slug.x, p.y - slug.y)
      if (dist <= p.radius + slug.radius) return p
    }
    return null
  }

  private nearestPumpkin(slug: GameSlug): GamePumpkin | null {
    let best: GamePumpkin | null = null
    let bestDist = Infinity
    for (const p of this.pumpkins) {
      if (p.health <= 0) continue
      const d = Math.hypot(p.x - slug.x, p.y - slug.y)
      if (d < bestDist) {
        bestDist = d
        best = p
      }
    }
    return best
  }

  private updatePumpkins(dt: number) {
    for (const pumpkin of this.pumpkins) {
      if (pumpkin.health <= 0 || !Number.isFinite(pumpkin.fireInterval)) continue
      pumpkin.fireTimer += dt
      while (pumpkin.fireTimer >= pumpkin.fireInterval) {
        pumpkin.fireTimer -= pumpkin.fireInterval
        this.firePumpkin(pumpkin)
      }
    }
  }

  private firePumpkin(pumpkin: GamePumpkin) {
    const cfg = this.config.pumpkins[pumpkin.type]
    if (!cfg) return

    if (pumpkin.type === "gwynevere") {
      const point = pumpkin.override ?? this.gwynevereTarget()
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

    const target = this.nearestSlug(pumpkin)
    if (!target) return
    if (pumpkin.override) {
      this.projectiles.push(
        this.makeProjectile("seed", pumpkin, pumpkin.override, null, cfg.damage_per_shot, 0),
      )
    } else {
      this.projectiles.push(
        this.makeProjectile("seed", pumpkin, null, target.id, cfg.damage_per_shot, 0),
      )
    }
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
    // Manual override fires along the pumpkin→point direction as a vector.
    const dirX = targetPoint ? targetPoint.x - pumpkin.x : 1
    const dirY = targetPoint ? targetPoint.y - pumpkin.y : 0
    const dirLen = Math.hypot(dirX, dirY) || 1
    return {
      id: this.nextId++,
      kind,
      x: pumpkin.x,
      y: pumpkin.y,
      vx: (dirX / dirLen) * pumpkin.projectileSpeed,
      vy: (dirY / dirLen) * pumpkin.projectileSpeed,
      speed: pumpkin.projectileSpeed,
      damage,
      radius: kind === "missile" ? 6 : 4,
      targetId,
      targetPoint,
      override: pumpkin.override,
      blastRadius,
      sourcePumpkinId: pumpkin.id,
      life: 2,
      dead: false,
    }
  }

  private nearestSlug(pumpkin: GamePumpkin): GameSlug | null {
    let best: GameSlug | null = null
    let bestDist = Infinity
    for (const s of this.slugs) {
      if (s.health <= 0) continue
      const d = Math.hypot(s.x - pumpkin.x, s.y - pumpkin.y)
      if (d < bestDist) {
        bestDist = d
        best = s
      }
    }
    return best
  }

  private gwynevereTarget(): { x: number; y: number } | null {
    if (this.slugs.length === 0) return null
    let bestPoint: { x: number; y: number } | null = null
    let bestCount = 0
    for (const slug of this.slugs) {
      const flightTime = Math.hypot(slug.x - 100, slug.y) / 40 || 1
      const px = slug.x + (slug.distractionFor > 0 ? 1 : -1) * slug.speed * flightTime
      const point = { x: px, y: slug.y }
      let count = 0
      for (const s of this.slugs) {
        const t = Math.hypot(s.x - 100, s.y) / 40 || 1
        const sx = s.x + (s.distractionFor > 0 ? 1 : -1) * s.speed * t
        if (Math.hypot(sx - point.x, s.y - point.y) <= GWYN_BLAST_RADIUS) count++
      }
      if (count > bestCount) {
        bestCount = count
        bestPoint = point
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

      // Gwynevere missiles fly to a fixed point and explode on arrival.
      if (proj.kind === "missile") {
        if (proj.targetPoint) {
          this.homingStep(proj, proj.targetPoint.x, proj.targetPoint.y, dt)
          if (
            Math.hypot(proj.x - proj.targetPoint.x, proj.y - proj.targetPoint.y) <=
            proj.radius + 4
          ) {
            proj.dead = true
            this.explodeAt(proj.x, proj.y, proj.blastRadius, proj.damage, "pumpkin")
          }
        } else {
          this.coast(proj, dt)
        }
        continue
      }

      // Seeds home to their target slug; if it dies mid-flight they keep going.
      if (proj.targetId != null) {
        const target = this.slugs.find((s) => s.id === proj.targetId && s.health > 0)
        if (target) this.homingStep(proj, target.x, target.y, dt)
        else {
          proj.targetId = null
          this.coast(proj, dt)
        }
      } else {
        // Manual override seeds (targetPoint) fly straight along their vector.
        this.coast(proj, dt)
      }

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
        return abilities.beer?.score ?? 500
      case "genocide":
        return abilities.genocide?.score ?? 10
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
