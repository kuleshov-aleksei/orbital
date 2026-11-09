package service

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

type permFixture struct {
	db    *storage.DB
	users *repository.UserRepository
	rooms *RoomService
	cats  *CategoryService
	ps    *PermissionService
}

func newPermFixture(t *testing.T, seed func(db *storage.DB)) *permFixture {
	t.Helper()
	db, err := storage.NewDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if seed != nil {
		seed(db)
	}
	if err := db.RunMigrations(); err != nil {
		t.Fatal(err)
	}
	f := &permFixture{db: db, users: repository.NewUserRepository(db)}
	f.cats = NewCategoryService(repository.NewCategoryRepository(db))
	if err := f.cats.LoadFromDB(); err != nil {
		t.Fatal(err)
	}
	f.rooms = NewRoomService(repository.NewRoomRepository(db), f.users)
	if err := f.rooms.LoadFromDB(); err != nil {
		t.Fatal(err)
	}
	f.rooms.SetCategoryService(f.cats)
	f.ps = NewPermissionService(repository.NewRBACRepository(db), f.rooms, f.cats, func(id string) *models.User {
		u, _ := f.users.GetByID(id)
		return u
	})
	if err := f.ps.LoadFromDB(); err != nil {
		t.Fatal(err)
	}
	return f
}

func (f *permFixture) user(t *testing.T, id, role string, guest bool) Subject {
	t.Helper()
	u := &models.User{ID: id, Nickname: id, OriginalNickname: id, CreatedAt: time.Now(), LastSeen: time.Now(),
		AuthProvider: models.AuthProviderGuest, IsGuest: guest, Role: role}
	if err := f.users.Create(u); err != nil {
		t.Fatal(err)
	}
	return SubjectFromUser(u)
}

