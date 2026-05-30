package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/gorilla/mux"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

type AudioHandler struct {
	audioService *service.AudioService
}

func NewAudioHandler(audioService *service.AudioService) *AudioHandler {
	return &AudioHandler{
		audioService: audioService,
	}
}

func (h *AudioHandler) ListAudio(w http.ResponseWriter, r *http.Request) {
	files, err := h.audioService.GetAllAudio()
	if err != nil {
		http.Error(w, "Failed to fetch audio files", http.StatusInternalServerError)
		return
	}

	if files == nil {
		files = []*models.AudioFile{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(files)
}

func (h *AudioHandler) UploadAudio(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value("user").(*models.JWTClaims)
	if !ok || claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if r.ContentLength > service.MaxAudioFileSize {
		http.Error(w, "File size exceeds 50MB limit", http.StatusRequestEntityTooLarge)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, service.MaxAudioFileSize)

	err := r.ParseMultipartForm(service.MaxAudioFileSize)
	if err != nil {
		http.Error(w, "Failed to parse multipart form", http.StatusBadRequest)
		return
	}

	file, _, err := r.FormFile("audio")
	if err != nil {
		http.Error(w, "No audio file provided", http.StatusBadRequest)
		return
	}
	defer file.Close()

	fileData, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "Failed to read file", http.StatusInternalServerError)
		return
	}

	displayName := r.FormValue("display_name")
	if displayName == "" {
		displayName = "Untitled"
	}

	result, err := h.audioService.UploadAudio(claims.UserID, fileData, displayName)
	if err != nil {
		switch err {
		case service.ErrAudioFileTooLarge:
			http.Error(w, err.Error(), http.StatusRequestEntityTooLarge)
		case service.ErrAudioInvalidFileType:
			http.Error(w, err.Error(), http.StatusBadRequest)
		default:
			http.Error(w, "Failed to process audio file", http.StatusInternalServerError)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(models.AudioUploadResponse{
		ID:          result.ID,
		DisplayName: result.DisplayName,
		AudioURL:    result.AudioURL,
	})
}

func (h *AudioHandler) GetAudio(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	if id == "" {
		http.Error(w, "Invalid audio ID", http.StatusBadRequest)
		return
	}

	filePath, err := h.audioService.GetAudioPath(id)
	if err != nil {
		if err == service.ErrAudioNotFound {
			http.Error(w, "Audio file not found", http.StatusNotFound)
		} else {
			http.Error(w, "Failed to retrieve audio file", http.StatusInternalServerError)
		}
		return
	}

	ext := strings.ToLower(filepath.Ext(filePath))
	contentType := mime.TypeByExtension(ext)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=31536000")
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=\"audio%s\"", ext))

	http.ServeFile(w, r, filePath)
}
