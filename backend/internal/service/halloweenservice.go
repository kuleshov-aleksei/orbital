package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/rand"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
)

// HalloweenStartsAt is the date the feature becomes visible (17.10.2026, UTC).
const HalloweenStartsAt = "2026-10-17"

// HalloweenGameConfig is the server-authoritative balance payload served to
// clients at game load. All values mirror the balance tables in HALLOWEEN.md.
type HalloweenGameConfig struct {
	Enabled           bool                              `json:"enabled"`
	StartsAt          string                            `json:"starts_at"`
	BattlefieldLength int                               `json:"battlefield_length"`
	StartingCoins     int                               `json:"starting_coins"`
	StartingPumpkins  []string                          `json:"starting_pumpkins"`
	Pumpkins          map[string]HalloweenPumpkinConfig `json:"pumpkins"`
	Slugs             map[string]HalloweenSlugConfig    `json:"slugs"`
	Abilities         map[string]HalloweenAbilityConfig `json:"abilities"`
	Proximity         []HalloweenProximityThreshold     `json:"proximity"`
	RoundBonus        int                               `json:"round_bonus"`
	RewardBrackets    []HalloweenRewardBracket          `json:"reward_brackets"`
	RewardsPerRound   map[int]int                       `json:"rewards_per_round"`
	SpawnRounds       []HalloweenSpawnRoundConfig       `json:"spawn_rounds"`
	SpawnScaling      HalloweenSpawnScalingConfig       `json:"spawn_scaling"`
	// LevelCosts is the XP price of each level-up: index 0 levels 1->2,
	// index 1 levels 2->3. The XP pool is global; selling never refunds XP.
	LevelCosts []int `json:"level_costs"`
	// SlugHPGrowth compounds slug max HP per round: HP *= growth^(round-1).
	// Round 1 is exactly 1.0 — the tutorial round doesn't need surprises.
	SlugHPGrowth float64 `json:"slug_hp_growth"`
	// ShieldMin/ShieldMax bound the shields rolled by each shielded slug.
	// One hit strips one shield regardless of damage. Yes, really.
	ShieldMin int `json:"shield_min"`
	ShieldMax int `json:"shield_max"`
}

type HalloweenPumpkinConfig struct {
	FireRate        float64 `json:"fire_rate"` // shots per second
	Health          int     `json:"health"`
	DamagePerShot   int     `json:"damage_per_shot"`
	ProjectileSpeed float64 `json:"projectile_speed"` // units per second
	Cost            int     `json:"cost"`             // seeds to buy in the shop
	CoinIntervalS   float64 `json:"coin_interval_s"`  // seconds per coin tick (cramer)
	CoinsPerTick    int     `json:"coins_per_tick"`   // seeds produced per tick (cramer)
	// DraftOnly marks card-exclusive pumpkins the shop refuses to sell.
	DraftOnly bool `json:"draft_only,omitempty"`
	// Levels holds the per-level stats (index 0 = level 1). The top-level
	// fields mirror Levels[0] for backwards compatibility.
	Levels []HalloweenPumpkinLevelConfig `json:"levels"`
}

// HalloweenPumpkinLevelConfig is one row of the pumkin level balance table
// (HALLOWEEN.md "Pumkin level balance table"). BlastRadius only matters for
// Gwynevere; CoinIntervalS/CoinsPerTick only matter for Cramer.
type HalloweenPumpkinLevelConfig struct {
	Health          int     `json:"health"`
	FireRate        float64 `json:"fire_rate"`
	DamagePerShot   int     `json:"damage_per_shot"`
	ProjectileSpeed float64 `json:"projectile_speed"`
	CoinIntervalS   float64 `json:"coin_interval_s"`
	CoinsPerTick    int     `json:"coins_per_tick"`
	BlastRadius     float64 `json:"blast_radius"`
}

type HalloweenSlugConfig struct {
	Speed           float64 `json:"speed"`
	Health          int     `json:"health"`
	DamageToPumpkin int     `json:"damage_to_pumpkin"`
	RewardPoints    int     `json:"reward_points"`
	KillReward      int     `json:"kill_reward"` // seeds earned per kill
	XpReward        int     `json:"xp_reward"`   // xp earned per kill (global pool)
}

type HalloweenAbilityConfig struct {
	Score int    `json:"score"` // absolute score for flat abilities; multiplier (percent) for others
	Kind  string `json:"kind"`  // "multiplier" | "flat"
}

type HalloweenProximityThreshold struct {
	MinX   int     `json:"min_x"`
	Factor float64 `json:"factor"`
}

type HalloweenRewardBracket struct {
	MinScore int    `json:"min_score"`
	Tier     string `json:"tier"` // regular | common | uncommon | rare
}

