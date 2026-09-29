package models

import "time"

// HalloweenItem is a single catalog entry for pumpkin decorations.
type HalloweenItem struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Socket    string `json:"socket"` // hat | eyes | mouth | base
	Rarity    string `json:"rarity"` // regular | common | uncommon | rare
	SortOrder int    `json:"sort_order"`
}

// PumpkinState holds a user's equipped pumpkin customization.
type PumpkinState struct {
	UserID    string    `json:"user_id"`
	Equipped  string    `json:"equipped_json"` // {"hat":"hat_party","eyes":"eyes_sinister"}
	UpdatedAt time.Time `json:"updated_at"`
}

// Game source labels for halloween results: who played the game.
// "human" is the default for reports without a source (all pre-existing rows).
const (
	HalloweenSourceHuman     = "human"
	HalloweenSourceHeuristic = "heuristic"
	HalloweenSourceSystemOne = "systemone"
)

// HalloweenBotUserID is the fixed user_id under which decider-submitted
// (heuristic/systemone) results are stored. It has no users-table row, so
// the admin view falls back to the DeletedUserPlaceholder nickname.
const HalloweenBotUserID = "decider"

// HalloweenSlugKill describes one slug killed during a game.
type HalloweenSlugKill struct {
	Type   string  `json:"type"`   // scout | marvin | gerald | dell
	X      float64 `json:"x"`      // battlefield position, 0-1000
	Source string  `json:"source"` // pumpkin | annihilation | holy_grenade | beer | salt_line
}

// HalloweenGameReport is the payload the client submits after a game.
type HalloweenGameReport struct {
	SpawnedPumpkins map[string]int      `json:"spawned_pumpkins"` // pumpkin type -> count
	Kills           []HalloweenSlugKill `json:"kills"`
	UsedItems       map[string]int      `json:"used_items"` // ability id -> count
	CompletedRounds int                 `json:"completed_rounds"`
	Score           int                 `json:"score"`
	CoinsEarned     int                 `json:"coins_earned"`
	CoinsSpent      int                 `json:"coins_spent"`
	XpEarned        int                 `json:"xp_earned"` // global level-up pool telemetry; ignored by scoring
	IsIncomplete    bool                `json:"is_incomplete"` // tab closed / left the call
	// Source is who played the game: human (default, also when empty),
	// heuristic, or systemone. Set by balance-harness submissions.
	Source string `json:"source"`
	// Model is the decider model (systemone only), e.g. "winnow:e4b".
	Model string `json:"model"`
}

// GameResult is a stored game result row (admin view + leaderboard source).
type GameResult struct {
	ID              int64     `json:"id"`
	UserID          string    `json:"user_id"`
	Nickname        string    `json:"nickname"`
	CompletedRounds int       `json:"completed_rounds"`
	Score           int       `json:"score"`
	IsIncomplete    bool      `json:"is_incomplete"`
	IsCheater       bool      `json:"is_cheater"`
	Source          string    `json:"source"`
	Model           string    `json:"model"`
	ReportJSON      string    `json:"report_json"`
	RewardJSON      string    `json:"reward_json"`
	CreatedAt       time.Time `json:"created_at"`
}

// HalloweenReward is a granted decoration (owned item ledger row).
type HalloweenReward struct {
	ID        int64     `json:"id"`
	UserID    string    `json:"user_id"`
	ItemID    string    `json:"item_id"`
	Source    string    `json:"source"` // game | admin
	GameID    *int64    `json:"game_id"`
	GrantedAt time.Time `json:"granted_at"`
}

// HalloweenLeaderboardEntry is one row of the top-scores leaderboard.
type HalloweenLeaderboardEntry struct {
	UserID          string `json:"user_id"`
	Nickname        string `json:"nickname"`
	BestScore       int    `json:"best_score"`
	CompletedRounds int    `json:"completed_rounds"`
}

// HalloweenOwnedItem is an item id the user owns (from the rewards ledger).
type HalloweenOwnedItem struct {
	ItemID string `json:"item_id"`
}

// HalloweenStateResponse is returned by GET /api/halloween/state.
type HalloweenStateResponse struct {
	EquippedJSON string               `json:"equipped_json"`
	OwnedItems   []HalloweenOwnedItem `json:"owned_items"`
	Catalog      []HalloweenItem      `json:"catalog"`
}

// UpdatePumpkinRequest is the body of PUT /api/halloween/pumpkin.
type UpdatePumpkinRequest struct {
	EquippedJSON string `json:"equipped_json"`
}

// SubmitGameReportResponse is returned by POST /api/halloween/game/report.
type SubmitGameReportResponse struct {
	GameID    int64    `json:"game_id"`
	Score     int      `json:"score"`
	IsCheater bool     `json:"is_cheater"`
	Granted   []string `json:"granted"`
	Message   string   `json:"message"`
}

// IssueRewardRequest is the body of POST /api/admin/halloween/rewards.
type IssueRewardRequest struct {
	UserID string `json:"user_id"`
	ItemID string `json:"item_id"`
}

// HalloweenRewardGranted is one decoration granted for a specific game.
type HalloweenRewardGranted struct {
	ItemID string `json:"item_id"`
	Name   string `json:"name"`
	Rarity string `json:"rarity"`
	Socket string `json:"socket"`
	Source string `json:"source"` // game | admin
}

// HalloweenAdminReward is one row of the full rewards ledger (admin view).
type HalloweenAdminReward struct {
	UserID    string    `json:"user_id"`
	Nickname  string    `json:"nickname"`
	ItemID    string    `json:"item_id"`
	Name      string    `json:"name"`
	Rarity    string    `json:"rarity"`
	Socket    string    `json:"socket"`
	Source    string    `json:"source"` // game | admin
	GameID    *int64    `json:"game_id"`
	GrantedAt time.Time `json:"granted_at"`
}

// HalloweenAdminGame is the admin view of one stored game result: the parsed
// report, computed stats (income split, kills per slug type), and rewards.
type HalloweenAdminGame struct {
	ID              int64                     `json:"id"`
	UserID          string                    `json:"user_id"`
	Nickname        string                    `json:"nickname"`
	CompletedRounds int                       `json:"completed_rounds"`
	Score           int                       `json:"score"`
	IsIncomplete    bool                      `json:"is_incomplete"`
	IsCheater       bool                      `json:"is_cheater"`
	Source          string                    `json:"source"`
	Model           string                    `json:"model"`
	CoinsEarned     int                       `json:"coins_earned"`
	CoinsSpent      int                       `json:"coins_spent"`
	KillIncome      int                       `json:"kill_income"`
	CramerIncome    int                       `json:"cramer_income"`
	SpawnedPumpkins map[string]int            `json:"spawned_pumpkins"`
	Kills           []HalloweenSlugKill       `json:"kills"`
	KillsByType     map[string]int            `json:"kills_by_type"`
	UsedItems       map[string]int            `json:"used_items"`
	Rewards         []HalloweenRewardGranted  `json:"rewards"`
	CreatedAt       time.Time                 `json:"created_at"`
}
