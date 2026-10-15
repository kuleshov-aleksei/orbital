package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gorilla/mux"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/service"
	"github.com/kuleshov-aleksei/orbital/internal/websocket"
)

type HalloweenHandler struct {
	halloweenService *service.HalloweenService
	pumpkinAssets    *service.PumpkinAssetService
	wsHub            *websocket.Hub
}

func NewHalloweenHandler(halloweenService *service.HalloweenService, wsHub *websocket.Hub) *HalloweenHandler {
	return &HalloweenHandler{
		halloweenService: halloweenService,
		wsHub:            wsHub,
	}
}

func NewHalloweenHandlerWithAssets(halloweenService *service.HalloweenService, pumpkinAssets *service.PumpkinAssetService, wsHub *websocket.Hub) *HalloweenHandler {
	return &HalloweenHandler{
		halloweenService: halloweenService,
		pumpkinAssets:    pumpkinAssets,
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

// AdminGetItems returns the decoration catalog (super_admin only,
// including soft-deleted rows).
func (h *HalloweenHandler) AdminGetItems(w http.ResponseWriter, r *http.Request) {
	items, err := h.halloweenService.GetAdminCatalog()
	if err != nil {
		http.Error(w, "Failed to load catalog: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

// GetAsset serves backend-owned pumpkin decoration art from the data dir.
// Initial art is seeded there from the bundled placeholders on server start;
// uploads overwrite per-item files.
func (h *HalloweenHandler) GetAsset(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]
	if id == "" {
		http.Error(w, "Invalid asset id", http.StatusBadRequest)
		return
	}
	if h.pumpkinAssets == nil {
		http.Error(w, "Asset storage not configured", http.StatusNotFound)
		return
	}

	filePath, err := h.pumpkinAssets.AssetPath(id)
	if err != nil {
		http.Error(w, "Asset not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "image/png")
	// Art changes on upload under a stable path, so clients must revalidate
	// every time (ServeFile answers 304s via ETag/Last-Modified — cheap).
	// Fresh uploads additionally get a ?v= version stamp, which busts the
	// browser cache and Pixi's in-memory texture cache outright.
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, filePath)
}

// AdminCreateItem creates a catalog entry (super_admin only).
func (h *HalloweenHandler) AdminCreateItem(w http.ResponseWriter, r *http.Request) {
	var req models.CreateHalloweenItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	item, err := h.halloweenService.CreateItem(&req)
	if err != nil {
		http.Error(w, "Failed to create item: "+err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(item)
}

// AdminUpdateItem updates a catalog entry (super_admin only).
func (h *HalloweenHandler) AdminUpdateItem(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]
	if id == "" {
		http.Error(w, "Invalid item id", http.StatusBadRequest)
		return
	}

	var req models.UpdateHalloweenItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	item, err := h.halloweenService.UpdateItem(id, &req)
	if err != nil {
		http.Error(w, "Failed to update item: "+err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(item)
}

// AdminDeleteItem soft-deletes a catalog entry (super_admin only).
func (h *HalloweenHandler) AdminDeleteItem(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]
	if id == "" {
		http.Error(w, "Invalid item id", http.StatusBadRequest)
		return
	}

	if err := h.halloweenService.SoftDeleteItem(id); err != nil {
		http.Error(w, "Failed to delete item: "+err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
}

// AdminRestoreItem clears the soft-delete flag (super_admin only).
func (h *HalloweenHandler) AdminRestoreItem(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]
	if id == "" {
		http.Error(w, "Invalid item id", http.StatusBadRequest)
		return
	}

	if err := h.halloweenService.RestoreItem(id); err != nil {
		http.Error(w, "Failed to restore item: "+err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "restored"})
}

// AdminUploadAsset stores PNG art for a catalog entry (super_admin only).
func (h *HalloweenHandler) AdminUploadAsset(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]
	if id == "" {
		http.Error(w, "Invalid item id", http.StatusBadRequest)
		return
	}
	if h.pumpkinAssets == nil {
		http.Error(w, "Asset storage not configured", http.StatusInternalServerError)
		return
	}

	if r.ContentLength > service.MaxPumpkinAssetSize {
		http.Error(w, "File size exceeds 2MB limit", http.StatusRequestEntityTooLarge)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, service.MaxPumpkinAssetSize)

	if err := r.ParseMultipartForm(service.MaxPumpkinAssetSize); err != nil {
		http.Error(w, "Failed to parse multipart form", http.StatusBadRequest)
		return
	}

	file, _, err := r.FormFile("asset")
	if err != nil {
		http.Error(w, "No asset file provided", http.StatusBadRequest)
		return
	}
	defer file.Close()

	fileData, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "Failed to read file", http.StatusInternalServerError)
		return
	}

	assetURL, err := h.pumpkinAssets.SaveAsset(id, fileData)
	if err != nil {
		switch err {
		case service.ErrPumpkinAssetTooLarge:
			http.Error(w, err.Error(), http.StatusRequestEntityTooLarge)
		case service.ErrPumpkinAssetInvalidType:
			http.Error(w, err.Error(), http.StatusBadRequest)
		default:
			http.Error(w, "Failed to process asset file", http.StatusInternalServerError)
		}
		return
	}

	item, err := h.halloweenService.SetItemAssetPath(id, assetURL)
	if err != nil {
		http.Error(w, "Asset saved but catalog update failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(item)
}

// AdminGetLayouts returns the socket anchors for one base (super_admin only).
func (h *HalloweenHandler) AdminGetLayouts(w http.ResponseWriter, r *http.Request) {
	baseID := r.URL.Query().Get("base_id")
	if baseID == "" {
		http.Error(w, "base_id is required", http.StatusBadRequest)
		return
	}

	sockets, err := h.halloweenService.GetBaseSockets(baseID)
	if err != nil {
		http.Error(w, "Failed to load layouts: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sockets)
}

// AdminUpsertLayouts replaces the socket anchors for a base (super_admin only).
func (h *HalloweenHandler) AdminUpsertLayouts(w http.ResponseWriter, r *http.Request) {
	var req models.UpsertBaseSocketsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.BaseID == "" {
		http.Error(w, "base_id is required", http.StatusBadRequest)
		return
	}

	if err := h.halloweenService.UpsertBaseSockets(req.BaseID, req.Sockets); err != nil {
		http.Error(w, "Failed to save layouts: "+err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "saved"})
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

// AdminExportConfig snapshots the live catalog + base layouts + art PNGs as
// an uncompressed .tar package (super_admin only). Only real uploads travel
// in the package; items without art import artless (placeholders seeded).
func (h *HalloweenHandler) AdminExportConfig(w http.ResponseWriter, r *http.Request) {
	if h.pumpkinAssets == nil {
		http.Error(w, "Asset storage not configured", http.StatusInternalServerError)
		return
	}
	pkg := service.NewHalloweenPackageService(h.halloweenService, h.pumpkinAssets)
	data, err := pkg.ExportPackage()
	if err != nil {
		http.Error(w, "Failed to export config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	filename := fmt.Sprintf("halloween-pumpkin-package-%s.tar", time.Now().UTC().Format("2006-01-02"))
	w.Header().Set("Content-Type", "application/x-tar")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.Write(data)
}

// AdminImportConfig replaces the whole catalog + layouts + art from a config
// package upload (super_admin only, multipart field "package"). Everything is
// validated before anything is written: failures leave the database untouched.
func (h *HalloweenHandler) AdminImportConfig(w http.ResponseWriter, r *http.Request) {
	if h.pumpkinAssets == nil {
		http.Error(w, "Asset storage not configured", http.StatusInternalServerError)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, service.MaxHalloweenPackageSize+1<<20)

	if err := r.ParseMultipartForm(service.MaxHalloweenPackageSize); err != nil {
		http.Error(w, "Failed to parse package upload", http.StatusBadRequest)
		return
	}

	file, _, err := r.FormFile("package")
	if err != nil {
		http.Error(w, "No package file provided", http.StatusBadRequest)
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "Failed to read package", http.StatusInternalServerError)
		return
	}

	pkg := service.NewHalloweenPackageService(h.halloweenService, h.pumpkinAssets)
	res, err := pkg.ImportPackage(data)
	if err != nil {
		http.Error(w, "Failed to import config: "+err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}