// HalloweenSpawnRoundConfig is one explicit per-round slug spawn table.
// Rounds beyond the explicit list use HalloweenSpawnScalingConfig.
type HalloweenSpawnRoundConfig struct {
	Round          int            `json:"round"`
	Interval       float64        `json:"interval"`        // seconds between spawns
	Pool           map[string]int `json:"pool"`            // scout | marvin | gerald | dell
	SpeedVariation float64        `json:"speed_variation"` // e.g. 0.01 = +-1%
	Shielded       int            `json:"shielded"`        // slugs arriving with shields
}

// HalloweenSpawnScalingConfig generates endless-round spawn tables.
// Counts use ceil(): scout = ceil(n*ScoutPerRound), marvin = ceil(n*MarvinPerRound),
// gerald/dell = ceil(sqrt(n)*coef).
type HalloweenSpawnScalingConfig struct {
	Interval       float64 `json:"interval"`
	ScoutPerRound  float64 `json:"scout_per_round"`
	MarvinPerRound float64 `json:"marvin_per_round"`
	GeraldSqrt     float64 `json:"gerald_sqrt"`
	DellSqrt       float64 `json:"dell_sqrt"`
	SpeedVariation float64 `json:"speed_variation"`
	ShieldPerRound float64 `json:"shield_per_round"`
}

const (
	HalloweenSlugScout  = "scout"
	HalloweenSlugMarvin = "marvin"
	HalloweenSlugGerald = "gerald"
	HalloweenSlugDell   = "dell"

	HalloweenAbilityAnnihilation = "annihilation"
	HalloweenAbilityHolyGrenade  = "holy_grenade"
	HalloweenAbilityBeer         = "beer"
	HalloweenAbilitySaltLine     = "salt_line"
	HalloweenAbilityTailwind     = "tailwind"
	HalloweenAbilitySeedRain     = "seed_rain"
	HalloweenAbilityThornPatch   = "thorn_patch"

	HalloweenRarityRegular  = "regular"
	HalloweenRarityCommon   = "common"
	HalloweenRarityUncommon = "uncommon"
	HalloweenRarityRare     = "rare"
)

var halloweenTierOrder = []string{
	HalloweenRarityRare,
	HalloweenRarityUncommon,
	HalloweenRarityCommon,
	HalloweenRarityRegular,
}

type HalloweenService struct {
	repo     *repository.HalloweenRepository
	seasonal *config.SeasonalConfig
}

func NewHalloweenService(repo *repository.HalloweenRepository, seasonal *config.SeasonalConfig) *HalloweenService {
	return &HalloweenService{repo: repo, seasonal: seasonal}
}

// IsEnabled reports whether the halloween event is currently visible.
func (s *HalloweenService) IsEnabled() bool {
	if s.seasonal == nil || !s.seasonal.Halloween.Enabled {
		return false
	}
	startsAt := s.seasonal.Halloween.StartsAt
	if startsAt == "" {
		return true
	}
	start, err := time.Parse("2006-01-02", startsAt)
	if err != nil {
		return false
	}
	return !time.Now().UTC().Before(start)
}

