package service

import (
	"errors"
	"fmt"
	"log"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
)

// Permission errors returned by mutating methods. Handlers map them to HTTP codes.
var (
	ErrPermissionDenied = errors.New("permission denied")
	ErrRBACNotFound     = errors.New("not found")
	ErrRBACInvalid      = errors.New("invalid request")
)

func rbacInvalid(msg string) error   { return fmt.Errorf("%w: %s", ErrRBACInvalid, msg) }
func rbacForbidden(msg string) error { return fmt.Errorf("%w: %s", ErrPermissionDenied, msg) }

// Subject identifies who permissions are computed for.
type Subject struct {
	UserID  string
	IsOwner bool // the single super admin
	IsGuest bool
}

// SubjectFromUser builds a Subject from a user record.
func SubjectFromUser(u *models.User) Subject {
	return Subject{
		UserID:  u.ID,
		IsOwner: u.Role == models.RoleSuperAdmin,
		IsGuest: u.IsGuest || u.Role == models.RoleGuest,
	}
}

// SubjectFromClaims builds a Subject from fresh JWT claims (AuthMiddleware
// reloads them from the DB on every request).
func SubjectFromClaims(c *models.JWTClaims) Subject {
	return Subject{
		UserID:  c.UserID,
		IsOwner: c.Role == models.RoleSuperAdmin,
		IsGuest: c.IsGuest || c.Role == models.RoleGuest,
	}
}

// PermissionChange is emitted after any mutation that may change someone's
// effective permissions. At this app's scale listeners simply recompute
// everything for connected users.
type PermissionChange struct {
	Reason string
}

// MyPermissions is the payload for GET /api/me/permissions.
type MyPermissions struct {
	IsOwner    bool              `json:"is_owner"`
	Server     uint64            `json:"server"`
	Rooms      map[string]uint64 `json:"rooms"`
	Categories map[string]uint64 `json:"categories"`
	RoleIDs    []string          `json:"role_ids"`
	TopPos     int               `json:"top_position"`
	// PrivateRooms lists the visible rooms whose permissions are customized
	// (room overwrites, or the category's when synced); the UI marks them.
	PrivateRooms []string `json:"private_rooms"`
}

// PermissionService caches roles, assignments and overwrites in memory and
// answers every authorization question in the backend.
type PermissionService struct {
	repo            *repository.RBACRepository
	roomService     *RoomService
	categoryService *CategoryService
	userLookup      func(userID string) *models.User

	mu         sync.RWMutex
	roles      map[string]*models.Role
	userRoles  map[string][]string                               // user_id -> role IDs (no system roles)
	overwrites map[string]map[string]*models.PermissionOverwrite // "type:id" -> "subjectType:subjectID" -> overwrite
	colorRoles map[string]string                                 // user_id -> role picked to color their nickname

	listenersMu sync.RWMutex
	listeners   []func(PermissionChange)
}

// NewPermissionService creates the service. repo may be nil (memory-only mode).
func NewPermissionService(repo *repository.RBACRepository, roomService *RoomService, categoryService *CategoryService, userLookup func(string) *models.User) *PermissionService {
	return &PermissionService{
		repo:            repo,
		roomService:     roomService,
		categoryService: categoryService,
		userLookup:      userLookup,
		roles:           make(map[string]*models.Role),
		userRoles:       make(map[string][]string),
		overwrites:      make(map[string]map[string]*models.PermissionOverwrite),
		colorRoles:      make(map[string]string),
	}
}

// LoadFromDB fills the cache. In memory-only mode it seeds default system roles.
func (ps *PermissionService) LoadFromDB() error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	ps.roles = make(map[string]*models.Role)
	ps.userRoles = make(map[string][]string)
	ps.overwrites = make(map[string]map[string]*models.PermissionOverwrite)
	ps.colorRoles = make(map[string]string)

	if ps.repo == nil {
		now := time.Now()
		ps.roles[models.SystemRoleEveryone] = &models.Role{ID: models.SystemRoleEveryone, Name: "@everyone",
			Permissions: uint64(permissions.DefaultEveryone), SystemKey: models.SystemRoleEveryone, CreatedAt: now}
		ps.roles[models.SystemRoleGuest] = &models.Role{ID: models.SystemRoleGuest, Name: "Guest",
			DenyPermissions: uint64(permissions.DefaultGuestDeny), SystemKey: models.SystemRoleGuest, CreatedAt: now}
		ps.roles[models.SystemRoleOwner] = &models.Role{ID: models.SystemRoleOwner, Name: "Owner",
			Position: models.OwnerRolePosition, SystemKey: models.SystemRoleOwner, CreatedAt: now}
		return nil
	}

	roles, err := ps.repo.GetRoles()
	if err != nil {
		return err
	}
	for _, r := range roles {
		ps.roles[r.ID] = r
	}
	userRoles, err := ps.repo.GetUserRoles()
	if err != nil {
		return err
	}
	ps.userRoles = userRoles
	colorRoles, err := ps.repo.GetColorRoles()
	if err != nil {
		return err
	}
	ps.colorRoles = colorRoles
	overwrites, err := ps.repo.GetOverwrites()
	if err != nil {
		return err
	}
	for _, o := range overwrites {
		ps.putOverwriteLocked(o)
	}
	log.Printf("Loaded %d roles, %d role assignments, %d permission overwrites", len(roles), len(userRoles), len(overwrites))
	return nil
}

