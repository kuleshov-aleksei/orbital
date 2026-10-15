// Halloween feature types — mirror the Go backend snake_case payloads
// (see backend/internal/models/halloween.go and halloweenservice.go).

export type PumpkinSocket = "hat" | "eyes" | "mouth" | "base" | "feet"

// Overlay sockets positioned per base (base itself is the anchor reference).
export type PumpkinOverlaySocket = "hat" | "eyes" | "mouth" | "feet"

export type HalloweenRarity = "common" | "uncommon" | "rare" | "epic" | "legendary"

// HalloweenItem is a single catalog entry for pumpkin decorations.
// asset_path is the backend-owned art URL (or legacy public path);
// z_index is the render layer (base = 0, negative draws behind the base);
// scale is the accessory size multiplier (1 = natural size).
// Catalog display order is backend-owned (socket → rarity → name); there is
// no manual order field.
export interface HalloweenItem {
  id: string
  name: string
  socket: PumpkinSocket
  rarity: HalloweenRarity
  asset_path: string
  z_index: number
  scale: number
  is_deleted: boolean
}

// HalloweenBaseSocket is the per-base anchor for one overlay socket, in units
// of base size relative to the base center (0,0 = centered).
export interface HalloweenBaseSocket {
  base_id: string
  socket: PumpkinOverlaySocket
  offset_x: number
  offset_y: number
}

// BaseLayouts maps base item id -> socket -> anchor offset.
export type BaseLayouts = Record<string, Partial<Record<PumpkinOverlaySocket, HalloweenBaseSocket>>>

// PumpkinState holds a user's equipped pumpkin customization.
export interface PumpkinState {
  user_id: string
  equipped_json: string // {"hat":"hat_party","eyes":"eyes_sinister"}
  updated_at: string
}

// HalloweenOwnedItem is an item id the user owns (from the rewards ledger).
export interface HalloweenOwnedItem {
  item_id: string
}

// HalloweenStateResponse is returned by GET /api/halloween/state.
export interface HalloweenStateResponse {
  equipped_json: string
  owned_items: HalloweenOwnedItem[]
  catalog: HalloweenItem[]
  base_layouts: BaseLayouts
}

// Payloads for the super_admin catalog/layout endpoints (snake_case).
export interface CreateHalloweenItemRequest {
  id: string
  name: string
  socket: PumpkinSocket
  rarity: HalloweenRarity
  z_index: number
  scale: number
  asset_path?: string
}

export interface UpdateHalloweenItemRequest {
  name: string
  socket: PumpkinSocket
  rarity: HalloweenRarity
  z_index: number
  scale: number
}

export interface UpsertBaseSocketsRequest {
  base_id: string
  sockets: HalloweenBaseSocket[]
}

// Result of applying a config package (.tar): definitions from config.json
// plus the bundled PNG art. assets_missing lists imported ids without art
// (placeholders seeded for them); removed_ids lists soft-deleted rows whose
// orphan art files were cleaned up.
export interface HalloweenPackageResult {
  status: string
  items: number
  assets_included: number
  assets_missing: string[]
  removed_ids: string[]
}

// EquippedCustomization is the parsed form of equipped_json.
export interface EquippedCustomization {
  [socket: string]: string | undefined
}

// HalloweenSlugKill describes one slug killed during a game.
export interface HalloweenSlugKill {
  type: "scout" | "marvin" | "gerald" | "dell"
  x: number
  source: "pumpkin" | "annihilation" | "holy_grenade" | "beer" | "salt_line"
}

// HalloweenGameReport is the payload submitted after a game.
export interface HalloweenGameReport {
  spawned_pumpkins: Record<string, number>
  kills: HalloweenSlugKill[]
  used_items: Record<string, number>
  completed_rounds: number
  score: number
  coins_earned: number
  coins_spent: number
  xp_earned: number // global level-up pool telemetry; ignored by scoring
  is_incomplete: boolean
  source?: HalloweenGameSource // who played; backend defaults to "human"
  model?: string // decider model for systemone runs
}

// SubmitGameReportResponse is returned by POST /api/halloween/game/report.
export interface SubmitGameReportResponse {
  game_id: number
  score: number
  is_cheater: boolean
  granted: string[] | null
  message: string
}

// HalloweenLeaderboardEntry is one row of the top-scores leaderboard.
export interface HalloweenLeaderboardEntry {
  user_id: string
  nickname: string
  best_score: number
  completed_rounds: number
}

// HalloweenPumpkinLevelConfig is one row of the pumkin level balance table
// (HALLOWEEN.md "Pumkin level balance table"). BlastRadius only matters for
// Gwynevere; CoinIntervalS/CoinsPerTick only matter for Cramer.
export interface HalloweenPumpkinLevelConfig {
  health: number
  fire_rate: number
  damage_per_shot: number
  projectile_speed: number
  coin_interval_s: number
  coins_per_tick: number
  blast_radius: number
}