// Config returns the server-authoritative balance payload.
func (s *HalloweenService) Config() *HalloweenGameConfig {
	startsAt := HalloweenStartsAt
	if s.seasonal != nil && s.seasonal.Halloween.StartsAt != "" {
		startsAt = s.seasonal.Halloween.StartsAt
	}

	return &HalloweenGameConfig{
		Enabled:           s.IsEnabled(),
		StartsAt:          startsAt,
		BattlefieldLength: 1000,
		StartingCoins:     20,
		StartingPumpkins:  []string{"ferdinand", "ferdinand"},
		Pumpkins: map[string]HalloweenPumpkinConfig{
			"ferdinand": {
				FireRate: 1, Health: 10, DamagePerShot: 5, ProjectileSpeed: 100, Cost: 20,
				Levels: []HalloweenPumpkinLevelConfig{
					{Health: 10, FireRate: 1, DamagePerShot: 5, ProjectileSpeed: 100, CoinIntervalS: 0, CoinsPerTick: 0, BlastRadius: 0},
					{Health: 14, FireRate: 1.15, DamagePerShot: 6, ProjectileSpeed: 100, CoinIntervalS: 0, CoinsPerTick: 0, BlastRadius: 0},
					{Health: 18, FireRate: 1.3, DamagePerShot: 7, ProjectileSpeed: 100, CoinIntervalS: 0, CoinsPerTick: 0, BlastRadius: 0},
				},
			},
			"chunky": {
				FireRate: 0, Health: 50, DamagePerShot: 0, ProjectileSpeed: 0, Cost: 40,
				Levels: []HalloweenPumpkinLevelConfig{
					{Health: 50, FireRate: 0, DamagePerShot: 0, ProjectileSpeed: 0, CoinIntervalS: 0, CoinsPerTick: 0, BlastRadius: 0},
					{Health: 75, FireRate: 0, DamagePerShot: 0, ProjectileSpeed: 0, CoinIntervalS: 0, CoinsPerTick: 0, BlastRadius: 0},
					{Health: 100, FireRate: 0, DamagePerShot: 0, ProjectileSpeed: 0, CoinIntervalS: 0, CoinsPerTick: 0, BlastRadius: 0},
				},
			},
			"herbert": {
				FireRate: 0.5, Health: 10, DamagePerShot: 5, ProjectileSpeed: 150, Cost: 40,
				Levels: []HalloweenPumpkinLevelConfig{
					{Health: 10, FireRate: 0.5, DamagePerShot: 5, ProjectileSpeed: 150, CoinIntervalS: 0, CoinsPerTick: 0, BlastRadius: 0},
					{Health: 14, FireRate: 0.6, DamagePerShot: 5, ProjectileSpeed: 150, CoinIntervalS: 0, CoinsPerTick: 0, BlastRadius: 0},
					{Health: 18, FireRate: 0.7, DamagePerShot: 5, ProjectileSpeed: 150, CoinIntervalS: 0, CoinsPerTick: 0, BlastRadius: 0},
				},
			},
			"gwynevere": {
				FireRate: 0.1, Health: 5, DamagePerShot: 10, ProjectileSpeed: 40, Cost: 70,
				Levels: []HalloweenPumpkinLevelConfig{
					{Health: 5, FireRate: 0.1, DamagePerShot: 10, ProjectileSpeed: 40, CoinIntervalS: 0, CoinsPerTick: 0, BlastRadius: 70},
					{Health: 7, FireRate: 0.115, DamagePerShot: 13, ProjectileSpeed: 40, CoinIntervalS: 0, CoinsPerTick: 0, BlastRadius: 80},
					{Health: 9, FireRate: 0.13, DamagePerShot: 16, ProjectileSpeed: 40, CoinIntervalS: 0, CoinsPerTick: 0, BlastRadius: 90},
				},
			},
			"cramer": {
				FireRate: 0, Health: 10, DamagePerShot: 0, ProjectileSpeed: 0, Cost: 75, CoinIntervalS: 5, CoinsPerTick: 1,
				Levels: []HalloweenPumpkinLevelConfig{
					{Health: 10, FireRate: 0, DamagePerShot: 0, ProjectileSpeed: 0, CoinIntervalS: 5, CoinsPerTick: 1, BlastRadius: 0},
					{Health: 14, FireRate: 0, DamagePerShot: 0, ProjectileSpeed: 0, CoinIntervalS: 4, CoinsPerTick: 1, BlastRadius: 0},
					{Health: 18, FireRate: 0, DamagePerShot: 0, ProjectileSpeed: 0, CoinIntervalS: 3, CoinsPerTick: 1, BlastRadius: 0},
				},
			},
			// PEARcer: card-exclusive piercing sniper (pear skin, pumpkin mechanics). Not for sale at any price.
			"pearcer": {
				FireRate: 0.25, Health: 5, DamagePerShot: 25, ProjectileSpeed: 200, Cost: 100, DraftOnly: true,
				Levels: []HalloweenPumpkinLevelConfig{
					{Health: 5, FireRate: 0.25, DamagePerShot: 25, ProjectileSpeed: 200, CoinIntervalS: 0, CoinsPerTick: 0, BlastRadius: 0},
					{Health: 7, FireRate: 0.278, DamagePerShot: 30, ProjectileSpeed: 200, CoinIntervalS: 0, CoinsPerTick: 0, BlastRadius: 0},
					{Health: 9, FireRate: 0.323, DamagePerShot: 35, ProjectileSpeed: 200, CoinIntervalS: 0, CoinsPerTick: 0, BlastRadius: 0},
				},
			},
		},
		Slugs: map[string]HalloweenSlugConfig{
			HalloweenSlugScout:  {Speed: 50, Health: 10, DamageToPumpkin: 2, RewardPoints: 10, KillReward: 2, XpReward: 2},
			HalloweenSlugMarvin: {Speed: 50, Health: 20, DamageToPumpkin: 5, RewardPoints: 20, KillReward: 5, XpReward: 3},
			HalloweenSlugGerald: {Speed: 30, Health: 100, DamageToPumpkin: 20, RewardPoints: 50, KillReward: 15, XpReward: 3},
			HalloweenSlugDell:   {Speed: 0, Health: 10, DamageToPumpkin: 0, RewardPoints: 100, KillReward: 25, XpReward: 5},
		},
		Abilities: map[string]HalloweenAbilityConfig{
			HalloweenAbilityAnnihilation: {Score: 70, Kind: "multiplier"}, // 70% of slug reward
			HalloweenAbilityHolyGrenade:  {Score: 80, Kind: "multiplier"}, // 80% of slug reward
			HalloweenAbilityBeer:         {Score: 0, Kind: "flat"},        // 0 damage — pure utility (slow)
			HalloweenAbilitySaltLine:     {Score: 0, Kind: "flat"},        // 0 damage — pure utility (slow)
			HalloweenAbilityTailwind:     {Score: 0, Kind: "flat"},        // 0 damage — pure utility (fire-rate buff)
			HalloweenAbilitySeedRain:     {Score: 0, Kind: "flat"},        // 0 damage — pure utility (coins)
			HalloweenAbilityThornPatch:   {Score: 80, Kind: "multiplier"}, // 80% of slug reward, like holy grenade
		},
		Proximity: []HalloweenProximityThreshold{
			{MinX: 700, Factor: 1.0},
			{MinX: 500, Factor: 0.7},
			{MinX: 300, Factor: 0.5},
			{MinX: 0, Factor: 0.35},
		},
		RoundBonus: 1000,
		RewardBrackets: []HalloweenRewardBracket{
			{MinScore: 8000, Tier: HalloweenRarityRare},
			{MinScore: 5000, Tier: HalloweenRarityUncommon},
			{MinScore: 2000, Tier: HalloweenRarityCommon},
			{MinScore: 1000, Tier: HalloweenRarityRegular},
		},
		RewardsPerRound: map[int]int{
			1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4,
		},
		SpawnRounds: []HalloweenSpawnRoundConfig{
			{Round: 1, Interval: 7, Pool: map[string]int{"scout": 20, "marvin": 4, "gerald": 0, "dell": 0}, SpeedVariation: 0.01, Shielded: 0},
			{Round: 2, Interval: 6, Pool: map[string]int{"scout": 16, "marvin": 8, "gerald": 0, "dell": 0}, SpeedVariation: 0.02, Shielded: 2},
			{Round: 3, Interval: 5, Pool: map[string]int{"scout": 20, "marvin": 10, "gerald": 2, "dell": 1}, SpeedVariation: 0.04, Shielded: 4},
			{Round: 4, Interval: 3, Pool: map[string]int{"scout": 40, "marvin": 16, "gerald": 5, "dell": 3}, SpeedVariation: 0.04, Shielded: 6},
			{Round: 5, Interval: 3, Pool: map[string]int{"scout": 48, "marvin": 18, "gerald": 6, "dell": 4}, SpeedVariation: 0.04, Shielded: 8},
			{Round: 6, Interval: 2.5, Pool: map[string]int{"scout": 56, "marvin": 20, "gerald": 7, "dell": 5}, SpeedVariation: 0.04, Shielded: 10},
			{Round: 7, Interval: 2.5, Pool: map[string]int{"scout": 64, "marvin": 22, "gerald": 8, "dell": 5}, SpeedVariation: 0.04, Shielded: 14},
			{Round: 8, Interval: 3, Pool: map[string]int{"scout": 64, "marvin": 20, "gerald": 6, "dell": 5}, SpeedVariation: 0.04, Shielded: 14},
			{Round: 9, Interval: 3, Pool: map[string]int{"scout": 72, "marvin": 22, "gerald": 7, "dell": 5}, SpeedVariation: 0.04, Shielded: 16},
			{Round: 10, Interval: 3, Pool: map[string]int{"scout": 80, "marvin": 24, "gerald": 7, "dell": 6}, SpeedVariation: 0.04, Shielded: 18},
		},
		SpawnScaling: HalloweenSpawnScalingConfig{
			Interval: 3, ScoutPerRound: 8, MarvinPerRound: 2.5,
			GeraldSqrt: 1.2, DellSqrt: 1.2, SpeedVariation: 0.04,
			ShieldPerRound: 2,
		},
		// Slugs lift weights between rounds. Your pumpkins don't. Adapt.
		SlugHPGrowth: 1.27,
		// Level 1->2 costs 40 XP, 2->3 costs 80 XP. Full max-out is 120 XP;
		// ~1000 XP is earnable through round 7, so 7-10 maxed pumpkins max.
		LevelCosts: []int{40, 80},
		ShieldMin:  3,
		ShieldMax:  6,
	}
}

