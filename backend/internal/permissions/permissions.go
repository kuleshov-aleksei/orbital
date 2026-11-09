// Package permissions implements Discord-style permission bits and the
// effective-permission computation. It is pure (no DB, no IO) so it can be
// tested exhaustively and shared by HTTP, WebSocket and LiveKit code paths.
//
// Keep the bit values in sync with frontend/src/types/permissions.ts.
// All bits must stay below 2^31 so they survive JSON -> JS number conversion.
package permissions

// Permission is a bitfield of granted capabilities.
type Permission uint64

const (
	// Administrator grants every permission and ignores overwrites.
	// Role-level only.
	Administrator Permission = 1 << 0
	// ManageRoles allows creating/editing/assigning roles below the actor's
	// top role and editing permission overwrites. Role-level only.
	ManageRoles Permission = 1 << 1
	// ManageRooms allows creating/editing/deleting/reordering rooms and
	// categories. Overwritable per room/category.
	ManageRooms Permission = 1 << 2
	// ManageAudio allows deleting/editing shared audio files. Role-level only.
	ManageAudio Permission = 1 << 3

	// ViewRoom allows seeing a room in lists, events and presence.
	ViewRoom Permission = 1 << 8
	// Connect allows joining a room (WS/REST join and LiveKit token).
	Connect Permission = 1 << 9
	// Speak allows publishing the microphone.
	Speak Permission = 1 << 10
	// Video allows publishing the camera.
	Video Permission = 1 << 11
	// Screenshare allows publishing screen video and screen audio.
	Screenshare Permission = 1 << 12
	// SendMessages allows sending room chat messages.
	SendMessages Permission = 1 << 13
	// UseBoombox allows playing music through the boombox (spatial rooms).
	// Not the future in-call soundboard, which should get its own bit.
	UseBoombox Permission = 1 << 14
	// KickMembers allows disconnecting other members from a room.
	KickMembers Permission = 1 << 15
	// MuteMembers is reserved for server-side mute (not implemented yet).
	MuteMembers Permission = 1 << 16
	// MoveMembers is reserved for moving members between rooms (not implemented yet).
	MoveMembers Permission = 1 << 17
)

// All is every defined permission.
const All = Administrator | ManageRoles | ManageRooms | ManageAudio |
	ViewRoom | Connect | Speak | Video | Screenshare | SendMessages |
	UseBoombox | KickMembers | MuteMembers | MoveMembers

// RoleOnly are permissions that cannot be set through overwrites.
const RoleOnly = Administrator | ManageRoles | ManageAudio

// Overwritable are permissions that may appear in room/category overwrites.
const Overwritable = All &^ RoleOnly

// RoomScoped are permissions that are meaningless without ViewRoom.
const RoomScoped = Overwritable

// voiceScoped are permissions that are meaningless without Connect.
const voiceScoped = Speak | Video | Screenshare | UseBoombox

// DefaultEveryone is the seed permission set for the @everyone role.
const DefaultEveryone = ViewRoom | Connect | Speak | Video | Screenshare | SendMessages | UseBoombox

// DefaultGuestDeny is the seed deny mask for the Guest system role.
const DefaultGuestDeny = Video | Screenshare

// DefaultAdmin is the seed permission set for the migrated Admin role. It
// matches exactly what the legacy "admin" global role could do.
const DefaultAdmin = ManageRooms | KickMembers | ManageAudio

// Has reports whether p contains every bit in want.
func (p Permission) Has(want Permission) bool { return p&want == want }

// Names maps the wire name of each permission to its bit. Used by the catalog
// endpoint so the frontend can render permission editors.
var Names = map[string]Permission{
	"administrator":  Administrator,
	"manage_roles":   ManageRoles,
	"manage_rooms":   ManageRooms,
	"manage_audio":   ManageAudio,
	"view_room":      ViewRoom,
	"connect":        Connect,
	"speak":          Speak,
	"video":          Video,
	"screenshare":    Screenshare,
	"send_messages":  SendMessages,
	"use_boombox": UseBoombox,
	"kick_members":   KickMembers,
	"mute_members":   MuteMembers,
	"move_members":   MoveMembers,
}

// Overwrite is an allow/deny pair for one subject on one room or category.
type Overwrite struct {
	Allow Permission
	Deny  Permission
}

// RoleGrant is one role's tri-state permissions: bits in Allow are granted,
// bits in Deny are revoked, everything else is inherited from lower roles.
type RoleGrant struct {
	Allow Permission
	Deny  Permission
}

// Input is everything needed to compute a user's effective permissions.
type Input struct {
	// IsOwner short-circuits to All (the single super admin).
	IsOwner bool
	// Everyone is the @everyone role's permissions (the base layer).
	Everyone Permission
	// Roles are the roles the user holds (excluding @everyone), ordered from
	// LOWEST to HIGHEST position. Each is applied on top of the previous
	// ones, so a higher role's allow/deny wins over a lower role's.
	Roles []RoleGrant

	// Channel overwrites. Leave all nil/zero to compute server-level perms.
	EveryoneOverwrite *Overwrite
	RoleOverwrites    []Overwrite // overwrites for roles the user holds
	MemberOverwrite   *Overwrite
}

// Base computes server-level permissions (no channel overwrites).
func Base(in Input) Permission {
	if in.IsOwner {
		return All
	}
	p := in.Everyone
	for _, r := range in.Roles {
		p &^= r.Deny
		p |= r.Allow
	}
	if p.Has(Administrator) {
		return All
	}
	return p
}

// Compute returns effective permissions following Discord's algorithm:
// base roles -> @everyone overwrite -> combined role overwrites -> member
// overwrite, with deny applied before allow at each step.
func Compute(in Input) Permission {
	p := Base(in)
	if p == All {
		return All
	}

	if in.EveryoneOverwrite != nil {
		p &^= in.EveryoneOverwrite.Deny & Overwritable
		p |= in.EveryoneOverwrite.Allow & Overwritable
	}

	var allow, deny Permission
	for _, o := range in.RoleOverwrites {
		allow |= o.Allow
		deny |= o.Deny
	}
	p &^= deny & Overwritable
	p |= allow & Overwritable

	if in.MemberOverwrite != nil {
		p &^= in.MemberOverwrite.Deny & Overwritable
		p |= in.MemberOverwrite.Allow & Overwritable
	}

	if !p.Has(ViewRoom) {
		p &^= RoomScoped
	}
	if !p.Has(Connect) {
		p &^= voiceScoped
	}
	return p
}
