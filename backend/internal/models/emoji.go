package models

import "time"

// CustomEmoji is an uploaded image emoji, referenced as "custom:<id>".
type CustomEmoji struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Aliases    []string  `json:"aliases"`
	Filename   string    `json:"-"`
	FileSize   int64     `json:"file_size"`
	UploadedBy string    `json:"uploaded_by,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
	ImageURL   string    `json:"image_url"`
	// Animated emojis also serve a still first frame at
	// image_url + "&still=1", used by the reduce-motion setting.
	Animated bool `json:"animated"`
}

// UpdateCustomEmojiRequest is the admin edit payload. Nil fields are left unchanged.
type UpdateCustomEmojiRequest struct {
	Name    *string   `json:"name"`
	Aliases *[]string `json:"aliases"`
}