// GetState returns a user's equipped customization, owned items, the live
// catalog (soft-deleted rows excluded), and every base socket layout.
func (s *HalloweenService) GetState(userID string) (*models.HalloweenStateResponse, error) {
	state, err := s.repo.GetPumpkinState(userID)
	if err != nil {
		return nil, err
	}

	equipped := "{}"
	if state != nil {
		equipped = state.Equipped
	}

	owned, err := s.repo.GetOwnedItems(userID)
	if err != nil {
		return nil, err
	}
	if owned == nil {
		owned = []*models.HalloweenOwnedItem{}
	}

	catalog, err := s.repo.GetAllItems()
	if err != nil {
		return nil, err
	}

	layouts, err := s.repo.GetAllBaseSockets()
	if err != nil {
		return nil, err
	}

	ownedItems := make([]models.HalloweenOwnedItem, 0, len(owned))
	for _, o := range owned {
		ownedItems = append(ownedItems, *o)
	}
	catalogItems := make([]models.HalloweenItem, 0, len(catalog))
	for _, c := range catalog {
		catalogItems = append(catalogItems, *c)
	}
	baseLayouts := map[string]map[string]models.HalloweenBaseSocket{}
	for _, l := range layouts {
		if _, ok := baseLayouts[l.BaseID]; !ok {
			baseLayouts[l.BaseID] = map[string]models.HalloweenBaseSocket{}
		}
		baseLayouts[l.BaseID][l.Socket] = *l
	}

	return &models.HalloweenStateResponse{
		EquippedJSON: equipped,
		OwnedItems:   ownedItems,
		Catalog:      catalogItems,
		BaseLayouts:  baseLayouts,
	}, nil
}

