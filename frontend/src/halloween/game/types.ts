// Game entity + state types for the Halloween mini game (Phase 3).
// Pure logic — no pixi.js imports here; the renderer consumes these.

export type PumpkinType = "ferdinand" | "chunky" | "herbert" | "gwynevere" | "cramer" | "silas"

export type SlugType = "scout" | "marvin" | "gerald" | "dell"

// Player abilities. The scoring ones (annihilation/holy_grenade) are defined
// server-side; the rest are purely mechanical.
export type AbilityId =
  | "annihilation"
  | "freeze"
  | "distraction"
  | "do_not_stop_daddy"
  | "wide_pumpkin"
  | "holy_grenade"
  | "beer"
  | "salt_line"

export type KillSource = "pumpkin" | "annihilation" | "holy_grenade" | "beer" | "salt_line"

export type GameInventoryItem =
  | {
      kind: "pumpkin"
      pumpkinType: PumpkinType
    }
  | {
      kind: "ability"
      abilityId: AbilityId
    }

export interface GamePumpkin {
  id: number
  type: PumpkinType
  x: number
  y: number
  health: number
  maxHealth: number
  radius: number
  fireTimer: number
  fireInterval: number
  damage: number
  projectileSpeed: number
  fireRateMul: number
  coinTimer: number // cramer seed production accumulator
}

export interface GameSlug {
  id: number
  type: SlugType
  x: number
  y: number
  lane: number // horizontal stripe the slug crawls along (0-based)
  health: number
  maxHealth: number
  speed: number
  damage: number
  rewardPoints: number
  radius: number
  attackTimer: number
  attackingPumpkinId: number | null
  direction: number // -1 = crawling left, +1 = reversed (distraction)
  frozenFor: number
  distractionFor: number
  spawnTimer: number // dell spawns marvins
  shields: number // shield hits remaining — each hit strips one, HP untouched
  maxShields: number // for the renderer ring; sentimentality, mostly
}

export type ProjectileKind = "seed" | "heal" | "missile"

export interface GameProjectile {
  id: number
  kind: ProjectileKind
  x: number
  y: number
  vx: number
  vy: number
  speed: number
  damage: number
  radius: number
  targetId: number | null // slug or pumpkin id for homing
  targetPoint: { x: number; y: number } | null // fixed destination (gwynevere)
  arcStart: { x: number; y: number } | null // gwynevere parabola launch point
  arcPeak: number // gwynevere parabola peak height
  blastRadius: number
  sourcePumpkinId: number
  life: number // seconds before a stray projectile fades
  dead: boolean
  pierce: number // remaining slugs this projectile can pass through (silas)
  hitIds: number[] // slugs already pierced — no double-dipping
}

export interface GameGrenade {
  id: number
  x: number
  y: number
  fuse: number
  blastRadius: number
  damage: number
}

export interface GameBeerCup {
  id: number
  x: number
  y: number
  duration: number
  radius: number
  attracted: Set<number>
}

export interface GameSaltLine {
  id: number
  x: number
  duration: number
  width: number
}

export interface CardOffer {
  cards: Array<
    | {
        kind: "pumpkin"
        pumpkinType: PumpkinType
      }
    | {
        kind: "ability"
        abilityId: AbilityId
      }
  >
}

export type GamePhase = "playing" | "cards" | "gameover" | "ended"

export interface GameKill {
  type: SlugType
  x: number
  source: KillSource
}

export interface GameSnapshot {
  phase: GamePhase
  round: number
  completedRounds: number
  score: number
  coins: number
  // Current per-type shop prices including inflation (see costFor).
  shopPrices: Record<string, number>
  inventory: GameInventoryItem[]
  cards: CardOffer | null
  popupIndex: number
  popupTotal: number
  mode: GameInputMode
  pendingAbility: AbilityId | null
  prompt: string | null
  gameOverReason: string | null
}

export type GameInputMode = "none" | "place-pumpkin" | "ability-point" | "ability-pumpkin"
