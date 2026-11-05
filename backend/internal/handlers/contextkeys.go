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

func IsGuestFromContext(ctx context.Context) bool {
	claims, ok := ctx.Value(userContextKey).(*models.JWTClaims)
	if !ok || claims == nil {
		return false
	}
	return claims.IsGuest
}