// UpdatePumpkin saves a user's equipped customization JSON.
func (s *HalloweenService) UpdatePumpkin(userID string, equippedJSON string) error {
	if equippedJSON == "" {
		equippedJSON = "{}"
	}
	if !json.Valid([]byte(equippedJSON)) {
		return errors.New("equipped_json must be valid JSON")
	}
	return s.repo.UpsertPumpkinState(userID, equippedJSON)
}

// SubmitGame validates a game report, stores the result, and grants rewards
// (human games only — decider submissions earn nothing).
// Returns the granted item ids and any informational message.
func (s *HalloweenService) SubmitGame(userID string, report *models.HalloweenGameReport) (*models.SubmitGameReportResponse, error) {
	if report.CompletedRounds < 0 {
		return nil, errors.New("completed_rounds cannot be negative")
	}
	if report.Score < 0 {
		return nil, errors.New("score cannot be negative")
	}
	if report.Source == "" {
		report.Source = models.HalloweenSourceHuman
	}
	switch report.Source {
	case models.HalloweenSourceHuman, models.HalloweenSourceHeuristic, models.HalloweenSourceSystemOne:
	default:
		return nil, errors.New("source must be human, heuristic, or systemone")
	}

	computed := s.ComputeScore(report)
	cheater := false
	if math.Abs(float64(report.Score-computed)) > 0.1*float64(computed) {
		cheater = true
	}

	granted := []string{}
	message := ""

	if !cheater && report.Source == models.HalloweenSourceHuman {
		granted, message = s.pickRewards(userID, report.Score, report.CompletedRounds)
	}

	reportJSON, err := json.Marshal(report)
	if err != nil {
		return nil, err
	}

	rewardJSON := "null"
	if len(granted) > 0 {
		rewardBytes, err := json.Marshal(granted)
		if err != nil {
			return nil, err
		}
		rewardJSON = string(rewardBytes)
	}

	result := &models.GameResult{
		UserID:          userID,
		CompletedRounds: report.CompletedRounds,
		Score:           report.Score,
		IsIncomplete:    report.IsIncomplete,
		IsCheater:       cheater,
		Source:          report.Source,
		Model:           report.Model,
		ReportJSON:      string(reportJSON),
		RewardJSON:      rewardJSON,
	}

	gameID, err := s.repo.SubmitGameResult(result, granted)
	if err != nil {
		return nil, err
	}

	return &models.SubmitGameReportResponse{
		GameID:    gameID,
		Score:     report.Score,
		IsCheater: cheater,
		Granted:   granted,
		Message:   message,
	}, nil
}

