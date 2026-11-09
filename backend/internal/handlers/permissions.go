package handlers

import (
	"errors"
	"net/http"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

// claimsFromRequest returns the fresh claims put in the context by AuthMiddleware.
func claimsFromRequest(r *http.Request) *models.JWTClaims {
	claims, ok := r.Context().Value(userContextKey).(*models.JWTClaims)
	if !ok {
		return nil
	}
	return claims
}

// subjectFromRequest returns the RBAC subject for an authenticated request.
func subjectFromRequest(r *http.Request) (service.Subject, bool) {
	claims := claimsFromRequest(r)
	if claims == nil || claims.UserID == "" {
		return service.Subject{}, false
	}
	return service.SubjectFromClaims(claims), true
}

// RequirePermission returns middleware requiring a server-level permission.
// Must run after AuthMiddleware.
func RequirePermission(ps *service.PermissionService, perm permissions.Permission) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			sub, ok := subjectFromRequest(r)
			if !ok {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}
			if !ps.CanServer(sub, perm) {
				http.Error(w, "Missing permission", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// requireRoomPerm checks a room-scoped permission. Rooms the subject cannot
// see are reported as 404 so their existence is not leaked.
func requireRoomPerm(w http.ResponseWriter, r *http.Request, ps *service.PermissionService, roomID string, perm permissions.Permission) (service.Subject, bool) {
	sub, ok := subjectFromRequest(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return sub, false
	}
	perms := ps.RoomPerms(sub, roomID)
	if !perms.Has(permissions.ViewRoom) {
		http.Error(w, "Room not found", http.StatusNotFound)
		return sub, false
	}
	if !perms.Has(perm) {
		http.Error(w, "Missing permission", http.StatusForbidden)
		return sub, false
	}
	return sub, true
}

// requireCategoryPerm checks a permission against a category's overwrites.
func requireCategoryPerm(w http.ResponseWriter, r *http.Request, ps *service.PermissionService, categoryID string, perm permissions.Permission) (service.Subject, bool) {
	sub, ok := subjectFromRequest(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return sub, false
	}
	if !ps.CategoryPerms(sub, categoryID).Has(perm) {
		http.Error(w, "Missing permission", http.StatusForbidden)
		return sub, false
	}
	return sub, true
}

// writeRBACError maps PermissionService errors to HTTP responses.
func writeRBACError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrPermissionDenied):
		http.Error(w, err.Error(), http.StatusForbidden)
	case errors.Is(err, service.ErrRBACNotFound):
		http.Error(w, "Not found", http.StatusNotFound)
	case errors.Is(err, service.ErrRBACInvalid):
		http.Error(w, err.Error(), http.StatusBadRequest)
	default:
		http.Error(w, "Internal server error", http.StatusInternalServerError)
	}
}
