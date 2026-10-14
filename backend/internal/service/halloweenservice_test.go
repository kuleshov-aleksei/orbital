package service

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

func newHalloweenTestService(t *testing.T) *HalloweenService {
	t.Helper()
	db, err := storage.NewDB(":memory:")
	if err != nil {
		t.Fatalf("failed to create in-memory db: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	if err := db.RunMigrations(); err != nil {
		t.Fatalf("failed to run migrations: %v", err)
	}

	repo := repository.NewHalloweenRepository(db)
	seasonal := &config.SeasonalConfig{
		Halloween: config.HalloweenConfig{
			Enabled:  true,
			StartsAt: HalloweenStartsAt,
		},
	}
	return NewHalloweenService(repo, seasonal)
}

func TestHalloweenConfigEnabledGate(t *testing.T) {
	s := newHalloweenTestService(t)
	cfg := s.Config()

	start, err := time.Parse("2006-01-02", cfg.StartsAt)
	if err != nil {
		t.Fatalf("invalid starts_at %q: %v", cfg.StartsAt, err)
	}
	wantEnabled := !time.Now().UTC().Before(start)
	if cfg.Enabled != wantEnabled {
		t.Fatalf("enabled = %v, want %v (starts %s)", cfg.Enabled, wantEnabled, cfg.StartsAt)
	}
	if cfg.BattlefieldLength != 1000 {
		t.Fatalf("unexpected battlefield length: %d", cfg.BattlefieldLength)
	}
}

func TestHalloweenIsEnabledMasterSwitch(t *testing.T) {
	s := newHalloweenTestService(t)

	// Master switch off → always disabled regardless of date.
	disabled := &config.SeasonalConfig{
		Halloween: config.HalloweenConfig{Enabled: false, StartsAt: "2000-01-01"},
	}
	s.seasonal = disabled
	if s.IsEnabled() {
		t.Fatal("expected feature to be disabled when master switch is off")
	}

	// Master switch on, empty starts_at → always enabled.
	alwaysOn := &config.SeasonalConfig{
		Halloween: config.HalloweenConfig{Enabled: true, StartsAt: ""},
	}
	s.seasonal = alwaysOn
	if !s.IsEnabled() {
		t.Fatal("expected feature to be enabled with no starts_at")
	}

	// Future starts_at → disabled.
	future := &config.SeasonalConfig{
		Halloween: config.HalloweenConfig{Enabled: true, StartsAt: "2999-12-31"},
	}
	s.seasonal = future
	if s.IsEnabled() {
		t.Fatal("expected feature to be disabled before starts_at")
	}
}

func TestHalloweenComputeScore(t *testing.T) {
	s := newHalloweenTestService(t)

	report := &models.HalloweenGameReport{
		Kills: []models.HalloweenSlugKill{
			{Type: HalloweenSlugScout, X: 800, Source: "pumpkin"},                   // 10 * 1.0 = 10
			{Type: HalloweenSlugScout, X: 600, Source: "pumpkin"},                   // 10 * 0.7 = 7
			{Type: HalloweenSlugScout, X: 400, Source: "pumpkin"},                   // 10 * 0.5 = 5
			{Type: HalloweenSlugScout, X: 200, Source: "pumpkin"},                   // 10 * 0.35 = 3.5 -> 4
			{Type: HalloweenSlugMarvin, X: 0, Source: HalloweenAbilityAnnihilation}, // 20 * 0.7 = 14
			{Type: HalloweenSlugGerald, X: 0, Source: HalloweenAbilityHolyGrenade},  // 50 * 0.8 = 40
			{Type: HalloweenSlugMarvin, X: 0, Source: HalloweenAbilityBeer},         // 0
			{Type: HalloweenSlugGerald, X: 0, Source: HalloweenAbilitySaltLine},     // 0
		},
		CompletedRounds: 2, // 1000 * (2*3)/2 = 3000
	}

	want := 10 + 7 + 5 + 4 + 14 + 40 + 0 + 0 + 3000
	got := s.ComputeScore(report)
	if got != want {
		t.Fatalf("ComputeScore = %d, want %d", got, want)
	}
}

func TestHalloweenProximityBoundaries(t *testing.T) {
	s := newHalloweenTestService(t)
	cfg := s.Config()

	cases := []struct {
		x    float64
		want float64
	}{
		{800, 1.0},
		{700, 1.0},
		{699, 0.7},
		{500, 0.7},
		{499, 0.5},
		{300, 0.5},
		{299, 0.35},
		{0, 0.35},
	}
	for _, c := range cases {
		got := s.proximityFactor(cfg, c.x)
		if got != c.want {
			t.Errorf("proximityFactor(%v) = %v, want %v", c.x, got, c.want)
		}
	}
}

func TestHalloweenShopEconomyConfig(t *testing.T) {
	s := newHalloweenTestService(t)
	cfg := s.Config()

	if cfg.StartingCoins != 20 {
		t.Fatalf("starting_coins = %d, want 20", cfg.StartingCoins)
	}

	wantCosts := map[string]int{
		"ferdinand": 20,
		"chunky":    40,
		"herbert":   40,
		"gwynevere": 70,
		"cramer":    75,
		"pearcer":   100,
	}
	if len(cfg.Pumpkins) != len(wantCosts) {
		t.Fatalf("pumpkins = %d types, want %d", len(cfg.Pumpkins), len(wantCosts))
	}
	for name, cost := range wantCosts {
		p, ok := cfg.Pumpkins[name]
		if !ok {
			t.Fatalf("missing pumpkin %q in config", name)
		}
		if p.Cost != cost {
			t.Errorf("pumpkin %q cost = %d, want %d", name, p.Cost, cost)
		}
	}

	cramer := cfg.Pumpkins["cramer"]
	if cramer.CoinIntervalS != 5 || cramer.CoinsPerTick != 1 {
		t.Errorf("cramer production = %v s / %v per tick, want 5 / 1",
			cramer.CoinIntervalS, cramer.CoinsPerTick)
	}

	wantKillRewards := map[string]int{
		HalloweenSlugScout:  2,
		HalloweenSlugMarvin: 5,
		HalloweenSlugGerald: 15,
		HalloweenSlugDell:   25,
	}
	for name, reward := range wantKillRewards {
		slug, ok := cfg.Slugs[name]
		if !ok {
			t.Fatalf("missing slug %q in config", name)
		}
		if slug.KillReward != reward {
			t.Errorf("slug %q kill_reward = %d, want %d", name, slug.KillReward, reward)
		}
	}
}

func TestHalloweenLevelUpConfig(t *testing.T) {
	s := newHalloweenTestService(t)
	cfg := s.Config()

	// Level 1->2 costs 40 XP, 2->3 costs 80 XP (120 XP to max out).
	if len(cfg.LevelCosts) != 2 || cfg.LevelCosts[0] != 40 || cfg.LevelCosts[1] != 80 {
		t.Fatalf("level_costs = %v, want [40 80]", cfg.LevelCosts)
	}

	wantXP := map[string]int{
		HalloweenSlugScout:  2,
		HalloweenSlugMarvin: 3,
		HalloweenSlugGerald: 3,
		HalloweenSlugDell:   5,
	}
	for name, xp := range wantXP {
		slug, ok := cfg.Slugs[name]
		if !ok {
			t.Fatalf("missing slug %q in config", name)
		}
		if slug.XpReward != xp {
			t.Errorf("slug %q xp_reward = %d, want %d", name, slug.XpReward, xp)
		}
	}

	// Every pumpkin has exactly 3 levels; level 1 mirrors the top-level row.
	for name, p := range cfg.Pumpkins {
		if len(p.Levels) != 3 {
			t.Errorf("pumpkin %q has %d levels, want 3", name, len(p.Levels))
			continue
		}
		l1 := p.Levels[0]
		if l1.Health != p.Health || l1.FireRate != p.FireRate ||
			l1.DamagePerShot != p.DamagePerShot || l1.ProjectileSpeed != p.ProjectileSpeed {
			t.Errorf("pumpkin %q level 1 %+v does not mirror top-level row", name, l1)
		}
	}

	// Herbert is nerfed: heal amount stays flat, only fire rate scales.
	herbert := cfg.Pumpkins["herbert"].Levels
	for i, lvl := range herbert {
		if lvl.DamagePerShot != 5 {
			t.Errorf("herbert level %d heal = %d, want 5 (flat)", i+1, lvl.DamagePerShot)
		}
	}
	if herbert[0].FireRate != 0.5 || herbert[1].FireRate != 0.6 || herbert[2].FireRate != 0.7 {
		t.Errorf("herbert fire rates = %v/%v/%v, want 0.5/0.6/0.7",
			herbert[0].FireRate, herbert[1].FireRate, herbert[2].FireRate)
	}

	// A level 2 pumpkin must stay weaker than two level 1s (spot-check HP).
	if chunky := cfg.Pumpkins["chunky"].Levels; chunky[1].Health >= 2*chunky[0].Health {
		t.Errorf("chunky level 2 HP = %d, must be < 2x level 1 (%d)",
			chunky[1].Health, 2*chunky[0].Health)
	}
	if cramer := cfg.Pumpkins["cramer"].Levels; cramer[1].CoinIntervalS != 4 || cramer[2].CoinIntervalS != 3 {
		t.Errorf("cramer coin intervals = %v/%v, want 4/3",
			cramer[1].CoinIntervalS, cramer[2].CoinIntervalS)
	}
	if gwyn := cfg.Pumpkins["gwynevere"].Levels; gwyn[0].BlastRadius != 70 || gwyn[2].BlastRadius != 90 {
		t.Errorf("gwynevere blast = %v/%v, want 70/90", gwyn[0].BlastRadius, gwyn[2].BlastRadius)
	}
}

func TestHalloweenSpawnTablesConfig(t *testing.T) {
	s := newHalloweenTestService(t)
	cfg := s.Config()

	if len(cfg.StartingPumpkins) != 2 ||
		cfg.StartingPumpkins[0] != "ferdinand" || cfg.StartingPumpkins[1] != "ferdinand" {
		t.Fatalf("starting_pumpkins = %v, want [ferdinand ferdinand]", cfg.StartingPumpkins)
	}

	// Rounds 1-4 must match HALLOWEEN.md verbatim; 5-10 are the ceil() formula
	// pre-computed so the payload is fully data-driven.
	wantRounds := map[int]HalloweenSpawnRoundConfig{
		1:  {Round: 1, Interval: 7, Pool: map[string]int{"scout": 20, "marvin": 4, "gerald": 0, "dell": 0}, SpeedVariation: 0.01, Shielded: 0},
		2:  {Round: 2, Interval: 6, Pool: map[string]int{"scout": 16, "marvin": 8, "gerald": 0, "dell": 0}, SpeedVariation: 0.02, Shielded: 2},
		3:  {Round: 3, Interval: 5, Pool: map[string]int{"scout": 20, "marvin": 10, "gerald": 2, "dell": 1}, SpeedVariation: 0.04, Shielded: 4},
		4:  {Round: 4, Interval: 3, Pool: map[string]int{"scout": 40, "marvin": 16, "gerald": 5, "dell": 3}, SpeedVariation: 0.04, Shielded: 6},
		5:  {Round: 5, Interval: 3, Pool: map[string]int{"scout": 48, "marvin": 18, "gerald": 6, "dell": 4}, SpeedVariation: 0.04, Shielded: 8},
		6:  {Round: 6, Interval: 2.5, Pool: map[string]int{"scout": 56, "marvin": 20, "gerald": 7, "dell": 5}, SpeedVariation: 0.04, Shielded: 10},
		7:  {Round: 7, Interval: 2.5, Pool: map[string]int{"scout": 64, "marvin": 22, "gerald": 8, "dell": 5}, SpeedVariation: 0.04, Shielded: 14},
		8:  {Round: 8, Interval: 3, Pool: map[string]int{"scout": 64, "marvin": 20, "gerald": 6, "dell": 5}, SpeedVariation: 0.04, Shielded: 14},
		9:  {Round: 9, Interval: 3, Pool: map[string]int{"scout": 72, "marvin": 22, "gerald": 7, "dell": 5}, SpeedVariation: 0.04, Shielded: 16},
		10: {Round: 10, Interval: 3, Pool: map[string]int{"scout": 80, "marvin": 24, "gerald": 7, "dell": 6}, SpeedVariation: 0.04, Shielded: 18},
	}
	if len(cfg.SpawnRounds) != len(wantRounds) {
		t.Fatalf("spawn_rounds = %d entries, want %d", len(cfg.SpawnRounds), len(wantRounds))
	}
	for _, entry := range cfg.SpawnRounds {
		want, ok := wantRounds[entry.Round]
		if !ok {
			t.Errorf("unexpected spawn_round %d", entry.Round)
			continue
		}
		if entry.Interval != want.Interval {
			t.Errorf("round %d interval = %v, want %v", entry.Round, entry.Interval, want.Interval)
		}
		if entry.SpeedVariation != want.SpeedVariation {
			t.Errorf("round %d speed_variation = %v, want %v", entry.Round, entry.SpeedVariation, want.SpeedVariation)
		}
		if entry.Shielded != want.Shielded {
			t.Errorf("round %d shielded = %d, want %d", entry.Round, entry.Shielded, want.Shielded)
		}
		for _, slug := range []string{"scout", "marvin", "gerald", "dell"} {
			if entry.Pool[slug] != want.Pool[slug] {
				t.Errorf("round %d pool[%s] = %d, want %d", entry.Round, slug, entry.Pool[slug], want.Pool[slug])
			}
		}
	}

	scaling := cfg.SpawnScaling
	if scaling.Interval != 3 || scaling.ScoutPerRound != 8 || scaling.MarvinPerRound != 2.5 ||
		scaling.GeraldSqrt != 1.2 || scaling.DellSqrt != 1.2 || scaling.SpeedVariation != 0.04 ||
		scaling.ShieldPerRound != 2 {
		t.Errorf("unexpected spawn_scaling: %+v", scaling)
	}

	if cfg.SlugHPGrowth != 1.27 {
		t.Errorf("slug_hp_growth = %v, want 1.27", cfg.SlugHPGrowth)
	}
	if cfg.ShieldMin != 3 || cfg.ShieldMax != 6 {
		t.Errorf("shield bounds = %d..%d, want 3..6", cfg.ShieldMin, cfg.ShieldMax)
	}
}

func TestHalloweenSubmitGameGrantsRewards(t *testing.T) {
	s := newHalloweenTestService(t)

	// Seed one item per top tier so the cascade has something to grant.
	for _, req := range []models.CreateHalloweenItemRequest{
		{ID: "hat_legend", Name: "Legend", Socket: "hat", Rarity: "legendary", ZIndex: 20, Scale: 1},
		{ID: "hat_epic", Name: "Epic", Socket: "hat", Rarity: "epic", ZIndex: 20, Scale: 1},
		{ID: "hat_rare", Name: "Rare", Socket: "hat", Rarity: "rare", ZIndex: 20, Scale: 1},
	} {
		req := req
		if _, err := s.CreateItem(&req); err != nil {
			t.Fatalf("CreateItem %s failed: %v", req.ID, err)
		}
	}

	// 28050 points, round 7 -> 3 rewards: legendary, epic, rare in order.
	report := &models.HalloweenGameReport{
		Kills: []models.HalloweenSlugKill{
			{Type: HalloweenSlugGerald, X: 800, Source: "pumpkin"}, // 50 * 1.0 = 50
		},
		CompletedRounds: 7, // 1000 * (7*8)/2 = 28000
		Score:           50 + 28000,
	}

	resp, err := s.SubmitGame("user-1", report)
	if err != nil {
		t.Fatalf("SubmitGame failed: %v", err)
	}
	if resp.IsCheater {
		t.Fatal("expected no cheater flag")
	}
	if len(resp.Granted) != 3 {
		t.Fatalf("expected 3 granted rewards, got %d: %v", len(resp.Granted), resp.Granted)
	}

	// Verify tiers: legendary, epic, rare in order.
	if resp.Granted[0] != "hat_legend" || resp.Granted[1] != "hat_epic" || resp.Granted[2] != "hat_rare" {
		t.Fatalf("expected legendary→epic→rare cascade, got %v", resp.Granted)
	}
	state, err := s.GetState("user-1")
	if err != nil {
		t.Fatalf("GetState failed: %v", err)
	}
	if len(state.OwnedItems) != 3 {
		t.Fatalf("expected 3 owned items, got %d", len(state.OwnedItems))
	}
}

func TestHalloweenSubmitGameRarityTiers(t *testing.T) {
	s := newHalloweenTestService(t)

	// Seed one item per top tier so the cascade has something to grant.
	for _, req := range []models.CreateHalloweenItemRequest{
		{ID: "hat_legend", Name: "Legend", Socket: "hat", Rarity: "legendary", ZIndex: 20, Scale: 1},
		{ID: "hat_epic", Name: "Epic", Socket: "hat", Rarity: "epic", ZIndex: 20, Scale: 1},
	} {
		req := req
		if _, err := s.CreateItem(&req); err != nil {
			t.Fatalf("CreateItem %s failed: %v", req.ID, err)
		}
	}

	// 15000 points, round 5 -> 2 rewards: legendary first, then epic.
	report := &models.HalloweenGameReport{
		CompletedRounds: 5, // 1000 * (5*6)/2 = 15000
		Score:           15000,
	}
	resp, err := s.SubmitGame("user-2", report)
	if err != nil {
		t.Fatalf("SubmitGame failed: %v", err)
	}
	if len(resp.Granted) != 2 {
		t.Fatalf("expected 2 granted rewards, got %d: %v", len(resp.Granted), resp.Granted)
	}
	if resp.Granted[0] != "hat_legend" || resp.Granted[1] != "hat_epic" {
		t.Fatalf("expected legendary→epic cascade, got %v", resp.Granted)
	}
}

func TestHalloweenSubmitGameNoRewardBelowThreshold(t *testing.T) {
	s := newHalloweenTestService(t)

	report := &models.HalloweenGameReport{
		CompletedRounds: 1, // 1000 * (1*2)/2 = 1000
		Score:           400,
	}
	resp, err := s.SubmitGame("user-3", report)
	if err != nil {
		t.Fatalf("SubmitGame failed: %v", err)
	}
	if len(resp.Granted) != 0 {
		t.Fatalf("expected no rewards below 1000, got %v", resp.Granted)
	}
}

func TestHalloweenSubmitGameDetectsCheater(t *testing.T) {
	s := newHalloweenTestService(t)

	// Legit score would be 50; report claims 5000.
	report := &models.HalloweenGameReport{
		Kills: []models.HalloweenSlugKill{
			{Type: HalloweenSlugGerald, X: 800, Source: "pumpkin"}, // 50
		},
		CompletedRounds: 1, // 1000
		Score:           6000,
	}
	resp, err := s.SubmitGame("user-4", report)
	if err != nil {
		t.Fatalf("SubmitGame failed: %v", err)
	}
	if !resp.IsCheater {
		t.Fatal("expected cheater flag")
	}
	if len(resp.Granted) != 0 {
		t.Fatalf("expected no rewards for cheater, got %v", resp.Granted)
	}

	// Cheater games must be excluded from the leaderboard.
	legit := &models.HalloweenGameReport{
		Kills: []models.HalloweenSlugKill{
			{Type: HalloweenSlugGerald, X: 800, Source: "pumpkin"}, // 50
		},
		CompletedRounds: 1,
		Score:           1050,
	}
	if _, err := s.SubmitGame("user-4", legit); err != nil {
		t.Fatalf("SubmitGame failed: %v", err)
	}

	entries, err := s.GetLeaderboard()
	if err != nil {
		t.Fatalf("GetLeaderboard failed: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 leaderboard entry, got %d", len(entries))
	}
	if entries[0].UserID != "user-4" || entries[0].BestScore != 1050 {
		t.Fatalf("unexpected leaderboard entry: %+v", entries[0])
	}
}

func TestHalloweenSubmitGameAllRewardsEarned(t *testing.T) {
	s := newHalloweenTestService(t)

	// Drain the common pool one reward per game (round 1, score 1010 lands in
	// the common bracket; the cascade breaks at the first empty tier, so top
	// tiers can never serve commons).
	report := &models.HalloweenGameReport{
		Kills:           []models.HalloweenSlugKill{{Type: HalloweenSlugScout, X: 800, Source: "pumpkin"}}, // 10
		CompletedRounds: 1,                                                                                 // 1000 * (1*2)/2 = 1000
		Score:           1010,
	}

	state, err := s.GetState("user-5")
	if err != nil {
		t.Fatalf("GetState failed: %v", err)
	}
	poolSize := 0
	for _, c := range state.Catalog {
		if c.Rarity == "common" {
			poolSize++
		}
	}

	// Repeated submissions drain the pool (1 reward per round-1 game).
	var totalGranted int
	var lastMessage string
	for {
		resp, err := s.SubmitGame("user-5", report)
		if err != nil {
			t.Fatalf("SubmitGame failed: %v", err)
		}
		totalGranted += len(resp.Granted)
		lastMessage = resp.Message
		if len(resp.Granted) == 0 {
			break
		}
		if totalGranted > poolSize+5 {
			t.Fatal("loop did not terminate, pool never exhausted")
		}
	}
	if totalGranted != poolSize {
		t.Fatalf("expected all %d common catalog items to be granted, got %d", poolSize, totalGranted)
	}
	if lastMessage == "" {
		t.Fatal("expected an 'all rewards earned' style message")
	}
}

func TestHalloweenUpdatePumpkinState(t *testing.T) {
	s := newHalloweenTestService(t)

	// Unearned items are locked: the free base equips, a locked hat does not.
	if err := s.UpdatePumpkin("user-6", `{"base":"base_a"}`); err != nil {
		t.Fatalf("UpdatePumpkin free base failed: %v", err)
	}
	if err := s.UpdatePumpkin("user-6", `{"hat":"hat_party"}`); err == nil {
		t.Fatal("expected locked hat to be rejected")
	}
	if err := s.UpdatePumpkin("user-6", "not-json"); err == nil {
		t.Fatal("expected invalid JSON to be rejected")
	}

	// After an admin grant the hat equips fine.
	if _, err := s.IssueReward("user-6", "hat_party"); err != nil {
		t.Fatalf("IssueReward failed: %v", err)
	}
	if err := s.UpdatePumpkin("user-6", `{"base":"base_a","hat":"hat_party"}`); err != nil {
		t.Fatalf("UpdatePumpkin failed: %v", err)
	}

	state, err := s.GetState("user-6")
	if err != nil {
		t.Fatalf("GetState failed: %v", err)
	}
	if state.EquippedJSON != `{"base":"base_a","hat":"hat_party"}` {
		t.Fatalf("unexpected equipped json: %s", state.EquippedJSON)
	}
}

func TestHalloweenAdminIssueReward(t *testing.T) {
	s := newHalloweenTestService(t)

	granted, err := s.IssueReward("user-7", "hat_party")
	if err != nil {
		t.Fatalf("IssueReward failed: %v", err)
	}
	if !granted {
		t.Fatal("expected reward to be granted")
	}

	// Duplicate grant should be refused (no-duplicate pool).
	granted, err = s.IssueReward("user-7", "hat_party")
	if err != nil {
		t.Fatalf("IssueReward failed: %v", err)
	}
	if granted {
		t.Fatal("expected duplicate reward to be refused")
	}

	if _, err := s.IssueReward("user-7", "does_not_exist"); err == nil {
		t.Fatal("expected unknown item to error")
	}
}

func TestHalloweenAdminGameIncomeSplit(t *testing.T) {
	s := newHalloweenTestService(t)

	// 2 scouts (kill_reward 2) + 1 marvin (kill_reward 5) killed; coins_earned
	// includes +40 seeds produced by cramer.
	report := &models.HalloweenGameReport{
		SpawnedPumpkins: map[string]int{"ferdinand": 2, "cramer": 1},
		Kills: []models.HalloweenSlugKill{
			{Type: HalloweenSlugScout, X: 800, Source: "pumpkin"},
			{Type: HalloweenSlugScout, X: 600, Source: "pumpkin"},
			{Type: HalloweenSlugMarvin, X: 400, Source: "pumpkin"},
		},
		CompletedRounds: 1,
		Score:           10 + 7 + 10 + 1000, // scouts + marvin + round bonus
		CoinsEarned:     2 + 2 + 5 + 40,
		CoinsSpent:      40,
	}

	if _, err := s.SubmitGame("user-1", report); err != nil {
		t.Fatalf("SubmitGame failed: %v", err)
	}

	games, err := s.GetAdminGames()
	if err != nil {
		t.Fatalf("GetAdminGames failed: %v", err)
	}
	if len(games) != 1 {
		t.Fatalf("expected 1 game, got %d", len(games))
	}

	g := games[0]
	if g.KillIncome != 9 {
		t.Errorf("kill_income = %d, want 9", g.KillIncome)
	}
	if g.CramerIncome != 40 {
		t.Errorf("cramer_income = %d, want 40", g.CramerIncome)
	}
	if g.SpawnedPumpkins["cramer"] != 1 {
		t.Errorf("spawned pumpkins = %v, want cramer x1", g.SpawnedPumpkins)
	}
	if g.KillsByType[HalloweenSlugScout] != 2 || g.KillsByType[HalloweenSlugMarvin] != 1 {
		t.Errorf("kills_by_type = %v, want scout x2 marvin x1", g.KillsByType)
	}
	if g.CoinsEarned != 49 || g.CoinsSpent != 40 {
		t.Errorf("coins earned/spent = %d/%d, want 49/40", g.CoinsEarned, g.CoinsSpent)
	}

	rewards, err := s.GetAdminRewards()
	if err != nil {
		t.Fatalf("GetAdminRewards failed: %v", err)
	}
	if len(rewards) != 1 {
		t.Fatalf("expected 1 reward for score 1027, got %d", len(rewards))
	}
	if rewards[0].UserID != "user-1" || rewards[0].Rarity != HalloweenRarityCommon {
		t.Errorf("unexpected reward row: %+v", rewards[0])
	}
	if rewards[0].Source != "game" {
		t.Errorf("expected game source, got %q", rewards[0].Source)
	}
}

func TestHalloweenBotSubmissionSkipsRewards(t *testing.T) {
	s := newHalloweenTestService(t)

	// 2 completed rounds, no kills: score is exactly the round bonus.
	report := &models.HalloweenGameReport{
		CompletedRounds: 2,
		Score:           3000,
		Source:          models.HalloweenSourceSystemOne,
		Model:           "winnow:e4b",
	}

	res, err := s.SubmitGame(models.HalloweenBotUserID, report)
	if err != nil {
		t.Fatalf("SubmitGame failed: %v", err)
	}
	if len(res.Granted) != 0 || res.Message != "" {
		t.Errorf("bot submission granted %v with message %q, want no rewards", res.Granted, res.Message)
	}
	if res.IsCheater {
		t.Error("bot submission with exact score flagged as cheater")
	}

	games, err := s.GetAdminGames()
	if err != nil {
		t.Fatalf("GetAdminGames failed: %v", err)
	}
	if len(games) != 1 {
		t.Fatalf("expected 1 game, got %d", len(games))
	}
	if games[0].Source != models.HalloweenSourceSystemOne {
		t.Errorf("source = %q, want systemone", games[0].Source)
	}
	if games[0].Model != "winnow:e4b" {
		t.Errorf("model = %q, want winnow:e4b", games[0].Model)
	}

	// Bots never appear on the leaderboard or earn rewards.
	entries, err := s.GetLeaderboard()
	if err != nil {
		t.Fatalf("GetLeaderboard failed: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("expected empty leaderboard, got %+v", entries)
	}
	rewards, err := s.GetAdminRewards()
	if err != nil {
		t.Fatalf("GetAdminRewards failed: %v", err)
	}
	if len(rewards) != 0 {
		t.Errorf("expected no rewards, got %+v", rewards)
	}
}

func TestHalloweenSubmitGameRejectsUnknownSource(t *testing.T) {
	s := newHalloweenTestService(t)

	report := &models.HalloweenGameReport{Source: "alien"}
	if _, err := s.SubmitGame("user-1", report); err == nil {
		t.Fatal("expected unknown source to error")
	}
}

func TestHalloweenSocketSystemSeed(t *testing.T) {
	s := newHalloweenTestService(t)

	state, err := s.GetState("user-1")
	if err != nil {
		t.Fatalf("GetState failed: %v", err)
	}

	// Seeded base + feet items are live in the client catalog.
	byID := map[string]models.HalloweenItem{}
	for _, c := range state.Catalog {
		byID[c.ID] = c
	}
	base, ok := byID["base_a"]
	if !ok {
		t.Fatal("expected seeded base_a in catalog")
	}
	if base.Socket != "base" {
		t.Errorf("base_a socket = %q, want base", base.Socket)
	}
	// All art is backend-owned: every catalog row points at the asset endpoint.
	for _, c := range state.Catalog {
		want := "/api/halloween/assets/" + c.ID
		if c.AssetPath != want {
			t.Errorf("item %s asset_path = %q, want %q", c.ID, c.AssetPath, want)
		}
	}
	if _, ok := byID["feet_boots"]; !ok {
		t.Fatal("expected seeded feet_boots in catalog")
	}

	// Seeded per-base anchors are served with state.
	layout, ok := state.BaseLayouts["base_a"]
	if !ok {
		t.Fatal("expected base_layouts for base_a")
	}
	for _, socket := range []string{"hat", "eyes", "mouth", "feet"} {
		if _, ok := layout[socket]; !ok {
			t.Errorf("expected anchor for socket %q", socket)
		}
	}
}

func TestHalloweenItemCRUDSoftDelete(t *testing.T) {
	s := newHalloweenTestService(t)

	created, err := s.CreateItem(&models.CreateHalloweenItemRequest{
		ID: "hat_test", Name: "Test Hat", Socket: "hat",
		Rarity: "common", ZIndex: 21, Scale: 1.5,
	})
	if err != nil {
		t.Fatalf("CreateItem failed: %v", err)
	}
	if created.ZIndex != 21 {
		t.Errorf("z_index = %d, want 21", created.ZIndex)
	}
	if created.Scale != 1.5 {
		t.Errorf("scale = %v, want 1.5", created.Scale)
	}

	updated, err := s.UpdateItem("hat_test", &models.UpdateHalloweenItemRequest{
		Name: "Test Hat v2", Socket: "hat",
		Rarity: "rare", ZIndex: -2, Scale: 0.5,
	})
	if err != nil {
		t.Fatalf("UpdateItem failed: %v", err)
	}
	if updated.Scale != 0.5 {
		t.Fatalf("updated scale = %v, want 0.5", updated.Scale)
	}

	// Out-of-range scales are rejected.
	for _, bad := range []float64{0.1, 2.5} {
		if _, err := s.UpdateItem("hat_test", &models.UpdateHalloweenItemRequest{
			Name: "Test Hat v2", Socket: "hat",
			Rarity: "rare", ZIndex: -2, Scale: bad,
		}); err == nil {
			t.Fatalf("expected scale %v to be rejected", bad)
		}
	}
	if _, err := s.CreateItem(&models.CreateHalloweenItemRequest{
		ID: "hat_bad", Name: "Bad", Socket: "hat",
		Rarity: "common", ZIndex: 20, Scale: 5,
	}); err == nil {
		t.Fatal("expected out-of-range create scale to be rejected")
	}

	if err := s.SoftDeleteItem("hat_test"); err != nil {
		t.Fatalf("SoftDeleteItem failed: %v", err)
	}
	state, err := s.GetState("user-1")
	if err != nil {
		t.Fatalf("GetState failed: %v", err)
	}
	for _, c := range state.Catalog {
		if c.ID == "hat_test" {
			t.Fatal("soft-deleted item must not reach clients")
		}
	}
	admin, err := s.GetAdminCatalog()
	if err != nil {
		t.Fatalf("GetAdminCatalog failed: %v", err)
	}
	found := false
	for _, c := range admin {
		if c.ID == "hat_test" {
			found = true
			if !c.IsDeleted {
				t.Error("admin row should carry is_deleted")
			}
		}
	}
	if !found {
		t.Fatal("admin catalog must still list soft-deleted rows")
	}

	if err := s.RestoreItem("hat_test"); err != nil {
		t.Fatalf("RestoreItem failed: %v", err)
	}
	state, err = s.GetState("user-1")
	if err != nil {
		t.Fatalf("GetState failed: %v", err)
	}
	restored := false
	for _, c := range state.Catalog {
		if c.ID == "hat_test" {
			restored = true
		}
	}
	if !restored {
		t.Fatal("restored item must be visible to clients again")
	}
}

func TestHalloweenUpsertBaseSockets(t *testing.T) {
	s := newHalloweenTestService(t)

	// Unknown base errors.
	if err := s.UpsertBaseSockets("nope", nil); err == nil {
		t.Fatal("expected unknown base to error")
	}
	// Non-base item errors.
	if err := s.UpsertBaseSockets("hat_party", nil); err == nil {
		t.Fatal("expected non-base item to error")
	}
	// Out-of-range offsets error.
	if err := s.UpsertBaseSockets("base_a", []models.HalloweenBaseSocket{
		{BaseID: "base_a", Socket: "hat", OffsetX: 2, OffsetY: 0},
	}); err == nil {
		t.Fatal("expected out-of-range offset to error")
	}

	err := s.UpsertBaseSockets("base_a", []models.HalloweenBaseSocket{
		{BaseID: "base_a", Socket: "hat", OffsetX: 0.1, OffsetY: -0.4},
		{BaseID: "base_a", Socket: "feet", OffsetX: 0, OffsetY: 0.5},
	})
	if err != nil {
		t.Fatalf("UpsertBaseSockets failed: %v", err)
	}
	rows, err := s.GetBaseSockets("base_a")
	if err != nil {
		t.Fatalf("GetBaseSockets failed: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected 2 anchors (replace semantics), got %d", len(rows))
	}
}

func TestHalloweenCatalogAutoSort(t *testing.T) {
	s := newHalloweenTestService(t)

	seed := []models.CreateHalloweenItemRequest{
		{ID: "eyes_zed", Name: "zed", Socket: "eyes", Rarity: "legendary", ZIndex: 10, Scale: 1},
		{ID: "hat_alpha", Name: "alpha", Socket: "hat", Rarity: "common", ZIndex: 20, Scale: 1},
		{ID: "hat_beta", Name: "Beta", Socket: "hat", Rarity: "rare", ZIndex: 20, Scale: 1},
		{ID: "mouth_mid", Name: "mid", Socket: "mouth", Rarity: "epic", ZIndex: 11, Scale: 1},
		{ID: "eyes_amber", Name: "Amber", Socket: "eyes", Rarity: "rare", ZIndex: 10, Scale: 1},
		{ID: "base_zulu", Name: "Zulu", Socket: "base", Rarity: "rare", ZIndex: 0, Scale: 1},
	}
	for _, req := range seed {
		req := req
		if _, err := s.CreateItem(&req); err != nil {
			t.Fatalf("CreateItem %s failed: %v", req.ID, err)
		}
	}

	state, err := s.GetState("user-1")
	if err != nil {
		t.Fatalf("GetState failed: %v", err)
	}
	var got []string
	for _, c := range state.Catalog {
		switch c.ID {
		case "eyes_zed", "hat_alpha", "hat_beta", "mouth_mid", "eyes_amber", "base_zulu":
			got = append(got, c.ID)
		}
	}
	// socket (base, hat, eyes, mouth) → rarity (legendary first) → name.
	want := []string{"base_zulu", "hat_beta", "hat_alpha", "eyes_zed", "eyes_amber", "mouth_mid"}
	if len(got) != len(want) {
		t.Fatalf("sorted ids = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("sorted ids = %v, want %v", got, want)
		}
	}

	admin, err := s.GetAdminCatalog()
	if err != nil {
		t.Fatalf("GetAdminCatalog failed: %v", err)
	}
	var adminGot []string
	for _, c := range admin {
		switch c.ID {
		case "eyes_zed", "hat_alpha", "hat_beta", "mouth_mid", "eyes_amber", "base_zulu":
			adminGot = append(adminGot, c.ID)
		}
	}
	for i := range want {
		if adminGot[i] != want[i] {
			t.Fatalf("admin sorted ids = %v, want %v", adminGot, want)
		}
	}
}

func TestHalloweenRarityValidation(t *testing.T) {
	s := newHalloweenTestService(t)

	// Epic and legendary are valid catalog tiers now.
	for _, rarity := range []string{"common", "uncommon", "rare", "epic", "legendary"} {
		if _, err := s.CreateItem(&models.CreateHalloweenItemRequest{
			ID: "hat_" + rarity, Name: rarity, Socket: "hat",
			Rarity: rarity, ZIndex: 20, Scale: 1,
		}); err != nil {
			t.Fatalf("CreateItem rarity %q failed: %v", rarity, err)
		}
	}

	// The retired regular tier and unknown strings are rejected.
	for _, rarity := range []string{"regular", "mythic", ""} {
		if _, err := s.CreateItem(&models.CreateHalloweenItemRequest{
			ID: "hat_bad_" + rarity, Name: "bad", Socket: "hat",
			Rarity: rarity, ZIndex: 20, Scale: 1,
		}); err == nil {
			t.Fatalf("expected rarity %q to be rejected", rarity)
		}
	}
	if _, err := s.UpdateItem("hat_common", &models.UpdateHalloweenItemRequest{
		Name: "x", Socket: "hat", Rarity: "regular", ZIndex: 20, Scale: 1,
	}); err == nil {
		t.Fatal("expected regular rarity update to be rejected")
	}
}

func TestHalloweenUpdatePumpkinGate(t *testing.T) {
	s := newHalloweenTestService(t)

	if _, err := s.CreateItem(&models.CreateHalloweenItemRequest{
		ID: "hat_gate", Name: "Gate", Socket: "hat",
		Rarity: "common", ZIndex: 20, Scale: 1,
	}); err != nil {
		t.Fatalf("CreateItem failed: %v", err)
	}

	// The free starter base is equippable with nothing earned.
	if err := s.UpdatePumpkin("user-gate", `{"base":"base_a"}`); err != nil {
		t.Fatalf("free base must be equippable: %v", err)
	}
	// Unequipping everything stays legal.
	if err := s.UpdatePumpkin("user-gate", `{}`); err != nil {
		t.Fatalf("empty customization must be legal: %v", err)
	}
	// Unknown ids, wrong-socket slots, and unowned items are rejected.
	for _, bad := range []string{
		`{"hat":"nope"}`,
		`{"base":"hat_gate"}`,
		`{"hat":"hat_gate"}`,
	} {
		if err := s.UpdatePumpkin("user-gate", bad); err == nil {
			t.Fatalf("expected %s to be rejected", bad)
		}
	}

	// After an admin grant the item equips fine.
	granted, err := s.IssueReward("user-gate", "hat_gate")
	if err != nil || !granted {
		t.Fatalf("IssueReward failed: granted=%v err=%v", granted, err)
	}
	if err := s.UpdatePumpkin("user-gate", `{"base":"base_a","hat":"hat_gate"}`); err != nil {
		t.Fatalf("owned item must be equippable: %v", err)
	}
}

func TestHalloweenMigrationFlattensRarity(t *testing.T) {
	s := newHalloweenTestService(t)

	// Migration 28 flattened every seeded row to common (admins re-tier after).
	state, err := s.GetState("user-1")
	if err != nil {
		t.Fatalf("GetState failed: %v", err)
	}
	if len(state.Catalog) == 0 {
		t.Fatal("expected seeded catalog")
	}
	for _, c := range state.Catalog {
		if c.Rarity != "common" {
			t.Errorf("item %s rarity = %q, want common after migration 28", c.ID, c.Rarity)
		}
	}
}

func catalogSnapshot(t *testing.T, s *HalloweenService) (items map[string]models.HalloweenItem, layouts map[string]map[string]models.HalloweenBaseSocket) {
	t.Helper()
	admin, err := s.GetAdminCatalog()
	if err != nil {
		t.Fatalf("GetAdminCatalog failed: %v", err)
	}
	items = map[string]models.HalloweenItem{}
	for _, c := range admin {
		items[c.ID] = *c
	}
	state, err := s.GetState("user-1")
	if err != nil {
		t.Fatalf("GetState failed: %v", err)
	}
	layouts = state.BaseLayouts
	return items, layouts
}

func TestHalloweenConfigExport(t *testing.T) {
	s := newHalloweenTestService(t)

	// Soft-deleted rows must not leak into the export (live only).
	if _, err := s.CreateItem(&models.CreateHalloweenItemRequest{
		ID: "hat_gone", Name: "Gone", Socket: "hat",
		Rarity: "common", ZIndex: 20, Scale: 1,
	}); err != nil {
		t.Fatalf("CreateItem failed: %v", err)
	}
	if err := s.SoftDeleteItem("hat_gone"); err != nil {
		t.Fatalf("SoftDeleteItem failed: %v", err)
	}

	cfg, err := s.ExportConfig()
	if err != nil {
		t.Fatalf("ExportConfig failed: %v", err)
	}
	if cfg.Version != models.HalloweenConfigVersion {
		t.Errorf("version = %d, want %d", cfg.Version, models.HalloweenConfigVersion)
	}
	if cfg.ExportedAt.IsZero() {
		t.Error("exported_at must be stamped")
	}
	for _, item := range cfg.Items {
		if item.ID == "hat_gone" {
			t.Error("soft-deleted item must not be exported")
		}
		if item.ID == "" || item.Name == "" {
			t.Errorf("exported item missing id/name: %+v", item)
		}
	}
	if _, ok := cfg.BaseLayouts["base_a"]; !ok {
		t.Error("expected base_a layouts in export")
	}
	// Export order follows the catalog sort (socket → rarity → name).
	toItem := func(c models.HalloweenConfigItem) models.HalloweenItem {
		return models.HalloweenItem{ID: c.ID, Name: c.Name, Socket: c.Socket, Rarity: c.Rarity}
	}
	for i := 1; i < len(cfg.Items); i++ {
		if catalogLess(toItem(cfg.Items[i]), toItem(cfg.Items[i-1])) {
			t.Fatalf("export items not sorted at index %d (%s before %s)", i, cfg.Items[i].ID, cfg.Items[i-1].ID)
		}
	}
}

func TestHalloweenConfigImportReplace(t *testing.T) {
	s := newHalloweenTestService(t)

	before, _ := catalogSnapshot(t, s)
	keepID := "base_a"
	dropID := "feet_boots"
	if _, ok := before[dropID]; !ok {
		t.Fatalf("expected seeded %s", dropID)
	}
	keep := before[keepID]

	err := s.ImportConfig(&models.HalloweenConfigImport{
		Version: models.HalloweenConfigVersion,
		Items: []models.HalloweenConfigItem{
			{ID: keepID, Name: "Classic Renamed", Socket: "base", Rarity: "legendary", ZIndex: 0, Scale: 1},
			{ID: "hat_new", Name: "New Hat", Socket: "hat", Rarity: "epic", ZIndex: 20, Scale: 1.5},
		},
		BaseLayouts: map[string]map[string]models.HalloweenBaseSocket{
			keepID: {
				"hat": {BaseID: keepID, Socket: "hat", OffsetX: 0.1, OffsetY: -0.4},
			},
		},
	})
	if err != nil {
		t.Fatalf("ImportConfig failed: %v", err)
	}

	after, layouts := catalogSnapshot(t, s)
	if len(after) != len(before)+1 { // +1 new, drop stays as soft-deleted row
		t.Fatalf("expected %d admin rows, got %d", len(before)+1, len(after))
	}
	renamed := after[keepID]
	if renamed.Name != "Classic Renamed" || renamed.Rarity != "legendary" {
		t.Errorf("base_a not updated: %+v", renamed)
	}
	if renamed.AssetPath != keep.AssetPath {
		t.Errorf("import must preserve art: asset_path %q, want %q", renamed.AssetPath, keep.AssetPath)
	}
	if renamed.IsDeleted {
		t.Error("imported rows must be live")
	}
	if after[dropID].IsDeleted != true {
		t.Errorf("missing ids must be soft-deleted: %+v", after[dropID])
	}
	if after["hat_new"].Rarity != "epic" || after["hat_new"].Scale != 1.5 {
		t.Errorf("new item not created: %+v", after["hat_new"])
	}
	// Layouts are rewritten, not merged.
	if len(layouts) != 1 {
		t.Fatalf("expected layouts for 1 base, got %d", len(layouts))
	}
	hat, ok := layouts[keepID]["hat"]
	if !ok || hat.OffsetX != 0.1 || hat.OffsetY != -0.4 {
		t.Errorf("unexpected hat anchor: %+v", layouts[keepID])
	}

	// Live clients see exactly the file's rows.
	state, err := s.GetState("user-1")
	if err != nil {
		t.Fatalf("GetState failed: %v", err)
	}
	if len(state.Catalog) != 2 {
		t.Fatalf("expected 2 live items, got %d", len(state.Catalog))
	}
}

func TestHalloweenConfigImportRejects(t *testing.T) {
	validItem := models.HalloweenConfigItem{ID: "base_a", Name: "Classic", Socket: "base", Rarity: "common", ZIndex: 0, Scale: 1}
	validLayouts := map[string]map[string]models.HalloweenBaseSocket{
		"base_a": {"hat": {BaseID: "base_a", Socket: "hat", OffsetX: 0, OffsetY: -0.45}},
	}
	cases := map[string]models.HalloweenConfigImport{
		"bad version":    {Version: 999, Items: []models.HalloweenConfigItem{validItem}, BaseLayouts: validLayouts},
		"missing id":     {Version: 1, Items: []models.HalloweenConfigItem{{Name: "x", Socket: "hat", Rarity: "common", Scale: 1}}, BaseLayouts: validLayouts},
		"missing name":   {Version: 1, Items: []models.HalloweenConfigItem{{ID: "x", Socket: "hat", Rarity: "common", Scale: 1}}, BaseLayouts: validLayouts},
		"duplicate id":   {Version: 1, Items: []models.HalloweenConfigItem{validItem, validItem}, BaseLayouts: validLayouts},
		"bad socket":     {Version: 1, Items: []models.HalloweenConfigItem{{ID: "x", Name: "x", Socket: "cape", Rarity: "common", Scale: 1}}, BaseLayouts: validLayouts},
		"bad rarity":     {Version: 1, Items: []models.HalloweenConfigItem{{ID: "x", Name: "x", Socket: "hat", Rarity: "mythic", Scale: 1}}, BaseLayouts: validLayouts},
		"retired rarity": {Version: 1, Items: []models.HalloweenConfigItem{{ID: "x", Name: "x", Socket: "hat", Rarity: "regular", Scale: 1}}, BaseLayouts: validLayouts},
		"bad scale":      {Version: 1, Items: []models.HalloweenConfigItem{{ID: "x", Name: "x", Socket: "hat", Rarity: "common", Scale: 5}}, BaseLayouts: validLayouts},
		"unknown layout base": {Version: 1, Items: []models.HalloweenConfigItem{validItem}, BaseLayouts: map[string]map[string]models.HalloweenBaseSocket{
			"nope": {"hat": {BaseID: "nope", Socket: "hat"}},
		}},
		"non-base layout base": {Version: 1, Items: []models.HalloweenConfigItem{
			validItem, {ID: "hat_x", Name: "x", Socket: "hat", Rarity: "common", Scale: 1},
		}, BaseLayouts: map[string]map[string]models.HalloweenBaseSocket{
			"base_a": validLayouts["base_a"],
			"hat_x":  {"eyes": {BaseID: "hat_x", Socket: "eyes"}},
		}},
		"bad layout socket": {Version: 1, Items: []models.HalloweenConfigItem{validItem}, BaseLayouts: map[string]map[string]models.HalloweenBaseSocket{
			"base_a": {"base": {BaseID: "base_a", Socket: "base"}},
		}},
		"offset out of range": {Version: 1, Items: []models.HalloweenConfigItem{validItem}, BaseLayouts: map[string]map[string]models.HalloweenBaseSocket{
			"base_a": {"hat": {BaseID: "base_a", Socket: "hat", OffsetX: 2}},
		}},
	}

	for name, req := range cases {
		s := newHalloweenTestService(t)
		before, _ := catalogSnapshot(t, s)
		if err := s.ImportConfig(&req); err == nil {
			t.Errorf("%s: expected import to be rejected", name)
			continue
		}
		after, _ := catalogSnapshot(t, s)
		if len(after) != len(before) {
			t.Errorf("%s: rejected import changed the catalog (%d → %d rows)", name, len(before), len(after))
		}
		for id, item := range before {
			if got, ok := after[id]; !ok || got != item {
				t.Errorf("%s: rejected import mutated row %s", name, id)
				break
			}
		}
	}

	// Nil request is rejected too.
	s := newHalloweenTestService(t)
	if err := s.ImportConfig(nil); err == nil {
		t.Error("expected nil import to be rejected")
	}
}

func TestHalloweenConfigImportExportRoundTrip(t *testing.T) {
	s := newHalloweenTestService(t)

	cfg, err := s.ExportConfig()
	if err != nil {
		t.Fatalf("ExportConfig failed: %v", err)
	}
	names := map[string]string{}
	for _, item := range cfg.Items {
		names[item.ID] = item.Name
	}

	// Wipe everything via an empty (but versioned) import, then restore.
	if err := s.ImportConfig(&models.HalloweenConfigImport{Version: 1}); err != nil {
		t.Fatalf("empty import failed: %v", err)
	}
	state, err := s.GetState("user-1")
	if err != nil {
		t.Fatalf("GetState failed: %v", err)
	}
	if len(state.Catalog) != 0 {
		t.Fatalf("expected empty live catalog after wipe, got %d", len(state.Catalog))
	}

	payload := &models.HalloweenConfigImport{
		Version:     cfg.Version,
		Items:       cfg.Items,
		BaseLayouts: cfg.BaseLayouts,
	}
	if err := s.ImportConfig(payload); err != nil {
		t.Fatalf("restore import failed: %v", err)
	}

	restored, err := s.GetState("user-1")
	if err != nil {
		t.Fatalf("GetState failed: %v", err)
	}
	if len(restored.Catalog) != len(cfg.Items) {
		t.Fatalf("expected %d restored items, got %d", len(cfg.Items), len(restored.Catalog))
	}
	for _, c := range restored.Catalog {
		if names[c.ID] != c.Name {
			t.Errorf("item %s name = %q, want %q", c.ID, c.Name, names[c.ID])
		}
	}
}

func TestHalloweenRewardsSkipEmptyTopTiers(t *testing.T) {
	s := newHalloweenTestService(t)

	// Legendary score, but the legendary pool is empty (seed catalog is all
	// common after migration 28): the grant must skip down to common.
	kills := make([]models.HalloweenSlugKill, 0, 280)
	for i := 0; i < 280; i++ {
		kills = append(kills, models.HalloweenSlugKill{Type: HalloweenSlugGerald, X: 800, Source: "pumpkin"}) // 50 each
	}
	report := &models.HalloweenGameReport{
		Kills:           kills, // 14000
		CompletedRounds: 1,     // +1000 = 15000
		Score:           15000,
	}
	resp, err := s.SubmitGame("user-skip", report)
	if err != nil {
		t.Fatalf("SubmitGame failed: %v", err)
	}
	if resp.IsCheater {
		t.Fatal("expected no cheater flag")
	}
	if len(resp.Granted) != 1 {
		t.Fatalf("expected 1 skipped-down grant, got %v (message %q)", resp.Granted, resp.Message)
	}
	if resp.Message != "" {
		t.Fatalf("expected no exhaustion message, got %q", resp.Message)
	}
	rewards, err := s.GetAdminRewards()
	if err != nil {
		t.Fatalf("GetAdminRewards failed: %v", err)
	}
	if len(rewards) != 1 || rewards[0].Rarity != HalloweenRarityCommon {
		t.Fatalf("expected one common grant, got %+v", rewards)
	}
}

func TestHalloweenRewardsNeverGrantUp(t *testing.T) {
	s := newHalloweenTestService(t)

	for _, req := range []models.CreateHalloweenItemRequest{
		{ID: "hat_mid", Name: "Mid", Socket: "hat", Rarity: "uncommon", ZIndex: 20, Scale: 1},
		{ID: "hat_top", Name: "Top", Socket: "hat", Rarity: "epic", ZIndex: 20, Scale: 1},
	} {
		req := req
		if _, err := s.CreateItem(&req); err != nil {
			t.Fatalf("CreateItem %s failed: %v", req.ID, err)
		}
	}

	// 2500 points → uncommon tier: must grant the uncommon item, never epic.
	kills := make([]models.HalloweenSlugKill, 0, 30)
	for i := 0; i < 30; i++ {
		kills = append(kills, models.HalloweenSlugKill{Type: HalloweenSlugGerald, X: 800, Source: "pumpkin"}) // 50 each
	}
	report := &models.HalloweenGameReport{
		Kills:           kills, // 1500
		CompletedRounds: 1,     // +1000 = 2500
		Score:           2500,
	}
	resp, err := s.SubmitGame("user-mid", report)
	if err != nil {
		t.Fatalf("SubmitGame failed: %v", err)
	}
	if len(resp.Granted) != 1 || resp.Granted[0] != "hat_mid" {
		t.Fatalf("expected exactly the uncommon grant, got %v (message %q)", resp.Granted, resp.Message)
	}
}

func TestHalloweenRewardsCountPreservedAcrossSkips(t *testing.T) {
	s := newHalloweenTestService(t)

	// 15000 points, round 5 → 2 grants; top pools empty → both from common.
	report := &models.HalloweenGameReport{
		CompletedRounds: 5, // 1000 * (5*6)/2 = 15000
		Score:           15000,
	}
	resp, err := s.SubmitGame("user-count", report)
	if err != nil {
		t.Fatalf("SubmitGame failed: %v", err)
	}
	if len(resp.Granted) != 2 {
		t.Fatalf("expected full count of 2 lower-tier grants, got %v (message %q)", resp.Granted, resp.Message)
	}
	if resp.Message != "" {
		t.Fatalf("expected no exhaustion message, got %q", resp.Message)
	}
}

func ownAllCatalog(t *testing.T, s *HalloweenService, userID string) {
	t.Helper()
	state, err := s.GetState(userID)
	if err != nil {
		t.Fatalf("GetState failed: %v", err)
	}
	for _, c := range state.Catalog {
		granted, err := s.IssueReward(userID, c.ID)
		if err != nil || !granted {
			t.Fatalf("IssueReward %s failed: granted=%v err=%v", c.ID, granted, err)
		}
	}
}

func TestHalloweenRewardsExhaustionMessages(t *testing.T) {
	midKills := func() []models.HalloweenSlugKill {
		kills := make([]models.HalloweenSlugKill, 0, 30)
		for i := 0; i < 30; i++ {
			kills = append(kills, models.HalloweenSlugKill{Type: HalloweenSlugGerald, X: 800, Source: "pumpkin"})
		}
		return kills
	}

	// Lower pools exhausted but a rarer item is still unearned → the player
	// is told to reach a higher score.
	s := newHalloweenTestService(t)
	if _, err := s.CreateItem(&models.CreateHalloweenItemRequest{
		ID: "hat_rare_left", Name: "Left", Socket: "hat", Rarity: "rare", ZIndex: 20, Scale: 1,
	}); err != nil {
		t.Fatalf("CreateItem failed: %v", err)
	}
	state, err := s.GetState("user-low")
	if err != nil {
		t.Fatalf("GetState failed: %v", err)
	}
	for _, c := range state.Catalog {
		if c.ID == "hat_rare_left" {
			continue // stays unearned: the higher-score bait
		}
		if granted, err := s.IssueReward("user-low", c.ID); err != nil || !granted {
			t.Fatalf("IssueReward %s failed: granted=%v err=%v", c.ID, granted, err)
		}
	}
	resp, err := s.SubmitGame("user-low", &models.HalloweenGameReport{
		Kills:           midKills(), // 1500
		CompletedRounds: 1,          // +1000 = 2500 (uncommon tier)
		Score:           2500,
	})
	if err != nil {
		t.Fatalf("SubmitGame failed: %v", err)
	}
	if len(resp.Granted) != 0 {
		t.Fatalf("expected no grants, got %v", resp.Granted)
	}
	want := "no more rewards at this score - reach a higher score for rarer rewards"
	if resp.Message != want {
		t.Fatalf("message = %q, want %q", resp.Message, want)
	}

	// Everything owned → truly done.
	s2 := newHalloweenTestService(t)
	ownAllCatalog(t, s2, "user-done")
	resp, err = s2.SubmitGame("user-done", &models.HalloweenGameReport{
		CompletedRounds: 5, // 15000 (legendary tier)
		Score:           15000,
	})
	if err != nil {
		t.Fatalf("SubmitGame failed: %v", err)
	}
	if len(resp.Granted) != 0 {
		t.Fatalf("expected no grants, got %v", resp.Granted)
	}
	if resp.Message != "all rewards have been earned" {
		t.Fatalf("message = %q, want the final exhaustion message", resp.Message)
	}
}

func TestHalloweenRewardsNoSameGameDuplicates(t *testing.T) {
	s := newHalloweenTestService(t)

	// Leave exactly one item unearned in the whole catalog.
	state, err := s.GetState("user-dup")
	if err != nil {
		t.Fatalf("GetState failed: %v", err)
	}
	if len(state.Catalog) < 2 {
		t.Fatalf("expected a seeded catalog, got %d rows", len(state.Catalog))
	}
	lastID := state.Catalog[len(state.Catalog)-1].ID
	for _, c := range state.Catalog[:len(state.Catalog)-1] {
		if granted, err := s.IssueReward("user-dup", c.ID); err != nil || !granted {
			t.Fatalf("IssueReward %s failed: granted=%v err=%v", c.ID, granted, err)
		}
	}

	// 2-grant legendary game, one reachable item: must grant it once, not twice.
	resp, err := s.SubmitGame("user-dup", &models.HalloweenGameReport{
		CompletedRounds: 5, // 15000 (legendary tier)
		Score:           15000,
	})
	if err != nil {
		t.Fatalf("SubmitGame failed: %v", err)
	}
	if len(resp.Granted) != 1 || resp.Granted[0] != lastID {
		t.Fatalf("expected exactly [%s], got %v (message %q)", lastID, resp.Granted, resp.Message)
	}
	if resp.Message != "all rewards have been earned" {
		t.Fatalf("message = %q, want the final exhaustion message", resp.Message)
	}
}

func TestPumpkinAssetSeedPlaceholders(t *testing.T) {
	dataDir := t.TempDir()
	seedDir := t.TempDir()

	fakePNG := append([]byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}, []byte("seed")...)
	if err := os.MkdirAll(filepath.Join(seedDir, "user-pumpkins"), 0755); err != nil {
		t.Fatal(err)
	}
	for _, socket := range []string{"base", "hat", "eyes", "mouth", "feet"} {
		if err := os.WriteFile(filepath.Join(seedDir, "user-pumpkins", socket+".png"), fakePNG, 0644); err != nil {
			t.Fatal(err)
		}
	}

	svc := NewPumpkinAssetService(dataDir, seedDir)
	catalog := []*models.HalloweenItem{
		{ID: "base_a", Socket: "base"},
		{ID: "hat_party", Socket: "hat"},
		{ID: "weird", Socket: "not-a-socket"},
	}

	seeded, err := svc.SeedPlaceholders(catalog)
	if err != nil {
		t.Fatalf("SeedPlaceholders failed: %v", err)
	}
	if seeded != 2 {
		t.Errorf("seeded = %d, want 2 (unknown sockets skipped)", seeded)
	}
	for _, id := range []string{"base_a", "hat_party"} {
		if _, err := svc.AssetPath(id); err != nil {
			t.Errorf("expected seeded file for %s: %v", id, err)
		}
	}

	// Uploads win: an existing file must never be overwritten.
	custom := append(fakePNG, []byte("custom")...)
	if err := os.WriteFile(filepath.Join(dataDir, "halloween", "hat_party.png"), custom, 0644); err != nil {
		t.Fatal(err)
	}
	seeded, err = svc.SeedPlaceholders(catalog)
	if err != nil {
		t.Fatalf("re-seed failed: %v", err)
	}
	if seeded != 0 {
		t.Errorf("re-seed = %d, want 0", seeded)
	}
	kept, _ := os.ReadFile(filepath.Join(dataDir, "halloween", "hat_party.png"))
	if !bytes.Equal(kept, custom) {
		t.Error("re-seed overwrote an existing file")
	}
}

func TestPumpkinAssetSaveVersionsURL(t *testing.T) {
	dataDir := t.TempDir()
	svc := NewPumpkinAssetService(dataDir, t.TempDir())

	fakePNG := append([]byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}, []byte("art")...)

	first, err := svc.SaveAsset("base_a", fakePNG)
	if err != nil {
		t.Fatalf("SaveAsset failed: %v", err)
	}
	prefix := "/api/halloween/assets/base_a?v="
	if len(first) <= len(prefix) || first[:len(prefix)] != prefix {
		t.Fatalf("SaveAsset URL = %q, want prefix %q", first, prefix)
	}

	second, err := svc.SaveAsset("base_a", fakePNG)
	if err != nil {
		t.Fatalf("second SaveAsset failed: %v", err)
	}
	if second == first {
		t.Error("re-upload must bump the ?v= stamp so caches fetch fresh bytes")
	}

	// The version query is URL-only: the file on disk keeps the plain name.
	if _, err := svc.AssetPath("base_a"); err != nil {
		t.Errorf("AssetPath failed after save: %v", err)
	}
}