// ComputeScore recomputes the expected score for a report. This is the source
// of truth for anti-cheat validation.
func (s *HalloweenService) ComputeScore(report *models.HalloweenGameReport) int {
	cfg := s.Config()
	total := 0

	for _, kill := range report.Kills {
		slugCfg, ok := cfg.Slugs[kill.Type]
		if !ok {
			continue
		}

		switch kill.Source {
		case "pumpkin":
			total += int(math.Round(float64(slugCfg.RewardPoints) * s.proximityFactor(cfg, kill.X)))
		case HalloweenAbilityAnnihilation:
			mult := float64(cfg.Abilities[HalloweenAbilityAnnihilation].Score) / 100.0
			total += int(math.Round(float64(slugCfg.RewardPoints) * mult))
		case HalloweenAbilityHolyGrenade:
			mult := float64(cfg.Abilities[HalloweenAbilityHolyGrenade].Score) / 100.0
			total += int(math.Round(float64(slugCfg.RewardPoints) * mult))
		case HalloweenAbilityBeer:
			total += cfg.Abilities[HalloweenAbilityBeer].Score
		case HalloweenAbilitySaltLine:
			total += cfg.Abilities[HalloweenAbilitySaltLine].Score
		case HalloweenAbilityTailwind:
			total += cfg.Abilities[HalloweenAbilityTailwind].Score
		case HalloweenAbilitySeedRain:
			total += cfg.Abilities[HalloweenAbilitySeedRain].Score
		case HalloweenAbilityThornPatch:
			mult := float64(cfg.Abilities[HalloweenAbilityThornPatch].Score) / 100.0
			total += int(math.Round(float64(slugCfg.RewardPoints) * mult))
		default:
			// Unknown source — count as a normal pumpkin kill at full reward.
			total += slugCfg.RewardPoints
		}
	}

	// Round bonus: completed round += current round number * 1000
	rounds := report.CompletedRounds
	if rounds > 0 {
		total += cfg.RoundBonus * rounds * (rounds + 1) / 2
	}

	return total
}

// proximityFactor maps a battlefield x position to its reward multiplier.
func (s *HalloweenService) proximityFactor(cfg *HalloweenGameConfig, x float64) float64 {
	factor := 1.0
	for _, t := range cfg.Proximity {
		if x >= float64(t.MinX) {
			factor = t.Factor
			break
		}
	}
	return factor
}

// tierForScore returns the reward tier for a score, or "" if below 1000.
func (s *HalloweenService) tierForScore(cfg *HalloweenGameConfig, score int) string {
	for _, b := range cfg.RewardBrackets {
		if score >= b.MinScore {
			return b.Tier
		}
	}
	return ""
}

// rewardCount returns how many rewards a completed-rounds value entitles.
func (s *HalloweenService) rewardCount(cfg *HalloweenGameConfig, rounds int) int {
	if rounds <= 0 {
		return 0
	}
	if count, ok := cfg.RewardsPerRound[rounds]; ok {
		return count
	}
	return 4 // cap for endless rounds
}

// pickRewards selects up to rewardCount unique, unowned items ordered
// top-tier → lower tiers. Returns granted item ids and a message when the
// pool is exhausted.
func (s *HalloweenService) pickRewards(userID string, score int, rounds int) ([]string, string) {
	cfg := s.Config()
	count := s.rewardCount(cfg, rounds)
	if count <= 0 {
		return nil, ""
	}

	tier := s.tierForScore(cfg, score)
	if tier == "" {
		return nil, "" // below 1000 → no reward
	}

	tierIdx := -1
	for i, t := range halloweenTierOrder {
		if t == tier {
			tierIdx = i
			break
		}
	}

	var granted []string
	message := ""

	for i := 0; i < count; i++ {
		poolTier := tierIdx + i
		if poolTier >= len(halloweenTierOrder) {
			message = "all rewards have been earned"
			break
		}

		items, err := s.repo.GetItemsByRarity(halloweenTierOrder[poolTier])
		if err != nil {
			break
		}

		// Filter to unowned items.
		var available []*models.HalloweenItem
		for _, item := range items {
			owned, err := s.repo.OwnsItem(userID, item.ID)
			if err != nil {
				continue
			}
			if !owned {
				available = append(available, item)
			}
		}

		if len(available) == 0 {
			message = "all rewards have been earned"
			break
		}

		pick := available[rand.Intn(len(available))]
		granted = append(granted, pick.ID)
	}

	if len(granted) == 0 {
		message = "all rewards have been earned"
	}

	return granted, message
}

// GetLeaderboard returns the top scores.
func (s *HalloweenService) GetLeaderboard() ([]*models.HalloweenLeaderboardEntry, error) {
	entries, err := s.repo.GetLeaderboard(50)
	if err != nil {
		return nil, err
	}
	if entries == nil {
		entries = []*models.HalloweenLeaderboardEntry{}
	}
	return entries, nil
}