// Subscribe registers a listener called (synchronously, outside locks) after
// every permission-affecting mutation.
func (ps *PermissionService) Subscribe(fn func(PermissionChange)) {
	ps.listenersMu.Lock()
	defer ps.listenersMu.Unlock()
	ps.listeners = append(ps.listeners, fn)
}

// Notify broadcasts a change to listeners. Exported so other services
// (room/category moves, user deletes) can trigger recomputation.
func (ps *PermissionService) Notify(reason string) {
	ps.listenersMu.RLock()
	listeners := append([]func(PermissionChange){}, ps.listeners...)
	ps.listenersMu.RUnlock()
	for _, fn := range listeners {
		fn(PermissionChange{Reason: reason})
	}
}

// SubjectByID resolves a user ID to a Subject. Unknown users get no roles
// and are treated as guests (least privilege).
func (ps *PermissionService) SubjectByID(userID string) Subject {
	if ps.userLookup != nil {
		if u := ps.userLookup(userID); u != nil {
			return SubjectFromUser(u)
		}
	}
	return Subject{UserID: userID, IsGuest: true}
}

// ---- computation -----------------------------------------------------------

func targetKey(targetType, targetID string) string    { return targetType + ":" + targetID }
func subjectKey(subjectType, subjectID string) string { return subjectType + ":" + subjectID }

func (ps *PermissionService) putOverwriteLocked(o *models.PermissionOverwrite) {
	k := targetKey(o.TargetType, o.TargetID)
	if ps.overwrites[k] == nil {
		ps.overwrites[k] = make(map[string]*models.PermissionOverwrite)
	}
	ps.overwrites[k][subjectKey(o.SubjectType, o.SubjectID)] = o
}

// heldRoleIDsLocked returns the role IDs that apply to a subject, including
// the Guest system role for guests (but not @everyone).
func (ps *PermissionService) heldRoleIDsLocked(sub Subject) []string {
	ids := append([]string{}, ps.userRoles[sub.UserID]...)
	if sub.IsGuest {
		if _, ok := ps.roles[models.SystemRoleGuest]; ok {
			ids = append(ids, models.SystemRoleGuest)
		}
	}
	return ids
}

func (ps *PermissionService) baseInputLocked(sub Subject) (permissions.Input, []string) {
	in := permissions.Input{IsOwner: sub.IsOwner}
	if ev, ok := ps.roles[models.SystemRoleEveryone]; ok {
		in.Everyone = permissions.Permission(ev.Permissions)
	}
	held := ps.heldRoleIDsLocked(sub)
	roles := make([]*models.Role, 0, len(held))
	for _, id := range held {
		if r, ok := ps.roles[id]; ok {
			roles = append(roles, r)
		}
	}
	// Apply lowest position first so higher roles win. Guest (a system role at
	// position 0) sits directly above @everyone, below every custom role.
	sort.SliceStable(roles, func(i, j int) bool {
		if roles[i].Position != roles[j].Position {
			return roles[i].Position < roles[j].Position
		}
		return roles[i].SystemKey != "" && roles[j].SystemKey == ""
	})
	for _, r := range roles {
		in.Roles = append(in.Roles, permissions.RoleGrant{
			Allow: permissions.Permission(r.Permissions),
			Deny:  permissions.Permission(r.DenyPermissions),
		})
	}
	return in, held
}

func (ps *PermissionService) computeWithTargetLocked(sub Subject, targetType, targetID string) permissions.Permission {
	in, held := ps.baseInputLocked(sub)
	set := ps.overwrites[targetKey(targetType, targetID)]
	if set != nil {
		if o, ok := set[subjectKey(models.OverwriteSubjectRole, models.SystemRoleEveryone)]; ok {
			in.EveryoneOverwrite = &permissions.Overwrite{Allow: permissions.Permission(o.Allow), Deny: permissions.Permission(o.Deny)}
		}
		for _, id := range held {
			if o, ok := set[subjectKey(models.OverwriteSubjectRole, id)]; ok {
				in.RoleOverwrites = append(in.RoleOverwrites, permissions.Overwrite{Allow: permissions.Permission(o.Allow), Deny: permissions.Permission(o.Deny)})
			}
		}
		if o, ok := set[subjectKey(models.OverwriteSubjectUser, sub.UserID)]; ok {
			in.MemberOverwrite = &permissions.Overwrite{Allow: permissions.Permission(o.Allow), Deny: permissions.Permission(o.Deny)}
		}
	}
	return permissions.Compute(in)
}

// ServerPerms returns the subject's server-level permissions.
func (ps *PermissionService) ServerPerms(sub Subject) permissions.Permission {
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	in, _ := ps.baseInputLocked(sub)
	return permissions.Base(in)
}

