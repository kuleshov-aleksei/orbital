package permissions

import "testing"

func TestCompute(t *testing.T) {
	ow := func(allow, deny Permission) *Overwrite { return &Overwrite{Allow: allow, Deny: deny} }

	tests := []struct {
		name    string
		in      Input
		want    Permission // bits that must be set
		wantNot Permission // bits that must be clear
	}{
		{
			name: "owner gets everything even with denies",
			in:   Input{IsOwner: true, EveryoneOverwrite: ow(0, ViewRoom)},
			want: All,
		},
		{
			name:    "everyone defaults",
			in:      Input{Everyone: DefaultEveryone},
			want:    DefaultEveryone,
			wantNot: ManageRooms,
		},
		{
			name: "administrator ignores overwrites",
			in: Input{Everyone: DefaultEveryone, Roles: []RoleGrant{{Allow: Administrator}},
				EveryoneOverwrite: ow(0, ViewRoom)},
			want: All,
		},
		{
			name:    "guest base deny",
			in:      Input{Everyone: DefaultEveryone, Roles: []RoleGrant{{Deny: DefaultGuestDeny}}},
			want:    Speak | Connect,
			wantNot: Video | Screenshare,
		},
		{
			name: "room overwrite re-allows guest screenshare",
			in: Input{Everyone: DefaultEveryone, Roles: []RoleGrant{{Deny: DefaultGuestDeny}},
				EveryoneOverwrite: ow(Screenshare, 0)},
			want: Screenshare,
		},
		{
			name: "everyone deny hides room and clears room perms",
			in: Input{Everyone: DefaultEveryone, Roles: []RoleGrant{{Allow: ManageRooms}},
				EveryoneOverwrite: ow(0, ViewRoom)},
			wantNot: ViewRoom | Connect | Speak | ManageRooms,
		},
		{
			name: "role allow beats everyone deny",
			in: Input{Everyone: DefaultEveryone,
				EveryoneOverwrite: ow(0, ViewRoom),
				RoleOverwrites:    []Overwrite{{Allow: ViewRoom}}},
			want: ViewRoom | Connect,
		},
		{
			name: "role allow wins over another role deny",
			in: Input{Everyone: DefaultEveryone,
				RoleOverwrites: []Overwrite{{Deny: Speak}, {Allow: Speak}}},
			want: Speak,
		},
		{
			name: "member deny beats role allow",
			in: Input{Everyone: DefaultEveryone,
				RoleOverwrites:  []Overwrite{{Allow: Screenshare}},
				MemberOverwrite: ow(0, Screenshare)},
			wantNot: Screenshare,
		},
		{
			name:    "no connect clears voice perms",
			in:      Input{Everyone: DefaultEveryone, EveryoneOverwrite: ow(0, Connect)},
			want:    ViewRoom | SendMessages,
			wantNot: Speak | Video | Screenshare | UseBoombox,
		},
		{
			name: "overwrites cannot grant role-only bits",
			in: Input{Everyone: DefaultEveryone,
				MemberOverwrite: ow(Administrator|ManageRoles, 0)},
			wantNot: Administrator | ManageRoles,
		},
		{
			name:    "higher role deny beats lower role allow",
			in:      Input{Everyone: DefaultEveryone, Roles: []RoleGrant{{Allow: ManageRooms}, {Deny: ManageRooms | Video}}},
			want:    Speak,
			wantNot: ManageRooms | Video,
		},
		{
			name: "higher role allow beats lower role deny",
			in:   Input{Everyone: DefaultEveryone, Roles: []RoleGrant{{Deny: Screenshare}, {Allow: Screenshare}}},
			want: Screenshare,
		},
		{
			name: "overwrite can grant manage rooms in one room",
			in:   Input{Everyone: DefaultEveryone, RoleOverwrites: []Overwrite{{Allow: ManageRooms}}},
			want: ManageRooms,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Compute(tt.in)
			if !got.Has(tt.want) {
				t.Errorf("missing bits: got %b want %b", got, tt.want)
			}
			if got&tt.wantNot != 0 {
				t.Errorf("unexpected bits: got %b, must not have %b", got, tt.wantNot)
			}
		})
	}
}

func TestNamesCoverAll(t *testing.T) {
	var union Permission
	for _, p := range Names {
		union |= p
	}
	if union != All {
		t.Fatalf("Names does not cover All: %b vs %b", union, All)
	}
	if All >= 1<<31 {
		t.Fatalf("permission bits must stay below 2^31")
	}
}
