package models

import "time"

// SoundboardSound is a short clip in the shared soundboard library.
type SoundboardSound struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Emoji      string    `json:"emoji"`
	Aliases    []string  `json:"aliases"`
	Filename   string    `json:"-"`
	Format     string    `json:"format"` // "mp3" or "ogg", used by Howler since the URL has no extension
	FileSize   int64     `json:"file_size"`
	UploadedBy string    `json:"uploaded_by,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
	AudioURL   string    `json:"audio_url"`
}

// UpdateSoundboardSoundRequest is the admin edit payload. Nil fields are left unchanged.
type UpdateSoundboardSoundRequest struct {
	Name    *string   `json:"name"`
	Emoji   *string   `json:"emoji"`
	Aliases *[]string `json:"aliases"`
}

// PlaySoundRequest is the WebSocket "play_sound" payload.
type PlaySoundRequest struct {
	SoundID string `json:"sound_id"`
}