// roomOverwriteTarget returns which overwrite set governs a room.
func roomOverwriteTarget(room *models.Room) (string, string) {
	if room.PermissionsSynced && room.Category != "" {
		return models.OverwriteTargetCategory, room.Category
	}
	return models.OverwriteTargetRoom, room.ID
}

// hasCustomPermissions reports whether any overwrite governing the room
// changes something (an overwrite with no allow and no deny bits does not).
func (ps *PermissionService) hasCustomPermissions(room *models.Room) bool {
	tt, tid := roomOverwriteTarget(room)
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	for _, o := range ps.overwrites[targetKey(tt, tid)] {
		if o.Allow|o.Deny != 0 {
			return true
		}
	}
	return false
}

// RoomPerms returns effective permissions in a room (0 if the room is unknown).
func (ps *PermissionService) RoomPerms(sub Subject, roomID string) permissions.Permission {
	room, ok := ps.roomService.GetRoom(roomID)
	if !ok {
		return 0
	}
	tt, tid := roomOverwriteTarget(room)
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	return ps.computeWithTargetLocked(sub, tt, tid)
}

// CategoryPerms returns effective permissions for a category's own overwrites.
func (ps *PermissionService) CategoryPerms(sub Subject, categoryID string) permissions.Permission {
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	return ps.computeWithTargetLocked(sub, models.OverwriteTargetCategory, categoryID)
}

// RoomViewers returns the IDs of the users who can see a room (ViewRoom),
// in input order. Unknown rooms have no viewers.
func (ps *PermissionService) RoomViewers(roomID string, users []*models.User) []string {
	out := []string{}
	room, ok := ps.roomService.GetRoom(roomID)
	if !ok {
		return out
	}
	tt, tid := roomOverwriteTarget(room)
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	for _, u := range users {
		if ps.computeWithTargetLocked(SubjectFromUser(u), tt, tid).Has(permissions.ViewRoom) {
			out = append(out, u.ID)
		}
	}
	return out
}

// CanInRoom reports whether the subject holds every bit of want in a room.
func (ps *PermissionService) CanInRoom(sub Subject, roomID string, want permissions.Permission) bool {
	return ps.RoomPerms(sub, roomID).Has(want)
}

// CanServer reports whether the subject holds every bit of want server-wide.
func (ps *PermissionService) CanServer(sub Subject, want permissions.Permission) bool {
	return ps.ServerPerms(sub).Has(want)
}

// CanSeeCategory: a category is visible if the subject can manage rooms in it
// or can see at least one of its rooms.
func (ps *PermissionService) CanSeeCategory(sub Subject, categoryID string) bool {
	if ps.CategoryPerms(sub, categoryID).Has(permissions.ManageRooms) {
		return true
	}
	for _, room := range ps.roomService.GetRoomsByCategory(categoryID) {
		if ps.CanInRoom(sub, room.ID, permissions.ViewRoom) {
			return true
		}
	}
	return false
}

func (ps *PermissionService) topPositionLocked(sub Subject) int {
	if sub.IsOwner {
		return math.MaxInt
	}
	top := 0
	for _, id := range ps.userRoles[sub.UserID] {
		if r, ok := ps.roles[id]; ok && r.Position > top {
			top = r.Position
		}
	}
	return top
}

// TopPosition returns the highest role position the subject holds.
func (ps *PermissionService) TopPosition(sub Subject) int {
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	return ps.topPositionLocked(sub)
}

// CanTarget reports whether actor outranks target (for kick/mute/move).
// Nobody can target the owner; the owner can target anyone but themself.
func (ps *PermissionService) CanTarget(actor, target Subject) bool {
	if actor.UserID == target.UserID || target.IsOwner {
		return false
	}
	if actor.IsOwner {
		return true
	}
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	return ps.topPositionLocked(actor) > ps.topPositionLocked(target)
}

// Me builds the full permission snapshot for a subject.
func (ps *PermissionService) Me(sub Subject) MyPermissions {
	out := MyPermissions{
		IsOwner:    sub.IsOwner,
		Server:     uint64(ps.ServerPerms(sub)),
		Rooms:      make(map[string]uint64),
		Categories: make(map[string]uint64),
		RoleIDs:    ps.UserRoleIDs(sub.UserID),
		TopPos:     ps.TopPosition(sub),

		PrivateRooms: []string{},
	}
	if out.TopPos == math.MaxInt {
		out.TopPos = math.MaxInt32
	}
	for _, room := range ps.roomService.GetRooms() {
		perms := ps.RoomPerms(sub, room.ID)
		out.Rooms[room.ID] = uint64(perms)
		// Only rooms the subject can see: hidden rooms stay unlisted.
		if perms.Has(permissions.ViewRoom) && ps.hasCustomPermissions(&room) {
			out.PrivateRooms = append(out.PrivateRooms, room.ID)
		}
	}
	sort.Strings(out.PrivateRooms)
	if ps.categoryService != nil {
		for _, c := range ps.categoryService.GetCategories() {
			out.Categories[c.ID] = uint64(ps.CategoryPerms(sub, c.ID))
		}
	}
	return out
}