// HalloweenPumpkinConfig mirrors the pumpkin balance table.
export interface HalloweenPumpkinConfig {
  fire_rate: number
  health: number
  damage_per_shot: number
  projectile_speed: number
  cost: number
  coin_interval_s: number // seconds per coin tick (cramer)
  coins_per_tick: number // seeds produced per tick (cramer)
  draft_only?: boolean // true: card-exclusive, never sold in the shop (pearcer)
  levels?: HalloweenPumpkinLevelConfig[] // index 0 = level 1; top-level fields mirror levels[0]
}

// HalloweenSlugConfig mirrors the slug balance table.
export interface HalloweenSlugConfig {
  speed: number
  health: number
  damage_to_pumpkin: number
  reward_points: number
  kill_reward: number // seeds earned per kill
  xp_reward?: number // xp earned per kill (global level-up pool); absent = 0
}

// HalloweenAbilityConfig mirrors the ability scoring rules.
export interface HalloweenAbilityConfig {
  score: number // absolute score for flat kinds; multiplier (percent) otherwise
  kind: "multiplier" | "flat"
}

// HalloweenProximityThreshold maps a battlefield x to a reward multiplier.
export interface HalloweenProximityThreshold {
  min_x: number
  factor: number
}

// HalloweenRewardBracket maps a score to a reward tier.
export interface HalloweenRewardBracket {
  min_score: number
  tier: HalloweenRarity
}

// HalloweenSpawnRoundConfig is one explicit per-round slug spawn table.
// Rounds beyond the explicit list use HalloweenSpawnScalingConfig.
export interface HalloweenSpawnRoundConfig {
  round: number
  interval: number // seconds between spawns
  pool: Record<string, number> // scout | marvin | gerald | dell
  speed_variation: number // e.g. 0.01 = +-1%
  shielded: number // slugs arriving with shields (0 = R1 innocence)
}

// HalloweenSpawnScalingConfig generates endless-round spawn tables.
// Counts use ceil(): scout = ceil(n*scout_per_round), marvin = ceil(n*marvin_per_round),
// gerald/dell = ceil(sqrt(n)*coef).
export interface HalloweenSpawnScalingConfig {
  interval: number
  scout_per_round: number
  marvin_per_round: number
  gerald_sqrt: number
  dell_sqrt: number
  speed_variation: number
  shield_per_round: number // shielded slugs per round beyond explicit tables
}

// HalloweenGameConfig is the server-authoritative balance payload.
export interface HalloweenGameConfig {
  enabled: boolean
  starts_at: string
  battlefield_length: number
  starting_coins: number
  starting_pumpkins?: string[]
  pumpkins: Record<string, HalloweenPumpkinConfig>
  slugs: Record<string, HalloweenSlugConfig>
  abilities: Record<string, HalloweenAbilityConfig>
  proximity: HalloweenProximityThreshold[]
  round_bonus: number
  reward_brackets: HalloweenRewardBracket[]
  rewards_per_round: Record<number, number>
  spawn_rounds?: HalloweenSpawnRoundConfig[]
  spawn_scaling?: HalloweenSpawnScalingConfig
  // Per-round slug HP multiplier base: HP *= growth^(round-1). Absent = 1 (flat).
  slug_hp_growth?: number
  // XP price per level-up: index 0 levels 1->2, index 1 levels 2->3.
  // Absent = [40, 80] fallback.
  level_costs?: number[]
  shield_min: number // shields rolled by a shielded slug (min)
  shield_max: number // shields rolled by a shielded slug (max)
}

// PumpkinDisplay is the view model used by the pumpkin strip: a user with
// their resolved nickname, equipped sockets, and whether it is the local user.
export interface PumpkinDisplay {
  user_id: string
  nickname: string
  equipped: EquippedCustomization
  isLocal: boolean
}

// HalloweenGameSource is who played a game: a human, the heuristic
// balance policy, or the systemone decider.
export type HalloweenGameSource = "human" | "heuristic" | "systemone"

// HalloweenRewardGranted is one decoration granted for a specific game.
export interface HalloweenRewardGranted {
  item_id: string
  name: string
  rarity: HalloweenRarity
  socket: PumpkinSocket
  source: "game" | "admin"
}

// HalloweenAdminReward is one row of the full rewards ledger (admin view).
export interface HalloweenAdminReward {
  user_id: string
  nickname: string
  item_id: string
  name: string
  rarity: HalloweenRarity
  socket: PumpkinSocket
  source: "game" | "admin"
  game_id: number | null
  granted_at: string
}

// HalloweenAdminGame is the admin view of one stored game result with parsed
// report, computed stats, and granted rewards.
export interface HalloweenAdminGame {
  id: number
  user_id: string
  nickname: string
  completed_rounds: number
  score: number
  is_incomplete: boolean
  is_cheater: boolean
  source: HalloweenGameSource
  model: string | null
  coins_earned: number
  coins_spent: number
  kill_income: number
  cramer_income: number
  spawned_pumpkins: Record<string, number>
  kills: HalloweenSlugKill[]
  kills_by_type: Record<string, number>
  used_items: Record<string, number>
  rewards: HalloweenRewardGranted[]
  created_at: string
}
