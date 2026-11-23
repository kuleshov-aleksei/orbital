package handlers

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

// SetAccountService sets the erase path for "Delete my account".
func (h *AuthHandler) SetAccountService(accounts *service.AccountService) {
	h.accounts = accounts
}

type deleteAccountRequest struct {
	Password string `json:"password"`
	Nickname string `json:"nickname"`
}

// DeleteAccount handles DELETE /api/auth/account: the caller deletes their
// own account. Password accounts confirm with the password, every other kind
// by typing the current nickname. The server owner is refused.
func (h *AuthHandler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value(userContextKey).(*models.JWTClaims)
	if !ok || claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if h.accounts == nil {
		http.Error(w, "Account deletion not available", http.StatusServiceUnavailable)
		return
	}

	var req deleteAccountRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	user, err := h.authService.GetUserByID(claims.UserID)
	if err != nil {
		http.Error(w, "Failed to load user", http.StatusInternalServerError)
		return
	}
	if user == nil || user.DeletedAt != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}
	if user.Role == models.RoleSuperAdmin {
		http.Error(w, service.ErrCannotDeleteOwner.Error(), http.StatusForbidden)
		return
	}
	if err := service.ConfirmDelete(user, req.Password, req.Nickname); err != nil {
		http.Error(w, "Confirmation does not match", http.StatusForbidden)
		return
	}

	if err := h.accounts.Erase(user.ID); err != nil {
		if errors.Is(err, service.ErrCannotDeleteOwner) {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		log.Printf("[Account] Failed to delete account %s: %v", user.ID, err)
		http.Error(w, "Failed to delete account", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
