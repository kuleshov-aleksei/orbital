package handlers

import (
	"encoding/json"
	"log"
	"net/http"
)

// writeJSON encodes v as the response body, logging encode failures since the
// response headers have usually already been written by the caller.
func writeJSON(w http.ResponseWriter, v interface{}) {
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("Failed to encode JSON response: %v", err)
	}
}
