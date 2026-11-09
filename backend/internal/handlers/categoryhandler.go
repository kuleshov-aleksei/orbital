package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service"
	"github.com/kuleshov-aleksei/orbital/internal/websocket"
)

// CategoryHandler handles category-related HTTP requests
type CategoryHandler struct {
	categoryService *service.CategoryService
	roomService     *service.RoomService
	livekitService  *service.LiveKitService
	permissions     *service.PermissionService
	wsHub           *websocket.Hub
}

// NewCategoryHandler creates a new CategoryHandler
func NewCategoryHandler(categoryService *service.CategoryService, roomService *service.RoomService, livekitService *service.LiveKitService, permissionService *service.PermissionService, wsHub *websocket.Hub) *CategoryHandler {
	return &CategoryHandler{
		categoryService: categoryService,
		roomService:     roomService,
		livekitService:  livekitService,
		permissions:     permissionService,
		wsHub:           wsHub,
	}
}

// GetCategories handles GET /api/categories
func (h *CategoryHandler) GetCategories(w http.ResponseWriter, r *http.Request) {
	sub, ok := subjectFromRequest(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Hide categories without any visible room unless the user can manage them.
	categories := make([]models.Category, 0)
	for _, c := range h.categoryService.GetCategories() {
		if h.permissions.CanSeeCategory(sub, c.ID) {
			categories = append(categories, c)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, categories)
}

// CreateCategory handles POST /api/categories
func (h *CategoryHandler) CreateCategory(w http.ResponseWriter, r *http.Request) {
	var req models.CreateCategoryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	category, err := h.categoryService.CreateCategory(req.Name)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Broadcast category creation to all connected clients
	if h.wsHub != nil {
		categoryCreatedMessage := map[string]interface{}{
			"type": "category_created",
			"data": category,
		}
		h.wsHub.BroadcastToAll(categoryCreatedMessage)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, category)
}

// RenameCategory handles PUT /api/categories/:id
func (h *CategoryHandler) RenameCategory(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	categoryID := vars["id"]

	if _, ok := requireCategoryPerm(w, r, h.permissions, categoryID, permissions.ManageRooms); !ok {
		return
	}

	var req models.RenameCategoryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	category, err := h.categoryService.RenameCategory(categoryID, req.Name)
	if err != nil {
		if err.Error() == "category not found" {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Broadcast category rename to all connected clients
	if h.wsHub != nil {
		categoryRenamedMessage := map[string]interface{}{
			"type": "category_renamed",
			"data": category,
		}
		h.wsHub.BroadcastToAll(categoryRenamedMessage)
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, category)
}

// DeleteCategory handles DELETE /api/categories/:id
func (h *CategoryHandler) DeleteCategory(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	categoryID := vars["id"]

	if _, ok := requireCategoryPerm(w, r, h.permissions, categoryID, permissions.ManageRooms); !ok {
		return
	}

	var req models.DeleteCategoryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		// If no body provided, use defaults (migrate to general)
		req.DeleteRooms = false
		req.TargetCategoryID = ""
	}

	targetCategoryID, err := h.categoryService.DeleteCategory(categoryID, req.DeleteRooms, req.TargetCategoryID)
	if err != nil {
		switch err.Error() {
		case "category not found":
			http.Error(w, err.Error(), http.StatusNotFound)
		case "cannot delete the default 'general' category":
			http.Error(w, err.Error(), http.StatusForbidden)
		case "target category not found":
			http.Error(w, err.Error(), http.StatusBadRequest)
		case "cannot migrate rooms to the category being deleted":
			http.Error(w, err.Error(), http.StatusBadRequest)
		default:
			http.Error(w, err.Error(), http.StatusBadRequest)
		}
		return
	}

	// Handle room migration or deletion
	var migratedRooms []string
	if !req.DeleteRooms && targetCategoryID != "" {
		// Migrate rooms to target category
		rooms := h.roomService.GetRoomsByCategory(categoryID)
		for _, room := range rooms {
			err := h.roomService.UpdateRoomCategory(room.ID, targetCategoryID)
			if err == nil {
				migratedRooms = append(migratedRooms, room.ID)
				// Broadcast room update to clients that can see it
				if h.wsHub != nil {
					roomUpdateMessage := map[string]interface{}{
						"type": "room_updated",
						"data": room,
					}
					h.wsHub.BroadcastRoomScoped(room.ID, roomUpdateMessage)
				}
			}
		}
	} else if req.DeleteRooms {
		// Delete all rooms in the category
		rooms := h.roomService.GetRoomsByCategory(categoryID)
		for _, room := range rooms {
			// Leave all users from the room first
			roomUsers := h.roomService.GetRoomUsers(room.ID)
			for _, user := range roomUsers {
				h.roomService.LeaveRoom(room.ID, user.ID)
			}
			// Delete the room
			if err := h.roomService.DeleteRoom(room.ID); err != nil {
				log.Printf("Failed to delete room %s: %v", room.ID, err)
				continue
			}
			h.permissions.ForgetTarget(models.OverwriteTargetRoom, room.ID)
			if h.livekitService != nil {
				if err := h.livekitService.DeleteRoom(room.ID); err != nil {
					log.Printf("Failed to delete LiveKit room %s: %v", room.ID, err)
				}
			}
			// Broadcast room deletion to all clients
			if h.wsHub != nil {
				roomDeletedMessage := map[string]interface{}{
					"type": "room_deleted",
					"data": map[string]string{
						"room_id": room.ID,
					},
				}
				h.wsHub.BroadcastToAll(roomDeletedMessage)
			}
		}
	}

	h.permissions.ForgetTarget(models.OverwriteTargetCategory, categoryID)
	// Migrated (synced) rooms now inherit the target category's overwrites.
	h.permissions.Notify("category_deleted")

	// Broadcast category deletion to all connected clients
	if h.wsHub != nil {
		categoryDeletedMessage := map[string]interface{}{
			"type": "category_deleted",
			"data": map[string]interface{}{
				"category_id":        categoryID,
				"deleted_rooms":      req.DeleteRooms,
				"migrated_rooms":     migratedRooms,
				"target_category_id": targetCategoryID,
			},
		}
		h.wsHub.BroadcastToAll(categoryDeletedMessage)
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]string{
		"status": "success",
	})
}

// UpdateCategoryOrder handles PUT /api/categories/reorder
func (h *CategoryHandler) UpdateCategoryOrder(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Orders map[string]int `json:"orders"` // category_id -> sort_order
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate request
	if len(req.Orders) == 0 {
		http.Error(w, "No category orders provided", http.StatusBadRequest)
		return
	}

	if err := h.categoryService.UpdateCategorySortOrder(req.Orders); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Broadcast category order update to all connected clients
	if h.wsHub != nil {
		categoryOrderUpdatedMessage := map[string]interface{}{
			"type": "category_order_updated",
			"data": map[string]interface{}{
				"orders": req.Orders,
			},
		}
		h.wsHub.BroadcastToAll(categoryOrderUpdatedMessage)
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]string{"status": "success"})
}