// ---- reads -----------------------------------------------------------------

// Roles returns all roles ordered by position (highest first).
func (ps *PermissionService) Roles() []models.Role {
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	out := make([]models.Role, 0, len(ps.roles))
	for _, r := range ps.roles {
		out = append(out, *r)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Position != out[j].Position {
			return out[i].Position > out[j].Position
		}
		return out[i].CreatedAt.Before(out[j].CreatedAt)
	})
	return out
}

// UserRoleIDs returns the explicit (non-system) role IDs assigned to a user.
func (ps *PermissionService) UserRoleIDs(userID string) []string {
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	ids := append([]string{}, ps.userRoles[userID]...)
	sort.Strings(ids)
	return ids
}

// AllUserRoleIDs returns a snapshot of every assignment.
func (ps *PermissionService) AllUserRoleIDs() map[string][]string {
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	out := make(map[string][]string, len(ps.userRoles))
	for k, v := range ps.userRoles {
		out[k] = append([]string{}, v...)
	}
	return out
}

// ColorRoles returns a snapshot of user_id -> role picked to color their nickname.
func (ps *PermissionService) ColorRoles() map[string]string {
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	out := make(map[string]string, len(ps.colorRoles))
	for k, v := range ps.colorRoles {
		out[k] = v
	}
	return out
}

// SetColorRole picks which of the user's own roles colors their nickname.
// An empty roleID means automatic (the highest colored role). The role must
// be colored and held by the user: assigned to them, or the implicit Owner
// role for the super admin.
func (ps *PermissionService) SetColorRole(sub Subject, roleID string) error {
	if sub.IsGuest {
		return rbacForbidden("guests cannot pick a name color")
	}
	ps.mu.Lock()
	if roleID != "" {
		role, ok := ps.roles[roleID]
		if !ok {
			ps.mu.Unlock()
			return ErrRBACNotFound
		}
		if role.Color == "" {
			ps.mu.Unlock()
			return rbacInvalid("role has no color")
		}
		held := role.SystemKey == models.SystemRoleOwner && sub.IsOwner
		if role.SystemKey == "" {
			for _, id := range ps.userRoles[sub.UserID] {
				if id == roleID {
					held = true
					break
				}
			}
		}
		if !held {
			ps.mu.Unlock()
			return rbacForbidden("you do not have this role")
		}
	}
	if ps.repo != nil {
		if err := ps.repo.SetColorRole(sub.UserID, roleID); err != nil {
			ps.mu.Unlock()
			return err
		}
	}
	if roleID == "" {
		delete(ps.colorRoles, sub.UserID)
	} else {
		ps.colorRoles[sub.UserID] = roleID
	}
	ps.mu.Unlock()
	return nil
}

// dropColorRoleLocked clears a user's color pick if it is no longer held.
func (ps *PermissionService) dropColorRoleLocked(userID string, held []string) {
	picked, ok := ps.colorRoles[userID]
	if !ok {
		return
	}
	if r, exists := ps.roles[picked]; exists && r.SystemKey == models.SystemRoleOwner {
		return // the Owner role is implicit, never assigned
	}
	for _, id := range held {
		if id == picked {
			return
		}
	}
	if ps.repo != nil {
		if err := ps.repo.SetColorRole(userID, ""); err != nil {
			log.Printf("Failed to clear color role of %s: %v", userID, err)
			return
		}
	}
	delete(ps.colorRoles, userID)
}

// Overwrites returns the overwrites stored directly on a room or category.
func (ps *PermissionService) Overwrites(targetType, targetID string) []models.PermissionOverwrite {
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	set := ps.overwrites[targetKey(targetType, targetID)]
	out := make([]models.PermissionOverwrite, 0, len(set))
	for _, o := range set {
		out = append(out, *o)
	}
	sort.Slice(out, func(i, j int) bool {
		return subjectKey(out[i].SubjectType, out[i].SubjectID) < subjectKey(out[j].SubjectType, out[j].SubjectID)
	})
	return out
}

// ---- mutations -------------------------------------------------------------

// requireManageRoles checks the actor can manage roles and returns their
// server permissions and top position.
func (ps *PermissionService) requireManageRolesLocked(actor Subject) (permissions.Permission, int, error) {
	in, _ := ps.baseInputLocked(actor)
	perms := permissions.Base(in)
	if !perms.Has(permissions.ManageRoles) {
		return 0, 0, rbacForbidden("manage_roles required")
	}
	return perms, ps.topPositionLocked(actor), nil
}

// checkGrantable: an actor may only toggle bits they hold themselves.
func checkGrantable(actorPerms permissions.Permission, oldBits, newBits uint64) error {
	if actorPerms == permissions.All {
		return nil
	}
	changed := permissions.Permission(oldBits ^ newBits)
	if changed&^actorPerms != 0 {
		return rbacForbidden("cannot change permissions you do not have")
	}
	return nil
}

