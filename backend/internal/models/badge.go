package models

import "time"

// Badge is a profile achievement awarded to users. Definitions are shared, so
// one upload can be granted to many people.
type Badge struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Filename    string    `json:"-"`
	FileSize    int64     `json:"file_size"`
	CreatedBy   string    `json:"created_by,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	ImageURL    string    `json:"image_url"`
}

// UserBadge is one user's hold on a badge, with the date it was awarded.
type UserBadge struct {
	BadgeID    string    `json:"badge_id"`
	AssignedAt time.Time `json:"assigned_at"`
	// Displayed marks the one badge shown next to the nickname (user-chosen).
	// With none displayed, clients fall back to the newest award.
	Displayed bool `json:"displayed"`
}

// BadgeAssignments is every user's badges, keyed by user id. Dates are part of
// the payload because the UI shows when a badge was awarded.
type BadgeAssignments map[string][]UserBadge

// UpdateBadgeRequest is the admin edit payload. Nil fields are left unchanged.
type UpdateBadgeRequest struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
}

// SetUserBadgesRequest replaces a user's whole badge set.
type SetUserBadgesRequest struct {
	BadgeIDs []string `json:"badge_ids"`
}

// SetDisplayedBadgeRequest pins one of the caller's badges next to their name.
// An empty badge_id goes back to "newest award".
type SetDisplayedBadgeRequest struct {
	BadgeID string `json:"badge_id"`
}
