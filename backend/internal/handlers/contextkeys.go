package handlers

import (
	"context"

	"github.com/kuleshov-aleksei/orbital/internal/models"
)

type contextKey string

const userContextKey contextKey = "user"

func UserIDFromContext(ctx context.Context) string {
	claims, ok := ctx.Value(userContextKey).(*models.JWTClaims)
	if !ok || claims == nil {
		return ""
	}
	return claims.UserID
}

// SessionIDFromContext returns the auth session of the request's token, or ""
// for a legacy token issued before per-device sessions.
func SessionIDFromContext(ctx context.Context) string {
	claims, ok := ctx.Value(userContextKey).(*models.JWTClaims)
	if !ok || claims == nil {
		return ""
	}
	return claims.SessionID
}

func IsGuestFromContext(ctx context.Context) bool {
	claims, ok := ctx.Value(userContextKey).(*models.JWTClaims)
	if !ok || claims == nil {
		return false
	}
	return claims.IsGuest
}

// IsSuperAdminFromContext reports whether the authenticated user is the owner.
func IsSuperAdminFromContext(ctx context.Context) bool {
	claims, ok := ctx.Value(userContextKey).(*models.JWTClaims)
	if !ok || claims == nil {
		return false
	}
	return claims.Role == models.RoleSuperAdmin
}