func validateRoleFields(name, color string) (string, string, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 32 {
		return "", "", rbacInvalid("role name must be 1-32 characters")
	}
	if strings.HasPrefix(name, "@") {
		return "", "", rbacInvalid("role name cannot start with @")
	}
	color = strings.TrimSpace(color)
	if color != "" {
		if len(color) != 7 || color[0] != '#' {
			return "", "", rbacInvalid("color must be #rrggbb")
		}
		for _, c := range color[1:] {
			if !strings.ContainsRune("0123456789abcdefABCDEF", c) {
				return "", "", rbacInvalid("color must be #rrggbb")
			}
		}
	}
	return name, color, nil
}

// RoleInput is the mutable part of a role.
type RoleInput struct {
	Name            *string
	Color           *string
	Permissions     *uint64
	DenyPermissions *uint64
}

// CreateRole creates a role at the bottom of the hierarchy (position 1),
// shifting other custom roles up, like Discord.
func (ps *PermissionService) CreateRole(actor Subject, in RoleInput) (*models.Role, error) {
	ps.mu.Lock()
	actorPerms, _, err := ps.requireManageRolesLocked(actor)
	if err != nil {
		ps.mu.Unlock()
		return nil, err
	}
	name, color := "", ""
	if in.Name != nil {
		name = *in.Name
	}
	if in.Color != nil {
		color = *in.Color
	}
	name, color, err = validateRoleFields(name, color)
	if err != nil {
		ps.mu.Unlock()
		return nil, err
	}
	var perms, deny uint64
	if in.Permissions != nil {
		perms = *in.Permissions & uint64(permissions.All)
	}
	if in.DenyPermissions != nil {
		deny = *in.DenyPermissions & uint64(permissions.All)
	}
	if perms&deny != 0 {
		ps.mu.Unlock()
		return nil, rbacInvalid("a permission cannot be both allowed and denied")
	}
	if err := checkGrantable(actorPerms, 0, perms); err != nil {
		ps.mu.Unlock()
		return nil, err
	}
	if err := checkGrantable(actorPerms, 0, deny); err != nil {
		ps.mu.Unlock()
		return nil, err
	}

	shift := make(map[string]int)
	for id, r := range ps.roles {
		if r.SystemKey == "" && r.Position >= 1 {
			shift[id] = r.Position + 1
		}
	}
	role := &models.Role{ID: generateID(), Name: name, Color: color, Position: 1, Permissions: perms, DenyPermissions: deny, CreatedAt: time.Now()}
	if ps.repo != nil {
		if err := ps.repo.UpdateRolePositions(shift); err != nil {
			ps.mu.Unlock()
			return nil, err
		}
		if err := ps.repo.CreateRole(role); err != nil {
			ps.mu.Unlock()
			return nil, err
		}
	}
	for id, pos := range shift {
		ps.roles[id].Position = pos
	}
	ps.roles[role.ID] = role
	out := *role
	ps.mu.Unlock()
	ps.Notify("role_created")
	return &out, nil
}

// UpdateRole edits name/color/permissions of a role below the actor.
// @everyone and Guest may be edited by anyone with manage_roles. The Owner
// role may only be edited by the owner, and only its name and colour.
func (ps *PermissionService) UpdateRole(actor Subject, roleID string, in RoleInput) (*models.Role, error) {
	ps.mu.Lock()
	actorPerms, top, err := ps.requireManageRolesLocked(actor)
	if err != nil {
		ps.mu.Unlock()
		return nil, err
	}
	role, ok := ps.roles[roleID]
	if !ok {
		ps.mu.Unlock()
		return nil, ErrRBACNotFound
	}
	if role.SystemKey == "" && role.Position >= top {
		ps.mu.Unlock()
		return nil, rbacForbidden("cannot edit a role at or above your highest role")
	}
	isOwnerRole := role.SystemKey == models.SystemRoleOwner
	if isOwnerRole && !actor.IsOwner {
		ps.mu.Unlock()
		return nil, rbacForbidden("only the owner can edit the Owner role")
	}
	// Customisable roles: custom roles and Owner (name and colour).
	customisable := role.SystemKey == "" || isOwnerRole
	updated := *role
	if in.Name != nil || in.Color != nil {
		if !customisable && in.Name != nil && *in.Name != role.Name {
			ps.mu.Unlock()
			return nil, rbacInvalid("system roles cannot be renamed")
		}
		name, color := role.Name, role.Color
		if in.Name != nil {
			name = *in.Name
		}
		if in.Color != nil {
			color = *in.Color
		}
		if customisable {
			if name, color, err = validateRoleFields(name, color); err != nil {
				ps.mu.Unlock()
				return nil, err
			}
		}
		updated.Name, updated.Color = name, color
	}
	if in.Permissions != nil {
		updated.Permissions = *in.Permissions & uint64(permissions.All)
		if role.SystemKey == models.SystemRoleEveryone {
			// @everyone holding Administrator would make everyone an admin.
			updated.Permissions &^= uint64(permissions.Administrator)
		}
	}
	if in.DenyPermissions != nil {
		updated.DenyPermissions = *in.DenyPermissions & uint64(permissions.All)
	}
	if role.SystemKey == models.SystemRoleEveryone {
		// @everyone is the base layer: there is nothing below it to deny.
		updated.DenyPermissions = 0
	}
	if isOwnerRole {
		// The owner bypasses permission checks; bits here would be meaningless.
		updated.Permissions, updated.DenyPermissions = 0, 0
	}
	if updated.Permissions&updated.DenyPermissions != 0 {
		ps.mu.Unlock()
		return nil, rbacInvalid("a permission cannot be both allowed and denied")
	}
	if err := checkGrantable(actorPerms, role.Permissions, updated.Permissions); err != nil {
		ps.mu.Unlock()
		return nil, err
	}
	if err := checkGrantable(actorPerms, role.DenyPermissions, updated.DenyPermissions); err != nil {
		ps.mu.Unlock()
		return nil, err
	}
	if ps.repo != nil {
		if err := ps.repo.UpdateRole(&updated); err != nil {
			ps.mu.Unlock()
			return nil, err
		}
	}
	*role = updated
	ps.mu.Unlock()
	ps.Notify("role_updated")
	return &updated, nil
}

