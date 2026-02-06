package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/service"
	"github.com/kuleshov-aleksei/orbital/internal/websocket"
)

// CategoryHandler handles category-related HTTP requests
type CategoryHandler struct {
	categoryService *service.CategoryService
	roomService     *service.RoomService
	wsHub           *websocket.Hub
}

// NewCategoryHandler creates a new CategoryHandler
func NewCategoryHandler(categoryService *service.CategoryService, roomService *service.RoomService, wsHub *websocket.Hub) *CategoryHandler {
	return &CategoryHandler{
		categoryService: categoryService,
		roomService:     roomService,
		wsHub:           wsHub,
	}
}

// GetCategories handles GET /api/categories
func (h *CategoryHandler) GetCategories(w http.ResponseWriter, r *http.Request) {
	categories := h.categoryService.GetCategories()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(categories)
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
	json.NewEncoder(w).Encode(category)
}

// RenameCategory handles PUT /api/categories/:id
func (h *CategoryHandler) RenameCategory(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	categoryID := vars["id"]

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
	json.NewEncoder(w).Encode(category)
}

// DeleteCategory handles DELETE /api/categories/:id
func (h *CategoryHandler) DeleteCategory(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	categoryID := vars["id"]

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
	var deletedRoomIDs []string
	if !req.DeleteRooms && targetCategoryID != "" {
		// Migrate rooms to target category
		rooms := h.roomService.GetRoomsByCategory(categoryID)
		for _, room := range rooms {
			err := h.roomService.UpdateRoomCategory(room.ID, targetCategoryID)
			if err == nil {
				migratedRooms = append(migratedRooms, room.ID)
				// Broadcast room update to all clients
				if h.wsHub != nil {
					roomUpdateMessage := map[string]interface{}{
						"type": "room_updated",
						"data": room,
					}
					h.wsHub.BroadcastToAll(roomUpdateMessage)
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
			h.roomService.DeleteRoom(room.ID)
			deletedRoomIDs = append(deletedRoomIDs, room.ID)
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
	json.NewEncoder(w).Encode(map[string]string{
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
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}