func TestMigrationMovesLegacyAdminsToAdminRole(t *testing.T) {
	// Build a pre-RBAC (v33) database with legacy roles, then upgrade it.
	db, err := storage.NewDB(filepath.Join(t.TempDir(), "legacy.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := storage.RunMigrationsUpTo(db, 33); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO users (id, nickname, created_at, last_seen, auth_provider, is_guest, role) VALUES
		('a1', 'admin1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'password', 0, 'admin'),
		('o1', 'owner', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'password', 0, 'super_admin'),
		('u1', 'user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'password', 0, 'user')`); err != nil {
		t.Fatal(err)
	}
	if err := db.RunMigrations(); err != nil {
		t.Fatal(err)
	}
	rbac := repository.NewRBACRepository(db)
	ur, err := rbac.GetUserRoles()
	if err != nil {
		t.Fatal(err)
	}
	if len(ur["a1"]) != 1 || ur["a1"][0] != "admin" {
		t.Fatalf("legacy admin not migrated: %v", ur)
	}
	if len(ur["o1"]) != 0 || len(ur["u1"]) != 0 {
		t.Fatalf("unexpected assignments: %v", ur)
	}
	var role string
	if err := db.QueryRow(`SELECT role FROM users WHERE id = 'a1'`).Scan(&role); err != nil {
		t.Fatal(err)
	}
	if role != models.RoleUser {
		t.Fatalf("legacy admin role column = %q, want user", role)
	}
}

func TestPermissionServiceDefaults(t *testing.T) {
	f := newPermFixture(t, nil)
	owner := f.user(t, "owner", models.RoleSuperAdmin, false)
	user := f.user(t, "user", models.RoleUser, false)
	guest := f.user(t, "guest", models.RoleGuest, true)

	room, err := f.rooms.CreateRoom("r", f.cats.GetGeneralCategoryID(), 5, "voice")
	if err != nil {
		t.Fatal(err)
	}

	if f.ps.ServerPerms(owner) != permissions.All {
		t.Fatal("owner must have all permissions")
	}
	if !f.ps.CanInRoom(user, room.ID, permissions.Screenshare|permissions.Connect) {
		t.Fatal("user should screenshare by default")
	}
	if f.ps.CanServer(user, permissions.ManageRooms) {
		t.Fatal("user must not manage rooms")
	}
	if f.ps.CanInRoom(guest, room.ID, permissions.Screenshare) || f.ps.CanInRoom(guest, room.ID, permissions.Video) {
		t.Fatal("guest must not screenshare/video by default")
	}
	if !f.ps.CanInRoom(guest, room.ID, permissions.Speak) {
		t.Fatal("guest should be able to speak")
	}
}

func TestPermissionServiceHierarchyAndOverwrites(t *testing.T) {
	f := newPermFixture(t, nil)
	owner := f.user(t, "owner", models.RoleSuperAdmin, false)
	mod := f.user(t, "mod", models.RoleUser, false)
	user := f.user(t, "user", models.RoleUser, false)
	general := f.cats.GetGeneralCategoryID()
	room, _ := f.rooms.CreateRoom("secret", general, 5, "voice")

	modPerms := uint64(permissions.ManageRoles | permissions.ManageRooms | permissions.KickMembers)
	modRole, err := f.ps.CreateRole(owner, RoleInput{Name: ptr("Mod"), Permissions: &modPerms})
	if err != nil {
		t.Fatal(err)
	}
	// Owner creates a higher role
	highPerms := uint64(permissions.ManageRoles)
	high, err := f.ps.CreateRole(owner, RoleInput{Name: ptr("High"), Permissions: &highPerms})
	if err != nil {
		t.Fatal(err)
	}
	if err := f.ps.ReorderRoles(owner, map[string]int{high.ID: 10}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.ps.SetUserRoles(owner, mod.UserID, []string{modRole.ID}); err != nil {
		t.Fatal(err)
	}

	// Mod cannot assign a role above themselves, nor their own role.
	if _, err := f.ps.SetUserRoles(mod, user.UserID, []string{high.ID}); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("expected forbidden assigning higher role, got %v", err)
	}
	if _, err := f.ps.SetUserRoles(mod, user.UserID, []string{modRole.ID}); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("expected forbidden assigning equal role, got %v", err)
	}
	// Mod cannot grant permissions they lack.
	admin := uint64(permissions.Administrator)
	if _, err := f.ps.CreateRole(mod, RoleInput{Name: ptr("Sneaky"), Permissions: &admin}); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("expected forbidden granting administrator, got %v", err)
	}
	// Mod can kick user but not owner.
	if !f.ps.CanTarget(mod, user) || f.ps.CanTarget(mod, owner) || f.ps.CanTarget(user, mod) {
		t.Fatal("unexpected CanTarget results")
	}

	// Grant the mod role first (otherwise the mod would lock themselves out),
	// then hide the room from @everyone.
	if _, err := f.ps.SetOverwrite(mod, models.PermissionOverwrite{TargetType: models.OverwriteTargetRoom, TargetID: room.ID,
		SubjectType: models.OverwriteSubjectRole, SubjectID: modRole.ID, Allow: uint64(permissions.ViewRoom)}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.ps.SetOverwrite(mod, models.PermissionOverwrite{TargetType: models.OverwriteTargetRoom, TargetID: room.ID,
		SubjectType: models.OverwriteSubjectRole, SubjectID: models.SystemRoleEveryone, Deny: uint64(permissions.ViewRoom)}); err != nil {
		t.Fatal(err)
	}
	if r, _ := f.rooms.GetRoom(room.ID); r.PermissionsSynced {
		t.Fatal("editing overwrites should un-sync the room")
	}
	if f.ps.CanInRoom(user, room.ID, permissions.ViewRoom) {
		t.Fatal("user should not see hidden room")
	}
	if !f.ps.CanInRoom(mod, room.ID, permissions.ViewRoom|permissions.Connect) {
		t.Fatal("mod should see hidden room")
	}
	if f.ps.CanSeeCategory(user, general) {
		t.Fatal("user should not see category with only hidden rooms")
	}

	// Reload from DB yields the same answers.
	if err := f.ps.LoadFromDB(); err != nil {
		t.Fatal(err)
	}
	if f.ps.CanInRoom(user, room.ID, permissions.ViewRoom) || !f.ps.CanInRoom(mod, room.ID, permissions.ViewRoom) {
		t.Fatal("permissions changed after reload")
	}

	// Re-sync discards room overwrites.
	if err := f.ps.SetRoomSynced(owner, room.ID, true); err != nil {
		t.Fatal(err)
	}
	if !f.ps.CanInRoom(user, room.ID, permissions.ViewRoom) {
		t.Fatal("user should see room after re-sync")
	}
}

func TestPermissionServiceCategorySync(t *testing.T) {
	f := newPermFixture(t, nil)
	owner := f.user(t, "owner", models.RoleSuperAdmin, false)
	user := f.user(t, "user", models.RoleUser, false)
	cat, err := f.cats.CreateCategory("vip")
	if err != nil {
		t.Fatal(err)
	}
	room, _ := f.rooms.CreateRoom("lounge", cat.ID, 5, "voice")
	if _, err := f.ps.SetOverwrite(owner, models.PermissionOverwrite{TargetType: models.OverwriteTargetCategory, TargetID: cat.ID,
		SubjectType: models.OverwriteSubjectUser, SubjectID: user.UserID, Deny: uint64(permissions.Screenshare)}); err != nil {
		t.Fatal(err)
	}
	if f.ps.CanInRoom(user, room.ID, permissions.Screenshare) {
		t.Fatal("synced room must inherit category deny")
	}
	if err := f.ps.SetRoomSynced(owner, room.ID, false); err != nil {
		t.Fatal(err)
	}
	if f.ps.CanInRoom(user, room.ID, permissions.Screenshare) {
		t.Fatal("un-synced room must keep a copy of the category overwrites")
	}
	if len(f.ps.Overwrites(models.OverwriteTargetRoom, room.ID)) != 1 {
		t.Fatal("expected copied overwrite on room")
	}
}

func ptr[T any](v T) *T { return &v }

func TestRoleTriStateFollowsHierarchy(t *testing.T) {
	f := newPermFixture(t, nil)
	owner := f.user(t, "owner", models.RoleSuperAdmin, false)
	guest := f.user(t, "guest", models.RoleGuest, true)
	user := f.user(t, "user", models.RoleUser, false)
	room, _ := f.rooms.CreateRoom("r", f.cats.GetGeneralCategoryID(), 5, "voice")

	// @everyone allows camera, the Guest role denies it.
	if f.ps.CanInRoom(guest, room.ID, permissions.Video) || !f.ps.CanInRoom(user, room.ID, permissions.Video) {
		t.Fatal("guest deny should only affect guests")
	}

	// A custom role (above Guest) allowing camera wins for a guest holding it.
	video := uint64(permissions.Video)
	streamer, err := f.ps.CreateRole(owner, RoleInput{Name: ptr("Streamer"), Permissions: &video})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.ps.SetUserRoles(owner, guest.UserID, []string{streamer.ID}); err != nil {
		t.Fatal(err)
	}
	if !f.ps.CanInRoom(guest, room.ID, permissions.Video) {
		t.Fatal("higher role allow should beat Guest deny")
	}

	// A higher custom role denying camera beats the lower Streamer allow.
	muted, err := f.ps.CreateRole(owner, RoleInput{Name: ptr("No Cam"), DenyPermissions: &video})
	if err != nil {
		t.Fatal(err)
	}
	if err := f.ps.ReorderRoles(owner, map[string]int{muted.ID: 5}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.ps.SetUserRoles(owner, guest.UserID, []string{streamer.ID, muted.ID}); err != nil {
		t.Fatal(err)
	}
	if f.ps.CanInRoom(guest, room.ID, permissions.Video) {
		t.Fatal("higher role deny should beat lower role allow")
	}

	// Allow and deny of the same bit is rejected; @everyone cannot deny.
	both := uint64(permissions.Speak)
	if _, err := f.ps.UpdateRole(owner, streamer.ID, RoleInput{Permissions: &both, DenyPermissions: &both}); !errors.Is(err, ErrRBACInvalid) {
		t.Fatalf("expected invalid for allow+deny, got %v", err)
	}
	ev, err := f.ps.UpdateRole(owner, models.SystemRoleEveryone, RoleInput{DenyPermissions: &both})
	if err != nil || ev.DenyPermissions != 0 {
		t.Fatalf("@everyone deny must be ignored: %v %+v", err, ev)
	}
}