// DeleteRole deletes a custom role below the actor.
func (ps *PermissionService) DeleteRole(actor Subject, roleID string) error {
	ps.mu.Lock()
	_, top, err := ps.requireManageRolesLocked(actor)
	if err != nil {
		ps.mu.Unlock()
		return err
	}
	role, ok := ps.roles[roleID]
	if !ok {
		ps.mu.Unlock()
		return ErrRBACNotFound
	}
	if role.SystemKey != "" {
		ps.mu.Unlock()
		return rbacInvalid("system roles cannot be deleted")
	}
	if role.Position >= top {
		ps.mu.Unlock()
		return rbacForbidden("cannot delete a role at or above your highest role")
	}
	if ps.repo != nil {
		if err := ps.repo.DeleteRole(roleID); err != nil {
			ps.mu.Unlock()
			return err
		}
	}
	delete(ps.roles, roleID)
	for uid, ids := range ps.userRoles {
		ps.userRoles[uid] = removeString(ids, roleID)
	}
	for uid, picked := range ps.colorRoles {
		if picked == roleID {
			delete(ps.colorRoles, uid) // the DB row went with the role
		}
	}
	for _, set := range ps.overwrites {
		delete(set, subjectKey(models.OverwriteSubjectRole, roleID))
	}
	ps.mu.Unlock()
	ps.Notify("role_deleted")
	return nil
}

// ReorderRoles sets new positions. Only custom roles below the actor may move,
// and they must stay below the actor.
func (ps *PermissionService) ReorderRoles(actor Subject, positions map[string]int) error {
	ps.mu.Lock()
	_, top, err := ps.requireManageRolesLocked(actor)
	if err != nil {
		ps.mu.Unlock()
		return err
	}
	for id, pos := range positions {
		role, ok := ps.roles[id]
		if !ok {
			ps.mu.Unlock()
			return ErrRBACNotFound
		}
		if role.SystemKey != "" {
			ps.mu.Unlock()
			return rbacInvalid("system roles cannot be reordered")
		}
		if pos < 1 {
			ps.mu.Unlock()
			return rbacInvalid("position must be >= 1")
		}
		if role.Position >= top || pos >= top {
			ps.mu.Unlock()
			return rbacForbidden("cannot move roles at or above your highest role")
		}
	}
	if ps.repo != nil {
		if err := ps.repo.UpdateRolePositions(positions); err != nil {
			ps.mu.Unlock()
			return err
		}
	}
	for id, pos := range positions {
		ps.roles[id].Position = pos
	}
	ps.mu.Unlock()
	ps.Notify("roles_reordered")
	return nil
}

// SetUserRoles replaces a user's custom roles. Every role added or removed
// must be below the actor's highest role.
func (ps *PermissionService) SetUserRoles(actor Subject, targetUserID string, roleIDs []string) ([]string, error) {
	if ps.userLookup != nil {
		target := ps.userLookup(targetUserID)
		if target == nil {
			return nil, ErrRBACNotFound
		}
		// Only the owner may change the owner's roles (e.g. for a name colour).
		if target.Role == models.RoleSuperAdmin && !actor.IsOwner {
			return nil, rbacForbidden("only the owner can change the owner's roles")
		}
	}
	ps.mu.Lock()
	_, top, err := ps.requireManageRolesLocked(actor)
	if err != nil {
		ps.mu.Unlock()
		return nil, err
	}
	want := make(map[string]bool)
	for _, id := range roleIDs {
		role, ok := ps.roles[id]
		if !ok {
			ps.mu.Unlock()
			return nil, rbacInvalid("unknown role " + id)
		}
		if role.SystemKey != "" {
			ps.mu.Unlock()
			return nil, rbacInvalid("system roles cannot be assigned")
		}
		want[id] = true
	}
	have := make(map[string]bool)
	for _, id := range ps.userRoles[targetUserID] {
		have[id] = true
	}
	for id := range want {
		if !have[id] && ps.roles[id].Position >= top {
			ps.mu.Unlock()
			return nil, rbacForbidden("cannot assign a role at or above your highest role")
		}
	}
	for id := range have {
		if !want[id] {
			if r, ok := ps.roles[id]; ok && r.Position >= top {
				ps.mu.Unlock()
				return nil, rbacForbidden("cannot remove a role at or above your highest role")
			}
		}
	}
	final := make([]string, 0, len(want))
	for id := range want {
		final = append(final, id)
	}
	sort.Strings(final)
	if ps.repo != nil {
		if err := ps.repo.SetUserRoles(targetUserID, final); err != nil {
			ps.mu.Unlock()
			return nil, err
		}
	}
	if len(final) == 0 {
		delete(ps.userRoles, targetUserID)
	} else {
		ps.userRoles[targetUserID] = final
	}
	ps.dropColorRoleLocked(targetUserID, final)
	ps.mu.Unlock()
	ps.Notify("user_roles_updated")
	return final, nil
}

