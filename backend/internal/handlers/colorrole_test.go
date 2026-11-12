package handlers

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

func TestSetMyColorRole(t *testing.T) {
	f := newRBACFixture(t)
	color := "#22cc88"
	if _, err := f.ps.UpdateRole(f.ownerSub, f.modRole.ID, service.RoleInput{Color: &color}); err != nil {
		t.Fatal(err)
	}
	var sent []models.WebSocketMessage
	f.rbac.SetBroadcaster(func(m interface{}) { sent = append(sent, m.(models.WebSocketMessage)) })

	// Denied: a role the user does not hold, and guests.
	if rec := f.do(t, "user", f.rbac.SetMyColorRole, http.MethodPut, nil, map[string]string{"role_id": f.modRole.ID}); rec.Code != http.StatusForbidden {
		t.Fatalf("user picking unheld role: %d", rec.Code)
	}
	if rec := f.do(t, "guest", f.rbac.SetMyColorRole, http.MethodPut, nil, map[string]string{"role_id": ""}); rec.Code != http.StatusForbidden {
		t.Fatalf("guest: %d", rec.Code)
	}
	if len(sent) != 0 {
		t.Fatalf("broadcast on denied request: %v", sent)
	}

	// Allowed: the mod picks their role; everyone hears about it.
	if rec := f.do(t, "mod", f.rbac.SetMyColorRole, http.MethodPut, nil, map[string]string{"role_id": f.modRole.ID}); rec.Code != http.StatusOK {
		t.Fatalf("mod picking own role: %d %s", rec.Code, rec.Body.String())
	}
	if len(sent) != 1 || sent[0].Type != "color_role_updated" {
		t.Fatalf("expected one color_role_updated broadcast, got %v", sent)
	}

	rec := f.do(t, "user", f.rbac.ListRoles, http.MethodGet, nil, nil)
	var body struct {
		ColorRoles map[string]string `json:"color_roles"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.ColorRoles["mod"] != f.modRole.ID {
		t.Fatalf("ListRoles color_roles: %v", body.ColorRoles)
	}
}
