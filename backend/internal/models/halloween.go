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
	IsIncomplete    bool                `json:"is_incomplete"` // tab closed / left the call
}

// GameResult is a stored game result row (admin view + leaderboard source).
type GameResult struct {
	ID              int64     `json:"id"`
	UserID          string    `json:"user_id"`
	CompletedRounds int       `json:"completed_rounds"`
	Score           int       `json:"score"`
	IsIncomplete    bool      `json:"is_incomplete"`
	IsCheater       bool      `json:"is_cheater"`
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
