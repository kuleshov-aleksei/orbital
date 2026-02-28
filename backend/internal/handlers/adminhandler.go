package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/gorilla/mux"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

// AdminHandler handles admin-related HTTP requests
type AdminHandler struct {
	roleService     *service.RoleService
	userRepo        *repository.UserRepository
	debugLogService *service.DebugLogService
}

// NewAdminHandler creates a new admin handler
func NewAdminHandler(roleService *service.RoleService, userRepo *repository.UserRepository) *AdminHandler {
	return &AdminHandler{
		roleService:     roleService,
		userRepo:        userRepo,
		debugLogService: nil,
	}
}

// NewAdminHandlerWithDebugLog creates a new admin handler with debug log service
func NewAdminHandlerWithDebugLog(roleService *service.RoleService, userRepo *repository.UserRepository, debugLogService *service.DebugLogService) *AdminHandler {
	return &AdminHandler{
		roleService:     roleService,
		userRepo:        userRepo,
		debugLogService: debugLogService,
	}
}

// PromoteUser promotes a user to admin (super_admin only)
func (h *AdminHandler) PromoteUser(w http.ResponseWriter, r *http.Request) {
	// Get current user (super_admin) from context
	claims, ok := r.Context().Value("user").(*models.JWTClaims)
	if !ok || claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Get target user ID from URL
	vars := mux.Vars(r)
	targetUserID := vars["id"]
	if targetUserID == "" {
		http.Error(w, "Missing user ID", http.StatusBadRequest)
		return
	}

	// Promote user
	if err := h.roleService.PromoteToAdmin(claims.UserID, targetUserID); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "success",
		"message": "User promoted to admin",
	})
}

// DemoteUser demotes an admin to regular user (super_admin only)
func (h *AdminHandler) DemoteUser(w http.ResponseWriter, r *http.Request) {
	// Get current user (super_admin) from context
	claims, ok := r.Context().Value("user").(*models.JWTClaims)
	if !ok || claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Get target user ID from URL
	vars := mux.Vars(r)
	targetUserID := vars["id"]
	if targetUserID == "" {
		http.Error(w, "Missing user ID", http.StatusBadRequest)
		return
	}

	// Demote user
	if err := h.roleService.DemoteToUser(claims.UserID, targetUserID); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "success",
		"message": "User demoted to regular user",
	})
}

// ListUsers returns all users with their roles (admin+)
func (h *AdminHandler) ListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := h.userRepo.GetAll()
	if err != nil {
		http.Error(w, "Failed to fetch users: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(users)
}

// GetUserRole returns the role of a specific user (admin+)
func (h *AdminHandler) GetUserRole(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	userID := vars["id"]
	if userID == "" {
		http.Error(w, "Missing user ID", http.StatusBadRequest)
		return
	}

	role, err := h.roleService.GetUserRole(userID)
	if err != nil {
		http.Error(w, "Failed to get user role: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"role": role,
	})
}

// DeleteUser deletes a user (super_admin only)
func (h *AdminHandler) DeleteUser(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value("user").(*models.JWTClaims)
	if !ok || claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	vars := mux.Vars(r)
	targetUserID := vars["id"]
	if targetUserID == "" {
		http.Error(w, "Missing user ID", http.StatusBadRequest)
		return
	}

	if targetUserID == claims.UserID {
		http.Error(w, "Cannot delete yourself", http.StatusForbidden)
		return
	}

	targetUser, err := h.userRepo.GetByID(targetUserID)
	if err != nil {
		http.Error(w, "Failed to get user: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if targetUser == nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	if targetUser.Role == models.RoleSuperAdmin {
		http.Error(w, "Cannot delete super admin", http.StatusForbidden)
		return
	}

	if err := h.userRepo.Delete(targetUserID); err != nil {
		http.Error(w, "Failed to delete user: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "success",
		"message": "User deleted",
	})
}

// DeleteAllGuests deletes all guest users (super_admin only)
func (h *AdminHandler) DeleteAllGuests(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value("user").(*models.JWTClaims)
	if !ok || claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	deletedCount, err := h.userRepo.DeleteAllGuests()
	if err != nil {
		http.Error(w, "Failed to delete guests: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":        "success",
		"message":       "Guest users deleted",
		"deleted_count": deletedCount,
	})
}

// UploadDebugLog handles uploading debug logs from clients
func (h *AdminHandler) UploadDebugLog(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value("user").(*models.JWTClaims)
	if !ok || claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req models.DebugLogUploadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.UserID == "" || req.Username == "" || req.Logs == "" {
		http.Error(w, "Missing required fields", http.StatusBadRequest)
		return
	}

	if h.debugLogService == nil {
		http.Error(w, "Debug log service not available", http.StatusInternalServerError)
		return
	}

	debugLog, err := h.debugLogService.SaveLog(req.UserID, req.Username, req.Logs)
	if err != nil {
		http.Error(w, "Failed to save logs: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "success",
		"message": "Logs uploaded successfully",
		"log_id":  debugLog.ID,
	})
}

// ListDebugLogs returns all debug logs (super_admin only)
func (h *AdminHandler) ListDebugLogs(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value("user").(*models.JWTClaims)
	if !ok || claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if h.debugLogService == nil {
		http.Error(w, "Debug log service not available", http.StatusInternalServerError)
		return
	}

	logs, err := h.debugLogService.GetAllLogs()
	if err != nil {
		http.Error(w, "Failed to fetch logs: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(logs)
}

// GetDebugLog returns a specific debug log file content (super_admin only)
func (h *AdminHandler) GetDebugLog(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value("user").(*models.JWTClaims)
	if !ok || claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	vars := mux.Vars(r)
	logIDStr := vars["id"]
	if logIDStr == "" {
		http.Error(w, "Missing log ID", http.StatusBadRequest)
		return
	}

	logID, err := strconv.ParseInt(logIDStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid log ID", http.StatusBadRequest)
		return
	}

	if h.debugLogService == nil {
		http.Error(w, "Debug log service not available", http.StatusInternalServerError)
		return
	}

	debugLog, content, err := h.debugLogService.GetLog(logID)
	if err != nil {
		http.Error(w, "Failed to fetch log: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if debugLog == nil {
		http.Error(w, "Log not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"log":     debugLog,
		"content": content,
	})
}

// DeleteDebugLog deletes a debug log (super_admin only)
func (h *AdminHandler) DeleteDebugLog(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value("user").(*models.JWTClaims)
	if !ok || claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	vars := mux.Vars(r)
	logIDStr := vars["id"]
	if logIDStr == "" {
		http.Error(w, "Missing log ID", http.StatusBadRequest)
		return
	}

	logID, err := strconv.ParseInt(logIDStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid log ID", http.StatusBadRequest)
		return
	}

	if h.debugLogService == nil {
		http.Error(w, "Debug log service not available", http.StatusInternalServerError)
		return
	}

	if err := h.debugLogService.DeleteLog(logID); err != nil {
		http.Error(w, "Failed to delete log: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "success",
		"message": "Log deleted successfully",
	})
}
