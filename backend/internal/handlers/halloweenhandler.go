package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/service"
	"github.com/kuleshov-aleksei/orbital/internal/websocket"
)

type HalloweenHandler struct {
	halloweenService *service.HalloweenService
	wsHub            *websocket.Hub
}

func NewHalloweenHandler(halloweenService *service.HalloweenService, wsHub *websocket.Hub) *HalloweenHandler {
	return &HalloweenHandler{
		halloweenService: halloweenService,
		wsHub:            wsHub,
	}
}

// GetState returns equipped customization, owned items, and the catalog.
func (h *HalloweenHandler) GetState(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value("user").(*models.JWTClaims)
	if !ok || claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	state, err := h.halloweenService.GetState(claims.UserID)
	if err != nil {
		http.Error(w, "Failed to load halloween state: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(state)
}

// UpdatePumpkin saves the user's equipped customization and broadcasts it to
// their room.
func (h *HalloweenHandler) UpdatePumpkin(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value("user").(*models.JWTClaims)
	if !ok || claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req models.UpdatePumpkinRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if err := h.halloweenService.UpdatePumpkin(claims.UserID, req.EquippedJSON); err != nil {
		http.Error(w, "Failed to save pumpkin: "+err.Error(), http.StatusBadRequest)
		return
	}

	if h.wsHub != nil {
		h.wsHub.BroadcastHalloweenPumpkinState(claims.UserID, req.EquippedJSON)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "saved"})
}

// GetConfig returns the server-authoritative game configuration.
func (h *HalloweenHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(h.halloweenService.Config())
}

// SubmitGame validates and stores a finished game, granting rewards.
func (h *HalloweenHandler) SubmitGame(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value("user").(*models.JWTClaims)
	if !ok || claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var report models.HalloweenGameReport
	if err := json.NewDecoder(r.Body).Decode(&report); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	response, err := h.halloweenService.SubmitGame(claims.UserID, &report)
	if err != nil {
		http.Error(w, "Failed to submit game: "+err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// SubmitBotGame stores a decider-submitted game result (balance harness).
// Development only, no auth. Only heuristic/systemone sources are accepted;
// no rewards are granted and the row is attributed to HalloweenBotUserID.
func (h *HalloweenHandler) SubmitBotGame(w http.ResponseWriter, r *http.Request) {
	var report models.HalloweenGameReport
	if err := json.NewDecoder(r.Body).Decode(&report); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if report.Source != models.HalloweenSourceHeuristic &&
		report.Source != models.HalloweenSourceSystemOne {
		http.Error(w, "source must be heuristic or systemone", http.StatusBadRequest)
		return
	}

	response, err := h.halloweenService.SubmitGame(models.HalloweenBotUserID, &report)
	if err != nil {
		http.Error(w, "Failed to submit game: "+err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GetLeaderboard returns the highest scores across all users.
func (h *HalloweenHandler) GetLeaderboard(w http.ResponseWriter, r *http.Request) {
	entries, err := h.halloweenService.GetLeaderboard()
	if err != nil {
		http.Error(w, "Failed to load leaderboard: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(entries)
}

// AdminGetGames returns all stored game results with parsed reports and stats
// (super_admin only).
func (h *HalloweenHandler) AdminGetGames(w http.ResponseWriter, r *http.Request) {
	results, err := h.halloweenService.GetAdminGames()
	if err != nil {
		http.Error(w, "Failed to load game history: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

// AdminGetRewards returns the full rewards ledger (super_admin only).
func (h *HalloweenHandler) AdminGetRewards(w http.ResponseWriter, r *http.Request) {
	rewards, err := h.halloweenService.GetAdminRewards()
	if err != nil {
		http.Error(w, "Failed to load rewards: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(rewards)
}

// AdminGetItems returns the decoration catalog (super_admin only).
func (h *HalloweenHandler) AdminGetItems(w http.ResponseWriter, r *http.Request) {
	items, err := h.halloweenService.GetAdminCatalog()
	if err != nil {
		http.Error(w, "Failed to load catalog: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

// AdminIssueReward grants a specific item to a user (super_admin only).
func (h *HalloweenHandler) AdminIssueReward(w http.ResponseWriter, r *http.Request) {
	var req models.IssueRewardRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.UserID == "" || req.ItemID == "" {
		http.Error(w, "user_id and item_id are required", http.StatusBadRequest)
		return
	}

	granted, err := h.halloweenService.IssueReward(req.UserID, req.ItemID)
	if err != nil {
		http.Error(w, "Failed to issue reward: "+err.Error(), http.StatusBadRequest)
		return
	}

	message := "reward granted"
	if !granted {
		message = "user already owns this item"
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "success",
		"message": message,
		"granted": granted,
	})
}
