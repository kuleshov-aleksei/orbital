package main

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func main() {
	r := mux.NewRouter()

	// API routes
	r.HandleFunc("/api/health", healthHandler).Methods("GET")
	r.HandleFunc("/api/rooms", createRoomHandler).Methods("POST")
	r.HandleFunc("/api/rooms/{id}", getRoomHandler).Methods("GET")

	// WebSocket route
	r.HandleFunc("/ws/{roomId}", websocketHandler)

	log.Println("Server starting on :8080")
	log.Fatal(http.ListenAndServe(":8080", r))
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func createRoomHandler(w http.ResponseWriter, r *http.Request) {
	// TODO: Implement room creation
	w.WriteHeader(http.StatusNotImplemented)
}

func getRoomHandler(w http.ResponseWriter, r *http.Request) {
	// TODO: Implement room retrieval
	w.WriteHeader(http.StatusNotImplemented)
}

func websocketHandler(w http.ResponseWriter, r *http.Request) {
	// TODO: Implement WebSocket signaling
	w.WriteHeader(http.StatusNotImplemented)
}