// GetAdminGames returns the full admin view of every stored game: parsed
// report, per-game stats, income split (kills vs cramer), and rewards.
func (s *HalloweenService) GetAdminGames() ([]*models.HalloweenAdminGame, error) {
	results, err := s.repo.GetAllGameResults()
	if err != nil {
		return nil, err
	}

	cfg := s.Config()
	games := make([]*models.HalloweenAdminGame, 0, len(results))
	for _, r := range results {
		games = append(games, s.adminGameFromResult(r, cfg))
	}
	return games, nil
}

// adminGameFromResult converts a stored result into the admin DTO, parsing the
// report and computing kill vs cramer income from the server-side config.
func (s *HalloweenService) adminGameFromResult(r *models.GameResult, cfg *HalloweenGameConfig) *models.HalloweenAdminGame {
	report := models.HalloweenGameReport{}
	if r.ReportJSON != "" {
		_ = json.Unmarshal([]byte(r.ReportJSON), &report)
	}

	killIncome := 0
	killsByType := map[string]int{}
	for _, kill := range report.Kills {
		killsByType[kill.Type]++
		if slugCfg, ok := cfg.Slugs[kill.Type]; ok {
			killIncome += slugCfg.KillReward
		}
	}

	cramerIncome := report.CoinsEarned - killIncome
	if cramerIncome < 0 {
		cramerIncome = 0
	}

	rewards, err := s.repo.GetRewardsForGame(r.ID)
	if err != nil {
		rewards = nil
	}
	rewardsOut := make([]models.HalloweenRewardGranted, 0, len(rewards))
	for _, rw := range rewards {
		rewardsOut = append(rewardsOut, *rw)
	}

	if report.SpawnedPumpkins == nil {
		report.SpawnedPumpkins = map[string]int{}
	}
	if report.UsedItems == nil {
		report.UsedItems = map[string]int{}
	}

	return &models.HalloweenAdminGame{
		ID:              r.ID,
		UserID:          r.UserID,
		Nickname:        r.Nickname,
		CompletedRounds: r.CompletedRounds,
		Score:           r.Score,
		IsIncomplete:    r.IsIncomplete,
		IsCheater:       r.IsCheater,
		Source:          r.Source,
		Model:           r.Model,
		CoinsEarned:     report.CoinsEarned,
		CoinsSpent:      report.CoinsSpent,
		KillIncome:      killIncome,
		CramerIncome:    cramerIncome,
		SpawnedPumpkins: report.SpawnedPumpkins,
		Kills:           report.Kills,
		KillsByType:     killsByType,
		UsedItems:       report.UsedItems,
		Rewards:         rewardsOut,
		CreatedAt:       r.CreatedAt,
	}
}

// GetAdminRewards returns the full rewards ledger (admin view).
func (s *HalloweenService) GetAdminRewards() ([]*models.HalloweenAdminReward, error) {
	rewards, err := s.repo.GetAllRewards()
	if err != nil {
		return nil, err
	}
	if rewards == nil {
		rewards = []*models.HalloweenAdminReward{}
	}
	return rewards, nil
}

// GetAdminCatalog returns the full decoration catalog (admin view,
// including soft-deleted rows).
func (s *HalloweenService) GetAdminCatalog() ([]*models.HalloweenItem, error) {
	items, err := s.repo.GetAllItemsAdmin()
	if err != nil {
		return nil, err
	}
	if items == nil {
		items = []*models.HalloweenItem{}
	}
	return items, nil
}

// validPumpkinSockets is the full socket set (base + overlays incl. feet).
func validPumpkinSocket(socket string) bool {
	switch socket {
	case "base", "hat", "eyes", "mouth", "feet":
		return true
	default:
		return false
	}
}

func validHalloweenRarity(rarity string) bool {
	switch rarity {
	case HalloweenRarityRegular, HalloweenRarityCommon, HalloweenRarityUncommon, HalloweenRarityRare:
		return true
	default:
		return false
	}
}

// CreateItem validates and inserts a new catalog entry (super_admin only).
func (s *HalloweenService) CreateItem(req *models.CreateHalloweenItemRequest) (*models.HalloweenItem, error) {
	if req.ID == "" || req.Name == "" {
		return nil, errors.New("id and name are required")
	}
	if !validPumpkinSocket(req.Socket) {
		return nil, errors.New("socket must be base, hat, eyes, mouth, or feet")
	}
	if !validHalloweenRarity(req.Rarity) {
		return nil, errors.New("invalid rarity")
	}
	if existing, err := s.repo.GetItemAdmin(req.ID); err != nil {
		return nil, err
	} else if existing != nil {
		return nil, errors.New("item id already exists")
	}

	item := &models.HalloweenItem{
		ID: req.ID, Name: req.Name, Socket: req.Socket,
		Rarity: req.Rarity, SortOrder: req.SortOrder, ZIndex: req.ZIndex,
		AssetPath: req.AssetPath,
	}
	if err := s.repo.CreateItem(item); err != nil {
		return nil, err
	}
	return s.repo.GetItemAdmin(req.ID)
}

