package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

// AdminHandler handles admin-related HTTP requests
type AdminHandler struct {
	roleService *service.RoleService
	userRepo    *repository.UserRepository
}

// NewAdminHandler creates a new admin handler
func NewAdminHandler(roleService *service.RoleService, userRepo *repository.UserRepository) *AdminHandler {
	return &AdminHandler{
		roleService: roleService,
		userRepo:    userRepo,
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