// targetPermsFor computes the actor's perms in an overwrite target.
func (ps *PermissionService) targetPermsFor(actor Subject, targetType, targetID string) (permissions.Permission, error) {
	switch targetType {
	case models.OverwriteTargetRoom:
		if _, ok := ps.roomService.GetRoom(targetID); !ok {
			return 0, ErrRBACNotFound
		}
		return ps.RoomPerms(actor, targetID), nil
	case models.OverwriteTargetCategory:
		if ps.categoryService != nil {
			if _, ok := ps.categoryService.GetCategory(targetID); !ok {
				return 0, ErrRBACNotFound
			}
		}
		return ps.CategoryPerms(actor, targetID), nil
	default:
		return 0, rbacInvalid("target_type must be room or category")
	}
}

// checkOverwriteActor: editing overwrites needs manage_roles (server) plus
// manage_rooms in the target.
func (ps *PermissionService) checkOverwriteActor(actor Subject, targetType, targetID string) (permissions.Permission, error) {
	if !ps.CanServer(actor, permissions.ManageRoles) {
		return 0, rbacForbidden("manage_roles required")
	}
	tp, err := ps.targetPermsFor(actor, targetType, targetID)
	if err != nil {
		return 0, err
	}
	if !tp.Has(permissions.ManageRooms) {
		return 0, rbacForbidden("manage_rooms required in target")
	}
	return tp, nil
}

// unsyncRoomLocked copies the category overwrites onto a synced room so it
// can be edited independently (Discord behaviour). Caller holds ps.mu.
func (ps *PermissionService) unsyncRoomLocked(room *models.Room) error {
	if !room.PermissionsSynced {
		return nil
	}
	var copies []*models.PermissionOverwrite
	if room.Category != "" {
		for _, o := range ps.overwrites[targetKey(models.OverwriteTargetCategory, room.Category)] {
			c := *o
			c.TargetType, c.TargetID = models.OverwriteTargetRoom, room.ID
			copies = append(copies, &c)
		}
	}
	if ps.repo != nil {
		if err := ps.repo.ReplaceTargetOverwrites(models.OverwriteTargetRoom, room.ID, copies); err != nil {
			return err
		}
	}
	delete(ps.overwrites, targetKey(models.OverwriteTargetRoom, room.ID))
	for _, c := range copies {
		ps.putOverwriteLocked(c)
	}
	return ps.roomService.SetPermissionsSynced(room.ID, false)
}

// SetOverwrite creates or replaces an overwrite. Editing a synced room's
// overwrites un-syncs it first.
func (ps *PermissionService) SetOverwrite(actor Subject, o models.PermissionOverwrite) (*models.PermissionOverwrite, error) {
	tp, err := ps.checkOverwriteActor(actor, o.TargetType, o.TargetID)
	if err != nil {
		return nil, err
	}
	switch o.SubjectType {
	case models.OverwriteSubjectRole:
		ps.mu.RLock()
		r, ok := ps.roles[o.SubjectID]
		ps.mu.RUnlock()
		if !ok {
			return nil, rbacInvalid("unknown role")
		}
		if r.SystemKey == models.SystemRoleOwner {
			return nil, rbacInvalid("the Owner role cannot have overwrites")
		}
	case models.OverwriteSubjectUser:
		if ps.userLookup != nil && ps.userLookup(o.SubjectID) == nil {
			return nil, rbacInvalid("unknown user")
		}
	default:
		return nil, rbacInvalid("subject_type must be role or user")
	}
	if o.Allow&^uint64(permissions.Overwritable) != 0 || o.Deny&^uint64(permissions.Overwritable) != 0 {
		return nil, rbacInvalid("overwrite contains role-only permissions")
	}
	if o.Allow&o.Deny != 0 {
		return nil, rbacInvalid("a permission cannot be both allowed and denied")
	}

	var room *models.Room
	if o.TargetType == models.OverwriteTargetRoom {
		room, _ = ps.roomService.GetRoom(o.TargetID)
	}

	ps.mu.Lock()
	if room != nil {
		if err := ps.unsyncRoomLocked(room); err != nil {
			ps.mu.Unlock()
			return nil, err
		}
	}
	var oldAllow, oldDeny uint64
	if set := ps.overwrites[targetKey(o.TargetType, o.TargetID)]; set != nil {
		if prev, ok := set[subjectKey(o.SubjectType, o.SubjectID)]; ok {
			oldAllow, oldDeny = prev.Allow, prev.Deny
		}
	}
	if err := checkGrantable(tp, oldAllow, o.Allow); err != nil {
		ps.mu.Unlock()
		return nil, err
	}
	if err := checkGrantable(tp, oldDeny, o.Deny); err != nil {
		ps.mu.Unlock()
		return nil, err
	}
	stored := o
	if ps.repo != nil {
		if err := ps.repo.UpsertOverwrite(&stored); err != nil {
			ps.mu.Unlock()
			return nil, err
		}
	}
	ps.putOverwriteLocked(&stored)
	ps.mu.Unlock()
	ps.Notify("overwrite_set")
	out := stored
	return &out, nil
}

