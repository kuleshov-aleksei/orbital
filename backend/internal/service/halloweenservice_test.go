package service

import (
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
		"silas":     100,
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
		HalloweenSlugScout:  5,
		HalloweenSlugMarvin: 10,
		HalloweenSlugGerald: 30,
		HalloweenSlugDell:   50,
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

	// 9617 points, round 7 -> 3 rewards: rare, uncommon, common.
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

	// Verify tiers: rare, uncommon, common in order.
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

	// 6712 points, round 5 -> 2 rewards: uncommon, common.
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

	report := &models.HalloweenGameReport{
		CompletedRounds: 10, // 1000 * (10*11)/2 = 55000
		Score:           55000,
	}

	// Repeated submissions drain the pool (10 catalog items total, 4 max per game).
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
		if totalGranted > 20 {
			t.Fatal("loop did not terminate, pool never exhausted")
		}
	}
	if totalGranted < 10 {
		t.Fatalf("expected all 10 catalog items to be granted, got %d", totalGranted)
	}
	if lastMessage == "" {
		t.Fatal("expected an 'all rewards earned' style message")
	}
}

func TestHalloweenUpdatePumpkinState(t *testing.T) {
	s := newHalloweenTestService(t)

	if err := s.UpdatePumpkin("user-6", `{"hat":"hat_party"}`); err != nil {
		t.Fatalf("UpdatePumpkin failed: %v", err)
	}
	if err := s.UpdatePumpkin("user-6", "not-json"); err == nil {
		t.Fatal("expected invalid JSON to be rejected")
	}

	state, err := s.GetState("user-6")
	if err != nil {
		t.Fatalf("GetState failed: %v", err)
	}
	if state.EquippedJSON != `{"hat":"hat_party"}` {
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

	// 2 scouts (kill_reward 5) + 1 marvin (kill_reward 10) killed; coins_earned
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
		CoinsEarned:     5 + 5 + 10 + 40,
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
	if g.KillIncome != 20 {
		t.Errorf("kill_income = %d, want 20", g.KillIncome)
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
	if g.CoinsEarned != 60 || g.CoinsSpent != 40 {
		t.Errorf("coins earned/spent = %d/%d, want 60/40", g.CoinsEarned, g.CoinsSpent)
	}

	rewards, err := s.GetAdminRewards()
	if err != nil {
		t.Fatalf("GetAdminRewards failed: %v", err)
	}
	if len(rewards) != 1 {
		t.Fatalf("expected 1 reward for score 1027, got %d", len(rewards))
	}
	if rewards[0].UserID != "user-1" || rewards[0].Rarity != HalloweenRarityRegular {
		t.Errorf("unexpected reward row: %+v", rewards[0])
	}
	if rewards[0].Source != "game" {
		t.Errorf("expected game source, got %q", rewards[0].Source)
	}
}
