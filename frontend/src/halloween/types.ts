// Halloween feature types — mirror the Go backend snake_case payloads
// (see backend/internal/models/halloween.go and halloweenservice.go).

export type PumpkinSocket = "hat" | "eyes" | "mouth" | "base"

export type HalloweenRarity = "regular" | "common" | "uncommon" | "rare"

// HalloweenItem is a single catalog entry for pumpkin decorations.
export interface HalloweenItem {
  id: string
  name: string
  socket: PumpkinSocket
  rarity: HalloweenRarity
  sort_order: number
}

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
  is_incomplete: boolean
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

// HalloweenPumpkinConfig mirrors the pumpkin balance table.
export interface HalloweenPumpkinConfig {
  fire_rate: number
  health: number
  damage_per_shot: number
  projectile_speed: number
  cost: number
  coin_interval_s: number // seconds per coin tick (cramer)
  coins_per_tick: number // seeds produced per tick (cramer)
}

// HalloweenSlugConfig mirrors the slug balance table.
export interface HalloweenSlugConfig {
  speed: number
  health: number
  damage_to_pumpkin: number
  reward_points: number
  kill_reward: number // seeds earned per kill
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

// HalloweenGameConfig is the server-authoritative balance payload.
export interface HalloweenGameConfig {
  enabled: boolean
  starts_at: string
  battlefield_length: number
  starting_coins: number
  pumpkins: Record<string, HalloweenPumpkinConfig>
  slugs: Record<string, HalloweenSlugConfig>
  abilities: Record<string, HalloweenAbilityConfig>
  proximity: HalloweenProximityThreshold[]
  round_bonus: number
  reward_brackets: HalloweenRewardBracket[]
  rewards_per_round: Record<number, number>
}

// PumpkinDisplay is the view model used by the pumpkin strip: a user with
// their resolved nickname, equipped sockets, and whether it is the local user.
export interface PumpkinDisplay {
  user_id: string
  nickname: string
  equipped: EquippedCustomization
  isLocal: boolean
}

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