// UpdateItem validates and updates a catalog entry (super_admin only).
// AssetPath is managed exclusively via the asset upload endpoint.
func (s *HalloweenService) UpdateItem(id string, req *models.UpdateHalloweenItemRequest) (*models.HalloweenItem, error) {
	existing, err := s.repo.GetItemAdmin(id)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, errors.New("item not found")
	}
	if req.Name == "" {
		return nil, errors.New("name is required")
	}
	if !validPumpkinSocket(req.Socket) {
		return nil, errors.New("socket must be base, hat, eyes, mouth, or feet")
	}
	if !validHalloweenRarity(req.Rarity) {
		return nil, errors.New("invalid rarity")
	}

	existing.Name = req.Name
	existing.Socket = req.Socket
	existing.Rarity = req.Rarity
	existing.SortOrder = req.SortOrder
	existing.ZIndex = req.ZIndex
	if err := s.repo.UpdateItem(existing); err != nil {
		return nil, err
	}
	return s.repo.GetItemAdmin(id)
}

// SoftDeleteItem marks an item as deleted (super_admin only). Live clients
// never see it again; ledger history is preserved.
func (s *HalloweenService) SoftDeleteItem(id string) error {
	existing, err := s.repo.GetItemAdmin(id)
	if err != nil {
		return err
	}
	if existing == nil {
		return errors.New("item not found")
	}
	return s.repo.SoftDeleteItem(id)
}

func (s *HalloweenService) RestoreItem(id string) error {
	existing, err := s.repo.GetItemAdmin(id)
	if err != nil {
		return err
	}
	if existing == nil {
		return errors.New("item not found")
	}
	return s.repo.RestoreItem(id)
}

// SetItemAssetPath records an uploaded art URL on the catalog row.
func (s *HalloweenService) SetItemAssetPath(id string, assetPath string) (*models.HalloweenItem, error) {
	existing, err := s.repo.GetItemAdmin(id)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, errors.New("item not found")
	}
	if err := s.repo.SetItemAssetPath(id, assetPath); err != nil {
		return nil, err
	}
	return s.repo.GetItemAdmin(id)
}

// GetBaseSockets returns the stored anchors for one base (may be empty).
func (s *HalloweenService) GetBaseSockets(baseID string) ([]*models.HalloweenBaseSocket, error) {
	sockets, err := s.repo.GetBaseSockets(baseID)
	if err != nil {
		return nil, err
	}
	if sockets == nil {
		sockets = []*models.HalloweenBaseSocket{}
	}
	return sockets, nil
}

// UpsertBaseSockets replaces the socket anchors for a base (super_admin only).
func (s *HalloweenService) UpsertBaseSockets(baseID string, sockets []models.HalloweenBaseSocket) error {
	base, err := s.repo.GetItemAdmin(baseID)
	if err != nil {
		return err
	}
	if base == nil {
		return errors.New("base item not found")
	}
	if base.Socket != "base" {
		return errors.New("base_id must reference a base item")
	}

	seen := map[string]bool{}
	rows := make([]*models.HalloweenBaseSocket, 0, len(sockets))
	for _, sock := range sockets {
		if !validPumpkinSocket(sock.Socket) || sock.Socket == "base" {
			return errors.New("socket must be hat, eyes, mouth, or feet")
		}
		if seen[sock.Socket] {
			return errors.New("duplicate socket: " + sock.Socket)
		}
		seen[sock.Socket] = true
		if sock.OffsetX < -1 || sock.OffsetX > 1 || sock.OffsetY < -1 || sock.OffsetY > 1 {
			return errors.New("offsets must be within -1..1")
		}
		rows = append(rows, &models.HalloweenBaseSocket{
			BaseID: baseID, Socket: sock.Socket, OffsetX: sock.OffsetX, OffsetY: sock.OffsetY,
		})
	}
	return s.repo.UpsertBaseSockets(baseID, rows)
}

// IssueReward grants a specific item to a user (admin action).
func (s *HalloweenService) IssueReward(userID string, itemID string) (bool, error) {
	item, err := s.repo.GetItem(itemID)
	if err != nil {
		return false, err
	}
	if item == nil {
		return false, fmt.Errorf("item not found")
	}
	return s.repo.IssueReward(userID, itemID)
}

// PurgeUser cleans up halloween data for a deleted user (guest purge hook).
func (s *HalloweenService) PurgeUser(userID string) error {
	return s.repo.PurgeUser(userID)
}
