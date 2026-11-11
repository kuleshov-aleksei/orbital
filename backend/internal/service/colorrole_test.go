package service

import (
	"errors"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
)

func TestSetColorRole(t *testing.T) {
	f := newPermFixture(t, nil)
	owner := f.user(t, "qkUrdzLDoqslx8EEy2cM7Q==", models.RoleSuperAdmin, false)
	member := f.user(t, "Zm9vYmFyYmF6cXV4MTIzNA==", models.RoleUser, false)
	guest := f.user(t, "R3Vlc3RHdWVzdEd1ZXN0MQ==", models.RoleGuest, true)

	red, err := f.ps.CreateRole(owner, RoleInput{Name: ptr("Red"), Color: ptr("#ff0000")})
	if err != nil {
		t.Fatal(err)
	}
	blue, err := f.ps.CreateRole(owner, RoleInput{Name: ptr("Blue"), Color: ptr("#0000ff")})
	if err != nil {
		t.Fatal(err)
	}
	plain, err := f.ps.CreateRole(owner, RoleInput{Name: ptr("Plain")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.ps.SetUserRoles(owner, member.UserID, []string{red.ID, plain.ID}); err != nil {
		t.Fatal(err)
	}

	// Denied paths.
	if err := f.ps.SetColorRole(member, blue.ID); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("role not held: expected forbidden, got %v", err)
	}
	if err := f.ps.SetColorRole(member, plain.ID); !errors.Is(err, ErrRBACInvalid) {
		t.Fatalf("uncolored role: expected invalid, got %v", err)
	}
	if err := f.ps.SetColorRole(member, "missing"); !errors.Is(err, ErrRBACNotFound) {
		t.Fatalf("unknown role: expected not found, got %v", err)
	}
	if err := f.ps.SetColorRole(guest, ""); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("guest: expected forbidden, got %v", err)
	}
	if _, err := f.ps.UpdateRole(owner, models.SystemRoleOwner, RoleInput{Color: ptr("#ffaa00")}); err != nil {
		t.Fatal(err)
	}
	if err := f.ps.SetColorRole(member, models.SystemRoleOwner); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("owner role for non-owner: expected forbidden, got %v", err)
	}

	// Allowed: a held colored role, and the implicit Owner role for the owner.
	if err := f.ps.SetColorRole(member, red.ID); err != nil {
		t.Fatal(err)
	}
	if err := f.ps.SetColorRole(owner, models.SystemRoleOwner); err != nil {
		t.Fatal(err)
	}
	stored, err := repository.NewRBACRepository(f.db).GetColorRoles()
	if err != nil {
		t.Fatal(err)
	}
	if stored[member.UserID] != red.ID || stored[owner.UserID] != models.SystemRoleOwner {
		t.Fatalf("unexpected stored picks: %v", stored)
	}

	// Reload keeps them.
	if err := f.ps.LoadFromDB(); err != nil {
		t.Fatal(err)
	}
	if got := f.ps.ColorRoles()[member.UserID]; got != red.ID {
		t.Fatalf("after reload: %q", got)
	}

	// Clearing goes back to automatic.
	if err := f.ps.SetColorRole(member, ""); err != nil {
		t.Fatal(err)
	}
	if _, ok := f.ps.ColorRoles()[member.UserID]; ok {
		t.Fatal("pick not cleared")
	}
}

func TestColorRoleClearedWhenRoleLost(t *testing.T) {
	f := newPermFixture(t, nil)
	owner := f.user(t, "qkUrdzLDoqslx8EEy2cM7Q==", models.RoleSuperAdmin, false)
	member := f.user(t, "Zm9vYmFyYmF6cXV4MTIzNA==", models.RoleUser, false)
	red, _ := f.ps.CreateRole(owner, RoleInput{Name: ptr("Red"), Color: ptr("#ff0000")})
	blue, _ := f.ps.CreateRole(owner, RoleInput{Name: ptr("Blue"), Color: ptr("#0000ff")})
	if _, err := f.ps.SetUserRoles(owner, member.UserID, []string{red.ID, blue.ID}); err != nil {
		t.Fatal(err)
	}
	if err := f.ps.SetColorRole(member, red.ID); err != nil {
		t.Fatal(err)
	}

	// Keeping the picked role keeps the pick.
	if _, err := f.ps.SetUserRoles(owner, member.UserID, []string{red.ID}); err != nil {
		t.Fatal(err)
	}
	if f.ps.ColorRoles()[member.UserID] != red.ID {
		t.Fatal("pick dropped while role still held")
	}

	// Unassigning it clears the pick, in memory and in the DB.
	if _, err := f.ps.SetUserRoles(owner, member.UserID, []string{blue.ID}); err != nil {
		t.Fatal(err)
	}
	if _, ok := f.ps.ColorRoles()[member.UserID]; ok {
		t.Fatal("pick kept after unassign")
	}
	stored, _ := repository.NewRBACRepository(f.db).GetColorRoles()
	if _, ok := stored[member.UserID]; ok {
		t.Fatal("DB pick kept after unassign")
	}

	// Deleting the picked role clears it too.
	if err := f.ps.SetColorRole(member, blue.ID); err != nil {
		t.Fatal(err)
	}
	if err := f.ps.DeleteRole(owner, blue.ID); err != nil {
		t.Fatal(err)
	}
	if _, ok := f.ps.ColorRoles()[member.UserID]; ok {
		t.Fatal("pick kept after role delete")
	}
	stored, _ = repository.NewRBACRepository(f.db).GetColorRoles()
	if _, ok := stored[member.UserID]; ok {
		t.Fatal("DB pick kept after role delete")
	}
}

func TestOwnerRolesEditableOnlyByOwner(t *testing.T) {
	f := newPermFixture(t, nil)
	owner := f.user(t, "qkUrdzLDoqslx8EEy2cM7Q==", models.RoleSuperAdmin, false)
	admin := f.user(t, "QWRtaW5BZG1pbkFkbWluMQ==", models.RoleUser, false)
	red, _ := f.ps.CreateRole(owner, RoleInput{Name: ptr("Red"), Color: ptr("#ff0000")})
	full, _ := f.ps.CreateRole(owner, RoleInput{Name: ptr("Full"), Permissions: ptr(uint64(permissions.All))})
	if _, err := f.ps.SetUserRoles(owner, admin.UserID, []string{full.ID}); err != nil {
		t.Fatal(err)
	}

	// Even a full administrator cannot change the owner's roles.
	if _, err := f.ps.SetUserRoles(admin, owner.UserID, []string{red.ID}); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("admin editing owner's roles: expected forbidden, got %v", err)
	}

	// The owner can assign themselves a role and use it for their name colour.
	if _, err := f.ps.SetUserRoles(owner, owner.UserID, []string{red.ID}); err != nil {
		t.Fatal(err)
	}
	if err := f.ps.SetColorRole(owner, red.ID); err != nil {
		t.Fatal(err)
	}
}
