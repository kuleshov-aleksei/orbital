package main

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/orbital/internal/handlers"
	"github.com/orbital/internal/service"
	"github.com/orbital/internal/websocket"
)

func main() {
	// Initialize services
	roomService := service.NewRoomService()
	wsHub := websocket.NewHub(roomService)

	// Initialize handlers
	roomHandler := handlers.NewRoomHandler(roomService)

	// Setup router
	r := mux.NewRouter()

	// CORS middleware
	r.Use(corsMiddleware)

	// API routes
	r.HandleFunc("/api/health", healthHandler).Methods("GET")
	r.HandleFunc("/api/rooms", roomHandler.CreateRoom).Methods("POST")
	r.HandleFunc("/api/rooms", roomHandler.GetRooms).Methods("GET")
	r.HandleFunc("/api/rooms/{id}", roomHandler.GetRoom).Methods("GET")
	r.HandleFunc("/api/rooms/{id}/users", roomHandler.GetRoomUsers).Methods("GET")
	r.HandleFunc("/api/rooms/{id}/join", roomHandler.JoinRoom).Methods("POST")
	r.HandleFunc("/api/rooms/{id}/leave", roomHandler.LeaveRoom).Methods("POST")

	// WebSocket route
	r.HandleFunc("/ws/{roomId}", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		roomID := vars["roomId"]
		wsHub.HandleWebSocket(roomID, w, r)
	})

	log.Println("Server starting on :8080")
	log.Fatal(http.ListenAndServe(":8080", r))
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "ok",
		"service": "orbital-backend",
		"version": "1.0.0",
	})
}

// corsMiddleware handles CORS headers
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}
