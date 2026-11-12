package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

// RBACHandler serves role, assignment and permission-overwrite endpoints.
// Every mutation is authorized inside PermissionService (manage_roles,
// hierarchy, and "cannot grant what you don't have").
type RBACHandler struct {
	ps        *service.PermissionService
	broadcast func(message interface{}) // optional: WS broadcast to every client
}

// NewRBACHandler creates a new RBAC handler
func NewRBACHandler(ps *service.PermissionService) *RBACHandler {
	return &RBACHandler{ps: ps}
}

// SetBroadcaster wires the WebSocket broadcast used for cosmetic updates.
func (h *RBACHandler) SetBroadcaster(fn func(message interface{})) {
	h.broadcast = fn
}

type permissionCatalogEntry struct {
	Name         string `json:"name"`
	Bit          uint64 `json:"bit"`
	Overwritable bool   `json:"overwritable"`
}

// GetCatalog handles GET /api/permissions/catalog
func (h *RBACHandler) GetCatalog(w http.ResponseWriter, r *http.Request) {
	out := make([]permissionCatalogEntry, 0, len(permissions.Names))
	for name, bit := range permissions.Names {
		out = append(out, permissionCatalogEntry{Name: name, Bit: uint64(bit), Overwritable: permissions.Overwritable.Has(bit)})
	}
	writeJSON(w, out)
}

// GetMyPermissions handles GET /api/me/permissions
func (h *RBACHandler) GetMyPermissions(w http.ResponseWriter, r *http.Request) {
	sub, ok := subjectFromRequest(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	writeJSON(w, h.ps.Me(sub))
}

// ListRoles handles GET /api/roles (any authenticated user: needed to render
// role colours/badges).
func (h *RBACHandler) ListRoles(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]interface{}{
		"roles":       h.ps.Roles(),
		"user_roles":  h.ps.AllUserRoleIDs(),
		"color_roles": h.ps.ColorRoles(),
	})
}

