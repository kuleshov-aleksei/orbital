package models

import "time"

// HalloweenItem is a single catalog entry for pumpkin decorations.
type HalloweenItem struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Socket    string  `json:"socket"`     // base | hat | eyes | mouth | feet
	Rarity    string  `json:"rarity"`     // common | uncommon | rare | epic | legendary
	AssetPath string  `json:"asset_path"` // backend-owned art URL (served PNG) or legacy public path
	ZIndex    int     `json:"z_index"`    // render layer; base is 0, negative draws behind
	Scale     float64 `json:"scale"`      // accessory size multiplier; 1 = natural size
	IsDeleted bool    `json:"is_deleted"` // soft-delete flag; live clients never see these
}

// HalloweenBaseSocket is the per-base anchor for one overlay socket, in units
// of base size relative to the base center (0,0 = centered, -0.5..+0.5).
type HalloweenBaseSocket struct {
	BaseID  string  `json:"base_id"`
	Socket  string  `json:"socket"` // hat | eyes | mouth | feet
	OffsetX float64 `json:"offset_x"`
	OffsetY float64 `json:"offset_y"`
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
	XpEarned        int                 `json:"xp_earned"`     // global level-up pool telemetry; ignored by scoring
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
	// BaseLayouts maps base item id -> socket -> anchor offset.
	BaseLayouts map[string]map[string]HalloweenBaseSocket `json:"base_layouts"`
}

// CreateHalloweenItemRequest is the body of POST /api/admin/halloween/items.
// Clients send snake_case (see frontend/src/services/api.ts).
type CreateHalloweenItemRequest struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Socket    string  `json:"socket"` // base | hat | eyes | mouth | feet
	Rarity    string  `json:"rarity"`
	ZIndex    int     `json:"z_index"`
	Scale     float64 `json:"scale"`
	AssetPath string  `json:"asset_path"`
}

// UpdateHalloweenItemRequest is the body of PATCH /api/admin/halloween/items/{id}.
type UpdateHalloweenItemRequest struct {
	Name   string  `json:"name"`
	Socket string  `json:"socket"`
	Rarity string  `json:"rarity"`
	ZIndex int     `json:"z_index"`
	Scale  float64 `json:"scale"`
}

// UpsertBaseSocketsRequest is the body of PUT /api/admin/halloween/layouts.
type UpsertBaseSocketsRequest struct {
	BaseID  string                `json:"base_id"`
	Sockets []HalloweenBaseSocket `json:"sockets"`
}

// HalloweenConfigVersion is the only config file version the import accepts.
const HalloweenConfigVersion = 1

// HalloweenConfigItem is one catalog row in a config export/import file.
// Inside a .tar package, art travels alongside as assets/<id>.png;
// config.json itself carries definitions only.
type HalloweenConfigItem struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Socket string  `json:"socket"` // base | hat | eyes | mouth | feet
	Rarity string  `json:"rarity"` // common | uncommon | rare | epic | legendary
	ZIndex int     `json:"z_index"`
	Scale  float64 `json:"scale"`
}

// HalloweenConfigExport is the full pumpkin configuration snapshot:
// the live catalog plus every per-base socket layout.
type HalloweenConfigExport struct {
	Version     int                                       `json:"version"`
	ExportedAt  time.Time                                 `json:"exported_at"`
	Items       []HalloweenConfigItem                     `json:"items"`
	BaseLayouts map[string]map[string]HalloweenBaseSocket `json:"base_layouts"`
}

// HalloweenConfigImport is the body of POST /api/admin/halloween/config/import.
type HalloweenConfigImport struct {
	Version     int                                       `json:"version"`
	Items       []HalloweenConfigItem                     `json:"items"`
	BaseLayouts map[string]map[string]HalloweenBaseSocket `json:"base_layouts"`
}

// HalloweenPackageImportResult summarizes an applied config package (.tar):
// the definitions from config.json plus the bundled PNG art.
type HalloweenPackageImportResult struct {
	Status         string   `json:"status"`
	Items          int      `json:"items"`
	AssetsIncluded int      `json:"assets_included"`
	AssetsMissing  []string `json:"assets_missing"`
	RemovedIDs     []string `json:"removed_ids"`
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
	ID              int64                    `json:"id"`
	UserID          string                   `json:"user_id"`
	Nickname        string                   `json:"nickname"`
	CompletedRounds int                      `json:"completed_rounds"`
	Score           int                      `json:"score"`
	IsIncomplete    bool                     `json:"is_incomplete"`
	IsCheater       bool                     `json:"is_cheater"`
	Source          string                   `json:"source"`
	Model           string                   `json:"model"`
	CoinsEarned     int                      `json:"coins_earned"`
	CoinsSpent      int                      `json:"coins_spent"`
	KillIncome      int                      `json:"kill_income"`
	CramerIncome    int                      `json:"cramer_income"`
	SpawnedPumpkins map[string]int           `json:"spawned_pumpkins"`
	Kills           []HalloweenSlugKill      `json:"kills"`
	KillsByType     map[string]int           `json:"kills_by_type"`
	UsedItems       map[string]int           `json:"used_items"`
	Rewards         []HalloweenRewardGranted `json:"rewards"`
	CreatedAt       time.Time                `json:"created_at"`
}
