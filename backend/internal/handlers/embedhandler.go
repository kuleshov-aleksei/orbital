package handlers

import (
	"net/http"

	"github.com/gorilla/mux"

	"github.com/kuleshov-aleksei/orbital/internal/service/linkpreview"
)

// EmbedImage serves a link preview thumbnail (docs/specs/CHAT_SYSTEM.md
// §7.15). Public because <img> cannot send Authorization headers; ids are
// 128-bit random. The image never changes, so it is cached forever.
// GET /api/embeds/{id}/image
func EmbedImage(previews *linkpreview.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		data, err := previews.Image(r.Context(), mux.Vars(r)["id"])
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "image/webp")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		_, _ = w.Write(data)
	}
}
