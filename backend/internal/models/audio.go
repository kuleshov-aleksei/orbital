package models

import "time"

type AudioFile struct {
	ID          string    `json:"id"`
	Filename    string    `json:"filename"`
	DisplayName string    `json:"display_name"`
	UploadedBy  string    `json:"uploaded_by,omitempty"`
	FileSize    int64     `json:"file_size"`
	Duration    float64   `json:"duration,omitempty"`
	IsSystem    bool      `json:"is_system"`
	CreatedAt   time.Time `json:"created_at"`
}

type AudioUploadResponse struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	AudioURL    string `json:"audio_url"`
}
