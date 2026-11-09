package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/gorilla/mux"
	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/service"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

type rbacFixture struct {
	users    *repository.UserRepository
	rooms    *service.RoomService
	cats     *service.CategoryService
	ps       *service.PermissionService
	room     *RoomHandler
	livekit  *LiveKitHandler
	rbac     *RBACHandler
	claims   map[string]*models.JWTClaims
	hidden   *models.Room
	open     *models.Room
	modRole  *models.Role
	ownerSub service.Subject
}

func newRBACFixture(t *testing.T) *rbacFixture {
	t.Helper()
	db, err := storage.NewDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.RunMigrations(); err != nil {
		t.Fatal(err)
	}
	f := &rbacFixture{users: repository.NewUserRepository(db), claims: map[string]*models.JWTClaims{}}
	f.cats = service.NewCategoryService(repository.NewCategoryRepository(db))
	if err := f.cats.LoadFromDB(); err != nil {
		t.Fatal(err)
	}
	f.rooms = service.NewRoomService(repository.NewRoomRepository(db), f.users)
	f.rooms.SetCategoryService(f.cats)
	f.ps = service.NewPermissionService(repository.NewRBACRepository(db), f.rooms, f.cats, func(id string) *models.User {
		u, _ := f.users.GetByID(id)
		return u
	})
	if err := f.ps.LoadFromDB(); err != nil {
		t.Fatal(err)
	}

	for _, u := range []struct {
		id, role string
		guest    bool
	}{{"owner", models.RoleSuperAdmin, false}, {"mod", models.RoleUser, false}, {"user", models.RoleUser, false}, {"guest", models.RoleGuest, true}} {
		user := &models.User{ID: u.id, Nickname: u.id, OriginalNickname: u.id, CreatedAt: time.Now(), LastSeen: time.Now(),
			AuthProvider: models.AuthProviderPassword, IsGuest: u.guest, Role: u.role}
		if err := f.users.Create(user); err != nil {
			t.Fatal(err)
		}
		f.claims[u.id] = service.ClaimsFromUser(user)
	}
	f.ownerSub = service.SubjectFromClaims(f.claims["owner"])

	general := f.cats.GetGeneralCategoryID()
	f.open, _ = f.rooms.CreateRoom("open", general, 5, "voice")
	f.hidden, _ = f.rooms.CreateRoom("hidden", general, 5, "voice")

	modPerms := uint64(permissions.ManageRoles | permissions.ManageRooms | permissions.KickMembers)
	name := "Mod"
	f.modRole, err = f.ps.CreateRole(f.ownerSub, service.RoleInput{Name: &name, Permissions: &modPerms})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.ps.SetUserRoles(f.ownerSub, "mod", []string{f.modRole.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.ps.SetOverwrite(f.ownerSub, models.PermissionOverwrite{TargetType: models.OverwriteTargetRoom, TargetID: f.hidden.ID,
		SubjectType: models.OverwriteSubjectRole, SubjectID: models.SystemRoleEveryone,
		Deny: uint64(permissions.ViewRoom)}); err != nil {
		t.Fatal(err)
	}

	f.room = NewRoomHandler(f.rooms, f.cats, nil, f.ps, nil)
	lk, err := service.NewLiveKitService(&config.LiveKitConfig{URL: "ws://localhost:7880", APIKey: "key", APISecret: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	f.livekit = NewLiveKitHandler(lk, f.rooms, f.ps)
	f.rbac = NewRBACHandler(f.ps)
	return f
}

func (f *rbacFixture) do(t *testing.T, as string, h http.HandlerFunc, method string, vars map[string]string, body interface{}) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, "/", &buf)
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, f.claims[as]))
	if vars != nil {
		req = mux.SetURLVars(req, vars)
	}
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

func TestGetRoomsHidesRoomsWithoutViewPermission(t *testing.T) {
	f := newRBACFixture(t)
	ids := func(as string) map[string]bool {
		rec := f.do(t, as, f.room.GetRooms, http.MethodGet, nil, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("GetRooms as %s: %d", as, rec.Code)
		}
		var rooms []models.Room
		_ = json.Unmarshal(rec.Body.Bytes(), &rooms)
		out := map[string]bool{}
		for _, r := range rooms {
			out[r.ID] = true
		}
		return out
	}
	if got := ids("user"); got[f.hidden.ID] || !got[f.open.ID] {
		t.Fatalf("user sees %v", got)
	}
	if got := ids("owner"); !got[f.hidden.ID] {
		t.Fatal("owner must see hidden room")
	}
	if rec := f.do(t, "user", f.room.GetRoom, http.MethodGet, map[string]string{"id": f.hidden.ID}, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("GetRoom hidden as user = %d, want 404", rec.Code)
	}
}

func TestJoinAndTokenRequireConnect(t *testing.T) {
	f := newRBACFixture(t)
	// Hidden room: 404 for join and token.
	if rec := f.do(t, "user", f.room.JoinRoom, http.MethodPost, map[string]string{"id": f.hidden.ID}, map[string]string{}); rec.Code != http.StatusNotFound {
		t.Fatalf("join hidden = %d, want 404", rec.Code)
	}
	if rec := f.do(t, "user", f.livekit.GenerateToken, http.MethodPost, nil, TokenRequest{RoomID: f.hidden.ID}); rec.Code != http.StatusNotFound {
		t.Fatalf("token hidden = %d, want 404", rec.Code)
	}
	// Visible but no CONNECT: 403.
	if _, err := f.ps.SetOverwrite(f.ownerSub, models.PermissionOverwrite{TargetType: models.OverwriteTargetRoom, TargetID: f.open.ID,
		SubjectType: models.OverwriteSubjectUser, SubjectID: "user", Deny: uint64(permissions.Connect)}); err != nil {
		t.Fatal(err)
	}
	if rec := f.do(t, "user", f.livekit.GenerateToken, http.MethodPost, nil, TokenRequest{RoomID: f.open.ID}); rec.Code != http.StatusForbidden {
		t.Fatalf("token without connect = %d, want 403", rec.Code)
	}
	if rec := f.do(t, "guest", f.livekit.GenerateToken, http.MethodPost, nil, TokenRequest{RoomID: f.open.ID}); rec.Code != http.StatusOK {
		t.Fatalf("guest token = %d, want 200", rec.Code)
	}
}

func TestManageRoomsAndKickAreEnforced(t *testing.T) {
	f := newRBACFixture(t)
	vars := map[string]string{"id": f.open.ID}
	if rec := f.do(t, "user", f.room.UpdateRoom, http.MethodPut, vars, map[string]string{"name": "x"}); rec.Code != http.StatusForbidden {
		t.Fatalf("user update room = %d, want 403", rec.Code)
	}
	if rec := f.do(t, "user", f.room.DeleteRoom, http.MethodDelete, vars, nil); rec.Code != http.StatusForbidden {
		t.Fatalf("user delete room = %d, want 403", rec.Code)
	}
	if rec := f.do(t, "mod", f.room.UpdateRoom, http.MethodPut, vars, map[string]string{"name": "renamed"}); rec.Code != http.StatusOK {
		t.Fatalf("mod update room = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}

	if _, _, err := f.rooms.JoinRoom(f.open.ID, "owner", "owner"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := f.rooms.JoinRoom(f.open.ID, "user", "user"); err != nil {
		t.Fatal(err)
	}
	kick := func(as, target string) int {
		return f.do(t, as, f.room.KickUser, http.MethodPost, map[string]string{"room_id": f.open.ID, "user_id": target}, nil).Code
	}
	if code := kick("user", "owner"); code != http.StatusForbidden {
		t.Fatalf("user kick = %d, want 403", code)
	}
	if code := kick("mod", "owner"); code != http.StatusForbidden {
		t.Fatalf("mod kick owner = %d, want 403", code)
	}
	if code := kick("mod", "user"); code != http.StatusOK {
		t.Fatalf("mod kick user = %d, want 200", code)
	}
}

func TestRoleManagementCannotEscalate(t *testing.T) {
	f := newRBACFixture(t)
	admin := uint64(permissions.Administrator)
	if rec := f.do(t, "mod", f.rbac.CreateRole, http.MethodPost, nil, map[string]interface{}{"name": "x", "permissions": admin}); rec.Code != http.StatusForbidden {
		t.Fatalf("mod create admin role = %d, want 403", rec.Code)
	}
	if rec := f.do(t, "mod", f.rbac.UpdateRole, http.MethodPut, map[string]string{"id": f.modRole.ID}, map[string]interface{}{"name": "Boss"}); rec.Code != http.StatusForbidden {
		t.Fatalf("mod edit own role = %d, want 403", rec.Code)
	}
	if rec := f.do(t, "user", f.rbac.CreateRole, http.MethodPost, nil, map[string]interface{}{"name": "x"}); rec.Code != http.StatusForbidden {
		t.Fatalf("user create role = %d, want 403", rec.Code)
	}
	if rec := f.do(t, "mod", f.rbac.SetUserRoles, http.MethodPut, map[string]string{"id": "user"}, map[string]interface{}{"role_ids": []string{f.modRole.ID}}); rec.Code != http.StatusForbidden {
		t.Fatalf("mod assign own role = %d, want 403", rec.Code)
	}
	// Overwrites: mod cannot grant role-only bits.
	if rec := f.do(t, "mod", f.rbac.PutOverwrite(models.OverwriteTargetRoom), http.MethodPut,
		map[string]string{"id": f.open.ID, "subject_type": "user", "subject_id": "user"},
		map[string]interface{}{"allow": uint64(permissions.ManageRoles)}); rec.Code != http.StatusBadRequest {
		t.Fatalf("overwrite with role-only bit = %d, want 400", rec.Code)
	}
}