// SetMyColorRole handles PUT /api/me/color-role with {"role_id": "..."}; an
// empty role_id restores the automatic (highest colored role) name color.
func (h *RBACHandler) SetMyColorRole(w http.ResponseWriter, r *http.Request) {
	sub, ok := subjectFromRequest(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var req struct {
		RoleID string `json:"role_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if err := h.ps.SetColorRole(sub, req.RoleID); err != nil {
		writeRBACError(w, err)
		return
	}
	// Cosmetic only: a light event instead of ps.Notify, which would make
	// every client refetch permissions, rooms and categories.
	if h.broadcast != nil {
		h.broadcast(models.WebSocketMessage{
			Type: "color_role_updated",
			Data: map[string]string{"user_id": sub.UserID, "role_id": req.RoleID},
		})
	}
	writeJSON(w, map[string]string{"role_id": req.RoleID})
}

type roleRequest struct {
	Name            *string `json:"name"`
	Color           *string `json:"color"`
	Permissions     *uint64 `json:"permissions"`
	DenyPermissions *uint64 `json:"deny_permissions"`
}

func (req roleRequest) toInput() service.RoleInput {
	return service.RoleInput{Name: req.Name, Color: req.Color, Permissions: req.Permissions, DenyPermissions: req.DenyPermissions}
}

// CreateRole handles POST /api/roles
func (h *RBACHandler) CreateRole(w http.ResponseWriter, r *http.Request) {
	sub, ok := subjectFromRequest(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var req roleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	role, err := h.ps.CreateRole(sub, req.toInput())
	if err != nil {
		writeRBACError(w, err)
		return
	}
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, role)
}

// UpdateRole handles PUT /api/roles/{id}
func (h *RBACHandler) UpdateRole(w http.ResponseWriter, r *http.Request) {
	sub, ok := subjectFromRequest(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var req roleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	role, err := h.ps.UpdateRole(sub, mux.Vars(r)["id"], req.toInput())
	if err != nil {
		writeRBACError(w, err)
		return
	}
	writeJSON(w, role)
}

// DeleteRole handles DELETE /api/roles/{id}
func (h *RBACHandler) DeleteRole(w http.ResponseWriter, r *http.Request) {
	sub, ok := subjectFromRequest(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if err := h.ps.DeleteRole(sub, mux.Vars(r)["id"]); err != nil {
		writeRBACError(w, err)
		return
	}
	writeJSON(w, map[string]string{"status": "success"})
}

// ReorderRoles handles PUT /api/roles/order with {"positions": {role_id: position}}
func (h *RBACHandler) ReorderRoles(w http.ResponseWriter, r *http.Request) {
	sub, ok := subjectFromRequest(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var req struct {
		Positions map[string]int `json:"positions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Positions) == 0 {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if err := h.ps.ReorderRoles(sub, req.Positions); err != nil {
		writeRBACError(w, err)
		return
	}
	writeJSON(w, map[string]string{"status": "success"})
}

// SetUserRoles handles PUT /api/users/{id}/roles with {"role_ids": [...]}
func (h *RBACHandler) SetUserRoles(w http.ResponseWriter, r *http.Request) {
	sub, ok := subjectFromRequest(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var req struct {
		RoleIDs []string `json:"role_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	ids, err := h.ps.SetUserRoles(sub, mux.Vars(r)["id"], req.RoleIDs)
	if err != nil {
		writeRBACError(w, err)
		return
	}
	writeJSON(w, map[string]interface{}{"user_id": mux.Vars(r)["id"], "role_ids": ids})
}

// targetFromVars reads {kind}/{id} for room/category overwrite routes.
func targetFromRoute(r *http.Request, targetType string) (string, string) {
	return targetType, mux.Vars(r)["id"]
}

// ListOverwrites handles GET /api/{rooms|categories}/{id}/overwrites.
// Requires manage_rooms in the target (overwrites reveal who can see what).
func (h *RBACHandler) ListOverwrites(targetType string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tt, tid := targetFromRoute(r, targetType)
		var ok bool
		if tt == models.OverwriteTargetRoom {
			_, ok = requireRoomPerm(w, r, h.ps, tid, permissions.ManageRooms)
		} else {
			_, ok = requireCategoryPerm(w, r, h.ps, tid, permissions.ManageRooms)
		}
		if !ok {
			return
		}
		writeJSON(w, h.ps.Overwrites(tt, tid))
	}
}

// PutOverwrite handles PUT /api/{rooms|categories}/{id}/overwrites/{subject_type}/{subject_id}
// with {"allow": n, "deny": n}.
func (h *RBACHandler) PutOverwrite(targetType string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sub, ok := subjectFromRequest(r)
		if !ok {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		var req struct {
			Allow uint64 `json:"allow"`
			Deny  uint64 `json:"deny"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}
		tt, tid := targetFromRoute(r, targetType)
		vars := mux.Vars(r)
		o, err := h.ps.SetOverwrite(sub, models.PermissionOverwrite{
			TargetType: tt, TargetID: tid,
			SubjectType: vars["subject_type"], SubjectID: vars["subject_id"],
			Allow: req.Allow, Deny: req.Deny,
		})
		if err != nil {
			writeRBACError(w, err)
			return
		}
		writeJSON(w, o)
	}
}

// DeleteOverwrite handles DELETE /api/{rooms|categories}/{id}/overwrites/{subject_type}/{subject_id}
func (h *RBACHandler) DeleteOverwrite(targetType string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sub, ok := subjectFromRequest(r)
		if !ok {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		tt, tid := targetFromRoute(r, targetType)
		vars := mux.Vars(r)
		if err := h.ps.DeleteOverwrite(sub, tt, tid, vars["subject_type"], vars["subject_id"]); err != nil {
			writeRBACError(w, err)
			return
		}
		writeJSON(w, map[string]string{"status": "success"})
	}
}

// SetRoomSync handles PUT /api/rooms/{id}/permissions_synced with {"permissions_synced": bool}
func (h *RBACHandler) SetRoomSync(w http.ResponseWriter, r *http.Request) {
	sub, ok := subjectFromRequest(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var req struct {
		PermissionsSynced bool `json:"permissions_synced"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if err := h.ps.SetRoomSynced(sub, mux.Vars(r)["id"], req.PermissionsSynced); err != nil {
		writeRBACError(w, err)
		return
	}
	writeJSON(w, map[string]interface{}{"status": "success", "permissions_synced": req.PermissionsSynced})
}
