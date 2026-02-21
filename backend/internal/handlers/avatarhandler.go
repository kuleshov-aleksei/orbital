package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

type AvatarHandler struct {
	avatarService *service.AvatarService
	userRepo      *repository.UserRepository
}

func NewAvatarHandler(avatarService *service.AvatarService, userRepo *repository.UserRepository) *AvatarHandler {
	return &AvatarHandler{
		avatarService: avatarService,
		userRepo:      userRepo,
	}
}

type AvatarUploadResponse struct {
	AvatarURL string `json:"avatar_url"`
}

func (h *AvatarHandler) UploadAvatar(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value("user").(*models.JWTClaims)
	if !ok || claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if claims.IsGuest {
		http.Error(w, "Guests cannot upload avatars", http.StatusForbidden)
		return
	}

	if r.ContentLength > service.MaxAvatarSize {
		http.Error(w, "File size exceeds 5MB limit", http.StatusRequestEntityTooLarge)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, service.MaxAvatarSize)

	err := r.ParseMultipartForm(service.MaxAvatarSize)
	if err != nil {
		http.Error(w, "Failed to parse multipart form", http.StatusBadRequest)
		return
	}

	file, _, err := r.FormFile("avatar")
	if err != nil {
		http.Error(w, "No avatar file provided", http.StatusBadRequest)
		return
	}
	defer file.Close()

	fileData, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "Failed to read file", http.StatusInternalServerError)
		return
	}

	user, err := h.userRepo.GetByID(claims.UserID)
	if err != nil || user == nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	result, err := h.avatarService.UploadAvatar(claims.UserID, fileData, user.AvatarURL)
	if err != nil {
		switch err {
		case service.ErrFileTooLarge:
			http.Error(w, err.Error(), http.StatusRequestEntityTooLarge)
		case service.ErrInvalidFileType, service.ErrInvalidImageData:
			http.Error(w, err.Error(), http.StatusBadRequest)
		default:
			http.Error(w, "Failed to process avatar", http.StatusInternalServerError)
		}
		return
	}

	if err := h.userRepo.UpdateAvatarURL(claims.UserID, result.AvatarURL); err != nil {
		http.Error(w, "Failed to update avatar URL", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AvatarUploadResponse{
		AvatarURL: result.AvatarURL,
	})
}

func (h *AvatarHandler) GetAvatar(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	guid := vars["guid"]

	if guid == "" {
		http.Error(w, "Invalid avatar ID", http.StatusBadRequest)
		return
	}

	filePath, err := h.avatarService.GetAvatarPath(guid)
	if err != nil {
		http.Error(w, "Avatar not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "public, max-age=31536000")
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=\"%s.jpg\"", guid))

	http.ServeFile(w, r, filePath)
}
