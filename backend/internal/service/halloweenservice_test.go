package service

import (
	"testing"
	"time"

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
	return NewHalloweenService(repo)
}

func TestHalloweenConfigEnabledGate(t *testing.T) {
	s := newHalloweenTestService(t)
	cfg := s.Config()

	start, err := time.Parse("2006-01-02", HalloweenStartsAt)
	if err != nil {
		t.Fatalf("invalid HalloweenStartsAt: %v", err)
	}
	wantEnabled := !time.Now().UTC().Before(start)
	if cfg.Enabled != wantEnabled {
		t.Fatalf("enabled = %v, want %v (starts %s)", cfg.Enabled, wantEnabled, HalloweenStartsAt)
	}
	if cfg.StartsAt != "2026-10-17" {
		t.Fatalf("unexpected starts_at: %s", cfg.StartsAt)
	}
	if cfg.BattlefieldLength != 1000 {
		t.Fatalf("unexpected battlefield length: %d", cfg.BattlefieldLength)
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
			{Type: HalloweenSlugMarvin, X: 0, Source: HalloweenAbilityBeer},         // 500
			{Type: HalloweenSlugGerald, X: 0, Source: HalloweenAbilityGenocide},     // 10
		},
		CompletedRounds: 2, // 1000 * (2*3)/2 = 3000
	}

	want := 10 + 7 + 5 + 4 + 14 + 40 + 500 + 10 + 3000
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