// DeleteOverwrite removes an overwrite.
func (ps *PermissionService) DeleteOverwrite(actor Subject, targetType, targetID, subjectType, subjectID string) error {
	tp, err := ps.checkOverwriteActor(actor, targetType, targetID)
	if err != nil {
		return err
	}
	var room *models.Room
	if targetType == models.OverwriteTargetRoom {
		room, _ = ps.roomService.GetRoom(targetID)
	}
	ps.mu.Lock()
	if room != nil {
		if err := ps.unsyncRoomLocked(room); err != nil {
			ps.mu.Unlock()
			return err
		}
	}
	set := ps.overwrites[targetKey(targetType, targetID)]
	prev, ok := set[subjectKey(subjectType, subjectID)]
	if !ok {
		ps.mu.Unlock()
		return ErrRBACNotFound
	}
	if err := checkGrantable(tp, prev.Allow, 0); err != nil {
		ps.mu.Unlock()
		return err
	}
	if err := checkGrantable(tp, prev.Deny, 0); err != nil {
		ps.mu.Unlock()
		return err
	}
	if ps.repo != nil {
		if err := ps.repo.DeleteOverwrite(targetType, targetID, subjectType, subjectID); err != nil {
			ps.mu.Unlock()
			return err
		}
	}
	delete(set, subjectKey(subjectType, subjectID))
	ps.mu.Unlock()
	ps.Notify("overwrite_deleted")
	return nil
}

// SetRoomSynced toggles category sync. Turning sync off copies the category
// overwrites into the room; turning it on discards the room's own overwrites.
func (ps *PermissionService) SetRoomSynced(actor Subject, roomID string, synced bool) error {
	if _, err := ps.checkOverwriteActor(actor, models.OverwriteTargetRoom, roomID); err != nil {
		return err
	}
	room, ok := ps.roomService.GetRoom(roomID)
	if !ok {
		return ErrRBACNotFound
	}
	if room.PermissionsSynced == synced {
		return nil
	}
	ps.mu.Lock()
	if synced {
		if ps.repo != nil {
			if err := ps.repo.ReplaceTargetOverwrites(models.OverwriteTargetRoom, roomID, nil); err != nil {
				ps.mu.Unlock()
				return err
			}
		}
		delete(ps.overwrites, targetKey(models.OverwriteTargetRoom, roomID))
		if err := ps.roomService.SetPermissionsSynced(roomID, true); err != nil {
			ps.mu.Unlock()
			return err
		}
	} else if err := ps.unsyncRoomLocked(room); err != nil {
		ps.mu.Unlock()
		return err
	}
	ps.mu.Unlock()
	ps.Notify("room_sync_changed")
	return nil
}

// ForgetTarget drops overwrites of a deleted room or category.
func (ps *PermissionService) ForgetTarget(targetType, targetID string) {
	ps.mu.Lock()
	if ps.repo != nil {
		if err := ps.repo.ReplaceTargetOverwrites(targetType, targetID, nil); err != nil {
			log.Printf("Failed to delete overwrites for %s %s: %v", targetType, targetID, err)
		}
	}
	delete(ps.overwrites, targetKey(targetType, targetID))
	ps.mu.Unlock()
}

// ForgetUser drops cached assignments/overwrites of a deleted user (the DB
// rows are removed by UserRepository.Delete).
func (ps *PermissionService) ForgetUser(userID string) {
	ps.mu.Lock()
	delete(ps.userRoles, userID)
	delete(ps.colorRoles, userID)
	for _, set := range ps.overwrites {
		delete(set, subjectKey(models.OverwriteSubjectUser, userID))
	}
	ps.mu.Unlock()
}

func removeString(list []string, s string) []string {
	out := list[:0]
	for _, v := range list {
		if v != s {
			out = append(out, v)
		}
	}
	return out
}
