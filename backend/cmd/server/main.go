package main

import (
	"encoding/json"
	"flag"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/mux"
	"github.com/joho/godotenv"
	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/handlers"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/service"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
	"github.com/kuleshov-aleksei/orbital/internal/version"
	"github.com/kuleshov-aleksei/orbital/internal/websocket"
)

func main() {
	// Load .env file if it exists (doesn't error if not found)
	if err := godotenv.Load(".env"); err != nil {
		log.Printf("Note: .env file not loaded: %v", err)
	}

	// Parse command-line flags
	configPath := flag.String("config", "configs/config.yaml", "Path to configuration file")
	flag.Parse()

	// Load configuration
	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	// Validate configuration
	if err := cfg.Validate(); err != nil {
		log.Fatalf("Invalid configuration: %v", err)
	}

	// Initialize legacy room config for backward compatibility
	config.InitializeRoomConfig(cfg)

	// Log configuration (without sensitive data)
	log.Printf("Configuration loaded: %s", cfg.String())
	log.Printf("Server starting in %s mode on port %s", cfg.Server.Mode, cfg.Server.Port)

	// Initialize database
	var categoryService *service.CategoryService
	var roomService *service.RoomService
	var userRepo *repository.UserRepository
	var debugLogService *service.DebugLogService

	if cfg.Database.Path != "" {
		db, err := storage.NewDB(cfg.Database.Path)
		if err != nil {
			log.Fatalf("Failed to initialize database: %v", err)
		}
		defer db.Close()

		// Run migrations
		if err := db.RunMigrations(); err != nil {
			log.Fatalf("Failed to run database migrations: %v", err)
		}

		// Create repositories
		categoryRepo := repository.NewCategoryRepository(db)
		roomRepo := repository.NewRoomRepository(db)
		userRepo = repository.NewUserRepository(db)
		debugLogRepo := repository.NewDebugLogRepository(db)

		// Initialize services with repositories
		categoryService = service.NewCategoryService(categoryRepo)
		roomService = service.NewRoomService(roomRepo, userRepo)
		debugLogService = service.NewDebugLogService(debugLogRepo, "data")

		// Load data from database
		if err := categoryService.LoadFromDB(); err != nil {
			log.Fatalf("Failed to load categories from database: %v", err)
		}
		if err := roomService.LoadFromDB(); err != nil {
			log.Fatalf("Failed to load rooms from database: %v", err)
		}
	} else {
		// Initialize services without database (memory-only mode)
		log.Println("Warning: No database path configured, running in memory-only mode")
		categoryService = service.NewCategoryService(nil)
		roomService = service.NewRoomService(nil, nil)

		// Create default "general" category in memory
		if err := categoryService.LoadFromDB(); err != nil {
			log.Fatalf("Failed to initialize categories: %v", err)
		}
	}

	roomService.SetCategoryService(categoryService)

	// Initialize auth service and role service
	authService := service.NewAuthService(cfg.GetAuthConfig(), userRepo)
	roleService := service.NewRoleService(userRepo)

	// Initialize LiveKit service
	var livekitService *service.LiveKitService
	if cfg.LiveKit.IsConfigured() {
		livekitService, err = service.NewLiveKitService(cfg.GetLiveKitConfig())
		if err != nil {
			log.Printf("Warning: Failed to initialize LiveKit service: %v", err)
			log.Println("LiveKit features will be disabled")
		} else {
			log.Println("LiveKit service initialized successfully")
		}
	} else {
		log.Println("LiveKit is not configured, LiveKit features will be disabled")
	}

	wsHub := websocket.NewHub(roomService, authService, livekitService, cfg)

	// Initialize avatar service
	avatarService := service.NewAvatarService("data")

	// Initialize handlers with config
	roomHandler := handlers.NewRoomHandler(roomService, categoryService, livekitService, wsHub)
	categoryHandler := handlers.NewCategoryHandler(categoryService, roomService, wsHub)
	authHandler := handlers.NewAuthHandler(authService, roleService, cfg.Server.ExternalURL, cfg.Server.ElectronRedirectURL)
	adminHandler := handlers.NewAdminHandlerWithDebugLog(roleService, userRepo, debugLogService)
	usersHandler := handlers.NewUsersHandler(userRepo, wsHub)
	livekitHandler := handlers.NewLiveKitHandler(livekitService)
	avatarHandler := handlers.NewAvatarHandler(avatarService, userRepo)

	// Setup router
	r := mux.NewRouter()

	// Add request logging middleware if enabled
	if cfg.ShouldLogRequests() {
		r.Use(requestLoggingMiddleware)
	}

	// API routes
	r.HandleFunc("/api/health", healthHandler).Methods("GET")
	r.HandleFunc("/api/version", versionHandler).Methods("GET")

	// Auth routes
	r.HandleFunc("/api/auth/discord/login", authHandler.DiscordLogin).Methods("GET")
	r.HandleFunc("/api/auth/discord/callback", authHandler.DiscordCallback).Methods("GET")
	r.HandleFunc("/api/auth/discord/url", authHandler.GetOAuthUrl).Methods("GET")
	r.HandleFunc("/api/auth/google/login", authHandler.GoogleLogin).Methods("GET")
	r.HandleFunc("/api/auth/google/callback", authHandler.GoogleCallback).Methods("GET")
	r.HandleFunc("/api/auth/google/url", authHandler.GetOAuthUrl).Methods("GET")
	r.HandleFunc("/api/auth/guest", authHandler.GuestLogin).Methods("POST")
	r.HandleFunc("/api/auth/logout", authHandler.Logout).Methods("POST")
	r.Handle("/api/auth/me", authHandler.AuthMiddleware(http.HandlerFunc(authHandler.GetCurrentUser))).Methods("GET")
	r.HandleFunc("/api/auth/status", authHandler.GetAuthStatus).Methods("GET")
	r.HandleFunc("/api/auth/register", authHandler.Register).Methods("POST")
	r.HandleFunc("/api/auth/login", authHandler.LoginPassword).Methods("POST")

	// Users route (public)
	r.HandleFunc("/api/users", usersHandler.GetAllUsers).Methods("GET")

	// Avatar routes (public for serving, protected for upload)
	r.HandleFunc("/api/avatars/{guid}", avatarHandler.GetAvatar).Methods("GET")
	r.Handle("/api/users/me/avatar", authHandler.AuthMiddleware(http.HandlerFunc(avatarHandler.UploadAvatar))).Methods("POST")

	// Sound pack routes (protected)
	r.Handle("/api/users/me/sound-pack", authHandler.AuthMiddleware(http.HandlerFunc(usersHandler.UpdateSoundPack))).Methods("PATCH")

	// General configuration route (public)
	r.HandleFunc("/api/config", roomHandler.GetConfig).Methods("GET")

	// LiveKit routes (protected)
	r.Handle("/api/livekit/token", authHandler.AuthMiddleware(http.HandlerFunc(livekitHandler.GenerateToken))).Methods("POST")
	r.HandleFunc("/api/livekit/health", livekitHandler.HealthCheck).Methods("GET")

	// Public room routes (no auth required)
	r.HandleFunc("/api/rooms", roomHandler.GetRooms).Methods("GET")
	r.HandleFunc("/api/rooms/{id}", roomHandler.GetRoom).Methods("GET")
	r.HandleFunc("/api/rooms/{id}/users", roomHandler.GetRoomUsers).Methods("GET")
	r.HandleFunc("/api/rooms/{id}/join", roomHandler.JoinRoom).Methods("POST")
	r.HandleFunc("/api/rooms/{id}/leave", roomHandler.LeaveRoom).Methods("POST")

	// Admin-only room routes
	adminRoomRouter := r.PathPrefix("/api").Subrouter()
	adminRoomRouter.Use(authHandler.AuthMiddleware)
	adminRoomRouter.Use(authHandler.RequireAdmin)
	adminRoomRouter.HandleFunc("/rooms", roomHandler.CreateRoom).Methods("POST")
	adminRoomRouter.HandleFunc("/rooms/order", roomHandler.UpdateRoomOrder).Methods("PUT")
	adminRoomRouter.HandleFunc("/rooms/{id}", roomHandler.UpdateRoom).Methods("PUT")
	adminRoomRouter.HandleFunc("/rooms/{id}", roomHandler.DeleteRoom).Methods("DELETE")
	adminRoomRouter.HandleFunc("/rooms/{room_id}/kick/{user_id}", roomHandler.KickUser).Methods("POST")

	// Public category routes
	r.HandleFunc("/api/categories", categoryHandler.GetCategories).Methods("GET")

	// Admin-only category routes
	adminCategoryRouter := r.PathPrefix("/api").Subrouter()
	adminCategoryRouter.Use(authHandler.AuthMiddleware)
	adminCategoryRouter.Use(authHandler.RequireAdmin)
	adminCategoryRouter.HandleFunc("/categories", categoryHandler.CreateCategory).Methods("POST")
	adminCategoryRouter.HandleFunc("/categories/reorder", categoryHandler.UpdateCategoryOrder).Methods("PUT")
	adminCategoryRouter.HandleFunc("/categories/{id}", categoryHandler.RenameCategory).Methods("PUT")
	adminCategoryRouter.HandleFunc("/categories/{id}", categoryHandler.DeleteCategory).Methods("DELETE")

	// Admin management routes (super_admin only)
	superAdminRouter := r.PathPrefix("/api/admin").Subrouter()
	superAdminRouter.Use(authHandler.AuthMiddleware)
	superAdminRouter.Use(authHandler.RequireSuperAdmin)
	superAdminRouter.HandleFunc("/users", adminHandler.ListUsers).Methods("GET")
	superAdminRouter.HandleFunc("/users/guests", adminHandler.DeleteAllGuests).Methods("DELETE")
	superAdminRouter.HandleFunc("/users/{id}/role", adminHandler.GetUserRole).Methods("GET")
	superAdminRouter.HandleFunc("/users/{id}/promote", adminHandler.PromoteUser).Methods("POST")
	superAdminRouter.HandleFunc("/users/{id}/demote", adminHandler.DemoteUser).Methods("POST")
	superAdminRouter.HandleFunc("/users/{id}", adminHandler.DeleteUser).Methods("DELETE")
	superAdminRouter.HandleFunc("/logs", adminHandler.ListDebugLogs).Methods("GET")
	superAdminRouter.HandleFunc("/logs/{id}", adminHandler.GetDebugLog).Methods("GET")
	superAdminRouter.HandleFunc("/logs/{id}", adminHandler.DeleteDebugLog).Methods("DELETE")

	// Debug log upload route (authenticated users)
	r.Handle("/api/logs", authHandler.AuthMiddleware(http.HandlerFunc(adminHandler.UploadDebugLog))).Methods("POST")

	// Test-only routes (guarded to avoid accidental use).
	// Allowed when either ORBITAL_E2E=1 is set OR the request explicitly opts in.
	r.HandleFunc("/api/test/reset", func(w http.ResponseWriter, r *http.Request) {
		if !cfg.IsE2EMode() && r.Header.Get("X-Orbital-E2E") != "1" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		roomService.Reset()
		categoryService.Reset()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}).Methods("POST")

	// WebSocket routes
	r.HandleFunc("/ws/{roomId}", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		roomID := vars["roomId"]
		wsHub.HandleWebSocket(roomID, w, r)
	})

	// Global WebSocket endpoint for receiving broadcasts (like room creation)
	r.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		wsHub.HandleGlobalWebSocket(w, r)
	})

	// Setup CORS middleware with configured origins
	handler := corsMiddleware(r, cfg.GetCORSOrigins())

	// Start server
	addr := cfg.GetAddress()
	log.Printf("Server listening on %s", addr)

	server := &http.Server{
		Addr:         addr,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	log.Fatal(server.ListenAndServe())
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "ok",
		"service": "orbital-backend",
		"version": version.GetVersion(),
	})
}

func versionHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"version": version.GetVersion(),
	})
}

// corsMiddleware handles CORS headers with configurable origins
func corsMiddleware(next http.Handler, allowedOrigins []string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Determine which origin to allow
		origin := r.Header.Get("Origin")
		allowedOrigin := ""

		for _, o := range allowedOrigins {
			if o == "*" || o == origin {
				allowedOrigin = o
				break
			}
		}

		if allowedOrigin == "" && len(allowedOrigins) > 0 {
			allowedOrigin = allowedOrigins[0]
		}

		w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		// Handle preflight requests
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// requestLoggingMiddleware logs all HTTP requests
func requestLoggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		duration := time.Since(start)
		log.Printf("[%s] %s %s - %v", r.Method, r.URL.Path, r.RemoteAddr, duration)
	})
}
