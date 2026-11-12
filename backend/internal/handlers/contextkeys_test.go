package handlers

import (
	"context"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/models"
)

func TestIsSuperAdminFromContext(t *testing.T) {
	withClaims := func(c *models.JWTClaims) context.Context {
		return context.WithValue(context.Background(), userContextKey, c)
	}
	cases := []struct {
		name string
		ctx  context.Context
		want bool
	}{
		{"owner", withClaims(&models.JWTClaims{UserID: "qkUrdzLDoqslx8EEy2cM7Q==", Role: models.RoleSuperAdmin}), true},
		{"user", withClaims(&models.JWTClaims{UserID: "Zx9v_3LkQe2Wm-T0aBcD1g==", Role: models.RoleUser}), false},
		{"guest", withClaims(&models.JWTClaims{UserID: "Pq7rS8tU9vW0xY1zA2bC3d==", Role: models.RoleGuest, IsGuest: true}), false},
		{"no claims", context.Background(), false},
	}
	for _, tc := range cases {
		if got := IsSuperAdminFromContext(tc.ctx); got != tc.want {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}
