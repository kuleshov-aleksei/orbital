package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/mux"
	"github.com/joho/godotenv"
	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/handlers"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/ratelimit"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/service"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatmedia"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
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
	for _, origin := range cfg.GetCORSOrigins() {
		if origin == "*" {
			log.Printf("WARNING: CORS/WebSocket origins allow every origin; set SERVER_CORS_ORIGINS in production")
			break
		}
	}

	// Initialize database
	var categoryService *service.CategoryService
	var roomService *service.RoomService
	var userRepo *repository.UserRepository
	var debugLogService *service.DebugLogService
	var audioService *service.AudioService
	var soundboardService *service.SoundboardService
	var emojiService *service.EmojiService
	var sessionRepo *repository.SessionRepository
	var qrLoginRepo *repository.QRLoginRepository
	var analyticsService *service.AnalyticsService
	var halloweenService *service.HalloweenService
	var pumpkinAssetService *service.PumpkinAssetService
	var rbacRepo *repository.RBACRepository
	var textReadState chatstore.ReadStateStore
	var textNotify chatstore.NotifyStore
	var appDB *storage.DB

	if cfg.Database.Path != "" {
		db, err := storage.NewDB(cfg.Database.Path)
		if err != nil {
			log.Fatalf("Failed to initialize database: %v", err)
		}
		defer func() { _ = db.Close() }()
		appDB = db

		// Run migrations
		if err := db.RunMigrations(); err != nil {
			log.Fatalf("Failed to run database migrations: %v", err)
		}

		// Create repositories
		categoryRepo := repository.NewCategoryRepository(db)
		roomRepo := repository.NewRoomRepository(db)
		userRepo = repository.NewUserRepository(db)
		debugLogRepo := repository.NewDebugLogRepository(db)
		sessionRepo = repository.NewSessionRepository(db)
		qrLoginRepo = repository.NewQRLoginRepository(db)
		rbacRepo = repository.NewRBACRepository(db)
		textReadState = repository.NewTextReadStateRepository(db)
		textNotify = repository.NewTextNotifyRepository(db)

		// Initialize services with repositories
		categoryService = service.NewCategoryService(categoryRepo)
		roomService = service.NewRoomService(roomRepo, userRepo)
		debugLogService = service.NewDebugLogService(debugLogRepo, "data", cfg.RateLimit.DebugLogQuotaBytes())
		if err := debugLogService.BackfillFileSizes(); err != nil {
			log.Printf("Warning: Failed to backfill debug log sizes: %v", err)
		}
		audioService = service.NewAudioService(repository.NewAudioRepository(db), "data", cfg.RateLimit.AudioQuotaBytes())
		soundboardService = service.NewSoundboardService(repository.NewSoundboardRepository(db), "data")
		emojiService = service.NewEmojiService(repository.NewEmojiRepository(db), "data")
		analyticsService = service.NewAnalyticsService(sessionRepo)
		halloweenService = service.NewHalloweenService(repository.NewHalloweenRepository(db))
		pumpkinAssetService = service.NewPumpkinAssetService("data", "assets")

		// Load data from database
		if err := categoryService.LoadFromDB(); err != nil {
			log.Fatalf("Failed to load categories from database: %v", err)
		}
		if err := roomService.LoadFromDB(); err != nil {
			log.Fatalf("Failed to load rooms from database: %v", err)
		}

		// Seed pumpkin art into the data dir (never overwrites uploads).
		if catalog, err := halloweenService.GetAdminCatalog(); err != nil {
			log.Printf("Warning: Failed to load halloween catalog for art seeding: %v", err)
		} else if seeded, err := pumpkinAssetService.SeedPlaceholders(catalog); err != nil {
			log.Printf("Warning: Failed to seed pumpkin art: %v", err)
		} else if seeded > 0 {
			log.Printf("Seeded %d pumpkin art files", seeded)
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

	// RBAC: roles, assignments and permission overwrites
	userLookup := func(userID string) *models.User {
		if userRepo != nil {
			user, err := userRepo.GetByID(userID)
			if err != nil {
				log.Printf("permission lookup for user %s failed: %v", userID, err)
				return nil
			}
			return user
		}
		user, _ := roomService.GetUserByID(userID)
		return user
	}
	permissionService := service.NewPermissionService(rbacRepo, roomService, categoryService, userLookup)
	if err := permissionService.LoadFromDB(); err != nil {
		log.Fatalf("Failed to load permissions: %v", err)
	}

	// Initialize auth service and role service
	authService := service.NewAuthService(cfg.GetAuthConfig(), userRepo)
	roleService := service.NewRoleService(userRepo)

	// QR device linking needs the database; it stays disabled in memory-only mode
	var qrLoginService *service.QRLoginService
	var qrLoginHandler *handlers.QRLoginHandler
	if qrLoginRepo != nil {
		qrLoginService = service.NewQRLoginService(qrLoginRepo, authService)
		qrLoginHandler = handlers.NewQRLoginHandler(
			qrLoginService,
			cfg.RateLimit.QRChallengePerMinute,
			cfg.RateLimit.QRApprovePerMinute,
		)
	}

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

	wsHub := websocket.NewHub(roomService, authService, livekitService, service.NewChatService(), sessionRepo, cfg)
	wsHub.SetPermissionService(permissionService)
	// Apply permission changes live (kick, LiveKit grants, client refresh).
	permissionService.Subscribe(wsHub.OnPermissionsChanged)
	if soundboardService != nil {
		wsHub.SetSoundboard(soundboardService)
	}

	// Text channels: messages live in Meilisearch (docs/specs/CHAT_SYSTEM.md).
	var textChat *websocket.TextChat
	if cfg.Chat.TextChannelsEnabled() {
		if textReadState == nil {
			textReadState = chatstore.NewMemoryReadState()
		}
		store := chatstore.New(chatstore.NewMeili(cfg.Chat.MeiliURL, cfg.Chat.MeiliAPIKey, cfg.Chat.MeiliIndex), chatstore.Options{})
		store.Start(context.Background(), func() []string {
			var ids []string
			for _, room := range roomService.GetRooms() {
				if room.IsText() {
					ids = append(ids, room.ID)
				}
			}
			return ids
		})
		textChat = &websocket.TextChat{
			Store: store, ReadState: textReadState, Notify: textNotify,
			UserExists: func(id string) bool { return userLookup(id) != nil },
			Media:      newChatMedia(cfg, appDB),
		}
		wsHub.SetTextChat(textChat)
		wsHub.StartMuteExpiry(context.Background())
		log.Printf("Text channels enabled (Meilisearch at %s, index %s)", cfg.Chat.MeiliURL, cfg.Chat.MeiliIndex)
	} else {
		log.Println("MEILI_URL is not set, text channels are disabled")
	}

	// Initialize avatar service
	avatarService := service.NewAvatarService("data")

	// Initialize handlers with config
	roomHandler := handlers.NewRoomHandler(roomService, categoryService, livekitService, permissionService, wsHub)
	if textChat != nil {
		roomHandler.SetTextChat(textChat)
	}
	categoryHandler := handlers.NewCategoryHandler(categoryService, roomService, livekitService, permissionService, wsHub)
	authHandler := handlers.NewAuthHandler(authService, roleService, cfg.Server.ExternalURL, cfg.Server.ElectronRedirectURL)
	adminHandler := handlers.NewAdminHandlerWithHub(roleService, userRepo, debugLogService, analyticsService, halloweenService, wsHub)
	adminHandler.SetPermissionService(permissionService)
	securityHandler := handlers.NewSecurityHandler(cfg)
	usersHandler := handlers.NewUsersHandler(userRepo, wsHub)
	usersHandler.SetPermissionService(permissionService)
	livekitHandler := handlers.NewLiveKitHandler(livekitService, roomService, permissionService)
	rbacHandler := handlers.NewRBACHandler(permissionService)
	rbacHandler.SetBroadcaster(wsHub.BroadcastToAll)
	avatarHandler := handlers.NewAvatarHandler(avatarService, userRepo)
	releaseHandler := handlers.NewReleaseHandler(cfg.GetReleasesURL())

	var audioHandler *handlers.AudioHandler
	if audioService != nil {
		audioHandler = handlers.NewAudioHandler(audioService)
	}

	var soundboardHandler *handlers.SoundboardHandler
	if soundboardService != nil {
		soundboardHandler = handlers.NewSoundboardHandler(soundboardService, permissionService, wsHub)
	}

	var emojiHandler *handlers.EmojiHandler
	if emojiService != nil {
		emojiHandler = handlers.NewEmojiHandler(emojiService, permissionService, wsHub)
		// One-time conversion of emojis stored before WebP. Their image_url
		// changes, so tell connected clients to refetch the library.
		go func() {
			if emojiService.MigrateToWebP() > 0 {
				wsHub.BroadcastCustomEmojisUpdated()
			}
		}()
		// Allow "custom:<id>" refs in statuses and soundboard clips.
		usersHandler.SetEmojiLookup(emojiService)
		if soundboardHandler != nil {
			soundboardHandler.SetEmojiLookup(emojiService)
		}
	}

	var halloweenHandler *handlers.HalloweenHandler
	if halloweenService != nil {
		halloweenHandler = handlers.NewHalloweenHandlerWithAssets(halloweenService, pumpkinAssetService, wsHub)
	}

	// Setup router
	r := mux.NewRouter()

	limiter := ratelimit.New()
	clientIPKey := func(r *http.Request) string {
		return ratelimit.ClientIP(r)
	}
	userOrIPKey := func(r *http.Request) string {
		if userID := handlers.UserIDFromContext(r.Context()); userID != "" {
			return "user:" + userID
		}
		return "ip:" + ratelimit.ClientIP(r)
	}
	audioUploadLimit := func(r *http.Request) (int, time.Duration) {
		if handlers.IsGuestFromContext(r.Context()) {
			return cfg.RateLimit.GuestUploadPerHour, time.Hour
		}
		return cfg.RateLimit.UserUploadPerHour, time.Hour
	}
	withRateLimit := func(name string, max int, window time.Duration, key ratelimit.KeyFunc, next http.Handler) http.Handler {
		return limiter.Middleware(name, ratelimit.Every(max, window), key, next)
	}

	// Add request logging middleware if enabled
	if cfg.ShouldLogRequests() {
		r.Use(requestLoggingMiddleware)
	}

	// API routes
	r.HandleFunc("/api/health", healthHandler(textChat)).Methods("GET")
	r.HandleFunc("/api/version", versionHandler).Methods("GET")

	// Auth routes
	r.Handle("/api/auth/discord/login", withRateLimit("oauth-url", cfg.RateLimit.OAuthPerMinute, time.Minute, clientIPKey, http.HandlerFunc(authHandler.DiscordLogin))).Methods("GET")
	r.HandleFunc("/api/auth/discord/callback", authHandler.DiscordCallback).Methods("GET")
	r.Handle("/api/auth/discord/url", withRateLimit("oauth-url", cfg.RateLimit.OAuthPerMinute, time.Minute, clientIPKey, http.HandlerFunc(authHandler.GetOAuthUrl))).Methods("GET")
	r.HandleFunc("/api/auth/discord/electron/callback", authHandler.DiscordElectronCallback).Methods("GET")
	r.Handle("/api/auth/google/login", withRateLimit("oauth-url", cfg.RateLimit.OAuthPerMinute, time.Minute, clientIPKey, http.HandlerFunc(authHandler.GoogleLogin))).Methods("GET")
	r.HandleFunc("/api/auth/google/callback", authHandler.GoogleCallback).Methods("GET")
	r.Handle("/api/auth/google/url", withRateLimit("oauth-url", cfg.RateLimit.OAuthPerMinute, time.Minute, clientIPKey, http.HandlerFunc(authHandler.GetOAuthUrl))).Methods("GET")
	r.HandleFunc("/api/auth/google/electron/callback", authHandler.GoogleElectronCallback).Methods("GET")
	r.Handle("/api/auth/guest", withRateLimit("guest-login", cfg.RateLimit.GuestPerHour, time.Hour, clientIPKey, http.HandlerFunc(authHandler.GuestLogin))).Methods("POST")
	r.Handle("/api/auth/logout", authHandler.AuthMiddleware(http.HandlerFunc(authHandler.Logout))).Methods("POST")
	r.Handle("/api/auth/me", authHandler.AuthMiddleware(http.HandlerFunc(authHandler.GetCurrentUser))).Methods("GET")
	r.Handle("/api/auth/refresh", authHandler.AuthMiddleware(http.HandlerFunc(authHandler.RefreshToken))).Methods("POST")
	r.HandleFunc("/api/auth/status", authHandler.GetAuthStatus).Methods("GET")
	r.Handle("/api/auth/register", withRateLimit("auth-register", cfg.RateLimit.AuthPerMinute, time.Minute, clientIPKey, http.HandlerFunc(authHandler.Register))).Methods("POST")
	r.Handle("/api/auth/login", withRateLimit("auth-login", cfg.RateLimit.AuthPerMinute, time.Minute, clientIPKey, http.HandlerFunc(authHandler.LoginPassword))).Methods("POST")

	// QR device linking (single-use pairing; disabled without a database)
	if qrLoginHandler != nil {
		r.HandleFunc("/api/auth/qr/challenge", qrLoginHandler.CreateChallenge).Methods("POST")
		r.Handle("/api/auth/qr/challenge/{id}", authHandler.AuthMiddleware(http.HandlerFunc(qrLoginHandler.GetChallenge))).Methods("GET")
		r.Handle("/api/auth/qr/approve", authHandler.AuthMiddleware(http.HandlerFunc(qrLoginHandler.ApproveChallenge))).Methods("POST")
		r.HandleFunc("/api/auth/qr/claim", qrLoginHandler.ClaimChallenge).Methods("POST")
		go qrLoginService.StartCleanupLoop(time.Minute)
	}

	// Users route (public)
	r.HandleFunc("/api/users", usersHandler.GetAllUsers).Methods("GET")

	// Avatar routes (public for serving, protected for upload)
	r.HandleFunc("/api/avatars/{guid}", avatarHandler.GetAvatar).Methods("GET")
	r.Handle("/api/users/me/avatar", authHandler.AuthMiddleware(http.HandlerFunc(avatarHandler.UploadAvatar))).Methods("POST")

	// Audio file routes (public for serving and listing, protected for upload)
	if audioHandler != nil {
		r.HandleFunc("/api/audio", audioHandler.ListAudio).Methods("GET")
		r.HandleFunc("/api/audio/{id}", audioHandler.GetAudio).Methods("GET")
		audioUploadHandler := limiter.Middleware("audio-upload", audioUploadLimit, clientIPKey, http.HandlerFunc(audioHandler.UploadAudio))
		r.Handle("/api/audio/upload", authHandler.AuthMiddleware(audioUploadHandler)).Methods("POST")
	}

	// Sound pack routes (protected)
	r.Handle("/api/users/me/sound-pack", authHandler.AuthMiddleware(http.HandlerFunc(usersHandler.UpdateSoundPack))).Methods("PATCH")

	// Custom status route (protected)
	r.Handle("/api/users/me/custom-status", authHandler.AuthMiddleware(http.HandlerFunc(usersHandler.UpdateCustomStatus))).Methods("PATCH")

	// General configuration route (public)
	r.HandleFunc("/api/config", roomHandler.GetConfig).Methods("GET")

	// Halloween routes (protected)
	if halloweenHandler != nil {
		halloweenRouter := r.PathPrefix("/api/halloween").Subrouter()
		halloweenRouter.Use(authHandler.AuthMiddleware)
		halloweenRouter.HandleFunc("/state", halloweenHandler.GetState).Methods("GET")
		halloweenRouter.HandleFunc("/pumpkin-states", halloweenHandler.GetPumpkinStates).Methods("GET")
		halloweenRouter.HandleFunc("/pumpkin", halloweenHandler.UpdatePumpkin).Methods("PUT")
		halloweenRouter.HandleFunc("/game/config", halloweenHandler.GetConfig).Methods("GET")
		halloweenRouter.HandleFunc("/game/report", halloweenHandler.SubmitGame).Methods("POST")
		halloweenRouter.HandleFunc("/leaderboard", halloweenHandler.GetLeaderboard).Methods("GET")
		// Pumpkin art is public (like audio/avatars): <img> and Pixi loaders
		// cannot send Authorization headers.
		r.HandleFunc("/api/halloween/assets/{id}", halloweenHandler.GetAsset).Methods("GET")
		// Decider submissions from the balance harness (development only, no auth).
		if cfg.IsDevelopment() {
			r.HandleFunc("/api/halloween/game/report/bot", halloweenHandler.SubmitBotGame).Methods("POST")
		}
	}

	// Latest desktop release (public, resolved from the update feed)
	r.HandleFunc("/api/releases/latest", releaseHandler.GetLatest).Methods("GET")

	// LiveKit routes (protected)
	r.Handle("/api/livekit/token", authHandler.AuthMiddleware(http.HandlerFunc(livekitHandler.GenerateToken))).Methods("POST")
	r.HandleFunc("/api/livekit/health", livekitHandler.HealthCheck).Methods("GET")

	// Room routes: every route is authenticated and authorized per room via
	// RBAC (view_room / connect / manage_rooms / kick_members) in the handlers.
	auth := authHandler.AuthMiddleware
	requirePerm := func(p permissions.Permission, h http.HandlerFunc) http.Handler {
		return auth(handlers.RequirePermission(permissionService, p)(h))
	}
	r.Handle("/api/rooms", auth(http.HandlerFunc(roomHandler.GetRooms))).Methods("GET")
	r.Handle("/api/rooms", auth(http.HandlerFunc(roomHandler.CreateRoom))).Methods("POST")
	r.Handle("/api/rooms/order", requirePerm(permissions.ManageRooms, roomHandler.UpdateRoomOrder)).Methods("PUT")
	r.Handle("/api/rooms/{id}", auth(http.HandlerFunc(roomHandler.GetRoom))).Methods("GET")
	r.Handle("/api/rooms/{id}", auth(http.HandlerFunc(roomHandler.UpdateRoom))).Methods("PUT")
	r.Handle("/api/rooms/{id}", auth(http.HandlerFunc(roomHandler.DeleteRoom))).Methods("DELETE")
	r.Handle("/api/rooms/{id}/users", auth(http.HandlerFunc(roomHandler.GetRoomUsers))).Methods("GET")
	r.Handle("/api/rooms/{id}/join", auth(http.HandlerFunc(roomHandler.JoinRoom))).Methods("POST")
	r.Handle("/api/rooms/{id}/leave", auth(http.HandlerFunc(roomHandler.LeaveRoom))).Methods("POST")
	r.Handle("/api/rooms/{room_id}/kick/{user_id}", auth(http.HandlerFunc(roomHandler.KickUser))).Methods("POST")

	// Text channels: reads over REST (VIEW_ROOM checked per request), writes over WebSocket.
	if textChat != nil {
		textChatHandler := handlers.NewTextChatHandler(handlers.TextChatDeps{
			Store: textChat.Store, ReadState: textChat.ReadState, Notify: textChat.Notify,
			RoomService: roomService, Permissions: permissionService, Events: wsHub,
			Media: textChat.Media,
			Users: func() []*models.User {
				if userRepo == nil {
					return nil
				}
				users, err := userRepo.GetAll()
				if err != nil {
					log.Printf("[TextChat] Failed to list users for search: %v", err)
				}
				return users
			},
		})
		r.Handle("/api/rooms/{id}/messages", auth(http.HandlerFunc(textChatHandler.GetMessages))).Methods("GET")
		r.Handle("/api/messages/{id}/context", auth(http.HandlerFunc(textChatHandler.GetMessageContext))).Methods("GET")
		r.Handle("/api/chat/unread", auth(http.HandlerFunc(textChatHandler.GetUnread))).Methods("GET")
		r.Handle("/api/chat/search", auth(http.HandlerFunc(textChatHandler.Search))).Methods("GET")
		r.Handle("/api/rooms/{id}/pins", auth(http.HandlerFunc(textChatHandler.GetPins))).Methods("GET")
		r.Handle("/api/rooms/{id}/notify", auth(http.HandlerFunc(textChatHandler.SetNotify))).Methods("PUT")

		// Attachments (docs/specs/CHAT_SYSTEM.md §7.12): RBAC per request in the handlers.
		if textChat.Media != nil {
			chatUploadLimit := ratelimit.Every(cfg.ChatMedia.UploadsPerHour, time.Hour)
			uploadHandler := limiter.Middleware("chat-upload", chatUploadLimit, userOrIPKey, http.HandlerFunc(textChatHandler.UploadAttachment))
			r.Handle("/api/rooms/{id}/attachments", auth(uploadHandler)).Methods("POST")
			r.Handle("/api/attachments/urls", auth(http.HandlerFunc(textChatHandler.AttachmentURLs))).Methods("POST")
			r.Handle("/api/attachments/{id}", auth(http.HandlerFunc(textChatHandler.UpdateAttachment))).Methods("PATCH")
			r.Handle("/api/attachments/{id}", auth(http.HandlerFunc(textChatHandler.DeleteAttachment))).Methods("DELETE")
			r.Handle("/api/me/attachments", auth(http.HandlerFunc(textChatHandler.ListMyAttachments))).Methods("GET")
			r.Handle("/api/me/attachments/usage", auth(http.HandlerFunc(textChatHandler.MyAttachmentUsage))).Methods("GET")
			r.Handle("/api/me/attachments/bulk", auth(http.HandlerFunc(textChatHandler.BulkMyAttachments))).Methods("POST")
		}
	}

	// Category routes
	r.Handle("/api/categories", auth(http.HandlerFunc(categoryHandler.GetCategories))).Methods("GET")
	r.Handle("/api/categories", requirePerm(permissions.ManageRooms, categoryHandler.CreateCategory)).Methods("POST")
	r.Handle("/api/categories/reorder", requirePerm(permissions.ManageRooms, categoryHandler.UpdateCategoryOrder)).Methods("PUT")
	r.Handle("/api/categories/{id}", auth(http.HandlerFunc(categoryHandler.RenameCategory))).Methods("PUT")
	r.Handle("/api/categories/{id}", auth(http.HandlerFunc(categoryHandler.DeleteCategory))).Methods("DELETE")

	// RBAC: permissions, roles, assignments, overwrites. Mutations are
	// authorized inside PermissionService (manage_roles + hierarchy).
	r.HandleFunc("/api/permissions/catalog", rbacHandler.GetCatalog).Methods("GET")
	r.Handle("/api/me/permissions", auth(http.HandlerFunc(rbacHandler.GetMyPermissions))).Methods("GET")
	r.Handle("/api/me/color-role", auth(http.HandlerFunc(rbacHandler.SetMyColorRole))).Methods("PUT")
	r.Handle("/api/roles", auth(http.HandlerFunc(rbacHandler.ListRoles))).Methods("GET")
	r.Handle("/api/roles", auth(http.HandlerFunc(rbacHandler.CreateRole))).Methods("POST")
	r.Handle("/api/roles/order", auth(http.HandlerFunc(rbacHandler.ReorderRoles))).Methods("PUT")
	r.Handle("/api/roles/{id}", auth(http.HandlerFunc(rbacHandler.UpdateRole))).Methods("PUT")
	r.Handle("/api/roles/{id}", auth(http.HandlerFunc(rbacHandler.DeleteRole))).Methods("DELETE")
	r.Handle("/api/users/{id}/roles", auth(http.HandlerFunc(rbacHandler.SetUserRoles))).Methods("PUT")
	for _, t := range []struct{ prefix, target string }{
		{"/api/rooms", models.OverwriteTargetRoom},
		{"/api/categories", models.OverwriteTargetCategory},
	} {
		r.Handle(t.prefix+"/{id}/overwrites", auth(rbacHandler.ListOverwrites(t.target))).Methods("GET")
		r.Handle(t.prefix+"/{id}/overwrites/{subject_type}/{subject_id}", auth(rbacHandler.PutOverwrite(t.target))).Methods("PUT")
		r.Handle(t.prefix+"/{id}/overwrites/{subject_type}/{subject_id}", auth(rbacHandler.DeleteOverwrite(t.target))).Methods("DELETE")
	}
	r.Handle("/api/rooms/{id}/permissions_synced", auth(http.HandlerFunc(rbacHandler.SetRoomSync))).Methods("PUT")
	r.Handle("/api/rooms/{id}/viewers", auth(http.HandlerFunc(usersHandler.GetRoomViewers))).Methods("GET")

	// Soundboard: listing needs auth, clip files are public (audio loaders
	// cannot send auth headers). Upload (upload_sounds) and moderation
	// (manage_soundboard) are authorized inside the handlers.
	if soundboardHandler != nil {
		r.Handle("/api/soundboard", auth(http.HandlerFunc(soundboardHandler.ListSounds))).Methods("GET")
		r.HandleFunc("/api/soundboard/{id}/audio", soundboardHandler.GetSoundAudio).Methods("GET")
		soundUploadHandler := limiter.Middleware("soundboard-upload", audioUploadLimit, userOrIPKey, http.HandlerFunc(soundboardHandler.UploadSound))
		r.Handle("/api/soundboard", auth(soundUploadHandler)).Methods("POST")
		r.Handle("/api/admin/soundboard/{id}", auth(http.HandlerFunc(soundboardHandler.UpdateSound))).Methods("PATCH")
		r.Handle("/api/admin/soundboard/{id}", auth(http.HandlerFunc(soundboardHandler.DeleteSound))).Methods("DELETE")
		soundReplaceHandler := limiter.Middleware("soundboard-upload", audioUploadLimit, userOrIPKey, http.HandlerFunc(soundboardHandler.ReplaceSoundAudio))
		r.Handle("/api/admin/soundboard/{id}/audio", auth(soundReplaceHandler)).Methods("PUT")
	}

	// Custom emojis: listing needs auth, images are public (<img> cannot send
	// auth headers). Upload (upload_emojis) and moderation (manage_emojis) are
	// authorized inside the handlers.
	if emojiHandler != nil {
		r.Handle("/api/emojis", auth(http.HandlerFunc(emojiHandler.ListEmojis))).Methods("GET")
		r.HandleFunc("/api/emojis/{id}/image", emojiHandler.GetEmojiImage).Methods("GET")
		emojiUploadHandler := limiter.Middleware("emoji-upload", audioUploadLimit, userOrIPKey, http.HandlerFunc(emojiHandler.UploadEmoji))
		r.Handle("/api/emojis", auth(emojiUploadHandler)).Methods("POST")
		r.Handle("/api/admin/emojis/{id}", auth(http.HandlerFunc(emojiHandler.UpdateEmoji))).Methods("PATCH")
		r.Handle("/api/admin/emojis/{id}", auth(http.HandlerFunc(emojiHandler.DeleteEmoji))).Methods("DELETE")
	}

	// Shared audio management (manage_audio)
	if audioHandler != nil {
		r.Handle("/api/admin/audio/{id}", requirePerm(permissions.ManageAudio, audioHandler.DeleteAudio)).Methods("DELETE")
		r.Handle("/api/admin/audio/{id}", requirePerm(permissions.ManageAudio, audioHandler.RenameAudio)).Methods("PATCH")
	}

	// Admin management routes (super_admin only)
	superAdminRouter := r.PathPrefix("/api/admin").Subrouter()
	superAdminRouter.Use(authHandler.AuthMiddleware)
	superAdminRouter.Use(authHandler.RequireSuperAdmin)
	superAdminRouter.HandleFunc("/self-check", securityHandler.GetSelfCheck).Methods("GET")
	superAdminRouter.HandleFunc("/users", adminHandler.ListUsers).Methods("GET")
	superAdminRouter.HandleFunc("/users/guests", adminHandler.DeleteAllGuests).Methods("DELETE")
	superAdminRouter.HandleFunc("/users/{id}/role", adminHandler.GetUserRole).Methods("GET")
	superAdminRouter.HandleFunc("/users/{id}", adminHandler.DeleteUser).Methods("DELETE")
	superAdminRouter.HandleFunc("/logs", adminHandler.ListDebugLogs).Methods("GET")
	superAdminRouter.HandleFunc("/logs/{id}", adminHandler.GetDebugLog).Methods("GET")
	superAdminRouter.HandleFunc("/logs/{id}", adminHandler.DeleteDebugLog).Methods("DELETE")

	// Stats collection routes (super_admin only)
	superAdminRouter.HandleFunc("/stats/rooms/{id}/enable", adminHandler.EnableStats).Methods("POST")
	superAdminRouter.HandleFunc("/stats/rooms/{id}/disable", adminHandler.DisableStats).Methods("POST")
	superAdminRouter.HandleFunc("/stats/rooms/{id}/subscribe", adminHandler.StatsSubscribe).Methods("POST")
	superAdminRouter.HandleFunc("/stats/rooms/{id}/unsubscribe", adminHandler.StatsUnsubscribe).Methods("POST")
	superAdminRouter.HandleFunc("/stats/status", adminHandler.GetStatsStatus).Methods("GET")
	superAdminRouter.HandleFunc("/analytics/report", adminHandler.GetAnalyticsReport).Methods("GET")

	// Halloween admin routes (super_admin only)
	if halloweenHandler != nil {
		superAdminRouter.HandleFunc("/halloween/games", halloweenHandler.AdminGetGames).Methods("GET")
		superAdminRouter.HandleFunc("/halloween/items", halloweenHandler.AdminGetItems).Methods("GET")
		superAdminRouter.HandleFunc("/halloween/items", halloweenHandler.AdminCreateItem).Methods("POST")
		superAdminRouter.HandleFunc("/halloween/items/{id}", halloweenHandler.AdminUpdateItem).Methods("PATCH")
		superAdminRouter.HandleFunc("/halloween/items/{id}", halloweenHandler.AdminDeleteItem).Methods("DELETE")
		superAdminRouter.HandleFunc("/halloween/items/{id}/restore", halloweenHandler.AdminRestoreItem).Methods("POST")
		superAdminRouter.HandleFunc("/halloween/items/{id}/asset", halloweenHandler.AdminUploadAsset).Methods("POST")
		superAdminRouter.HandleFunc("/halloween/layouts", halloweenHandler.AdminGetLayouts).Methods("GET")
		superAdminRouter.HandleFunc("/halloween/layouts", halloweenHandler.AdminUpsertLayouts).Methods("PUT")
		superAdminRouter.HandleFunc("/halloween/rewards", halloweenHandler.AdminGetRewards).Methods("GET")
		superAdminRouter.HandleFunc("/halloween/rewards", halloweenHandler.AdminIssueReward).Methods("POST")
		superAdminRouter.HandleFunc("/halloween/config/export", halloweenHandler.AdminExportConfig).Methods("GET")
		superAdminRouter.HandleFunc("/halloween/config/import", halloweenHandler.AdminImportConfig).Methods("POST")
	}

	// Debug log upload route (authenticated users)
	debugLogUploadHandler := limiter.Middleware("debug-log-upload", ratelimit.Every(cfg.RateLimit.DebugLogPerMinute, time.Minute), userOrIPKey, http.HandlerFunc(adminHandler.UploadDebugLog))
	r.Handle("/api/logs", authHandler.AuthMiddleware(debugLogUploadHandler)).Methods("POST")

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

func writeJSON(w http.ResponseWriter, v interface{}) {
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("Failed to encode JSON response: %v", err)
	}
}

// healthHandler reports backend health. Meilisearch being down degrades
// text channels only, so it is reported but does not fail the check.
func healthHandler(textChat *websocket.TextChat) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		textChannels := "disabled"
		if textChat != nil {
			textChannels = "ok"
			if !textChat.Store.Ready() || textChat.Store.Health(r.Context()) != nil {
				textChannels = "unavailable"
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		writeJSON(w, map[string]string{
			"status":        "ok",
			"service":       "orbital-backend",
			"version":       version.GetVersion(),
			"text_channels": textChannels,
		})
	}
}

func versionHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	writeJSON(w, map[string]string{
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
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Cache-Control")

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

// newChatMedia sets up text channel attachments, or returns nil (disabled)
// without S3 config or a database.
func newChatMedia(cfg *config.Config, db *storage.DB) *chatmedia.Service {
	mc := cfg.ChatMedia
	if !mc.Enabled() || db == nil {
		log.Println("CHAT_MEDIA_S3_* is not set (or no database), text channel attachments are disabled")
		return nil
	}
	store, err := chatmedia.NewS3Store(chatmedia.S3Config{
		Endpoint: mc.S3Endpoint, PublicEndpoint: mc.PublicEndpoint(), Bucket: mc.Bucket, Region: mc.Region,
		AccessKey: mc.AccessKey, SecretKey: mc.SecretKey,
	})
	if err != nil {
		log.Printf("Text channel attachments are disabled: %v", err)
		return nil
	}
	const mb = 1024 * 1024
	svc := chatmedia.New(db, store, chatmedia.Limits{
		MaxImageBytes: int64(mc.MaxImageMB) * mb, MaxAudioBytes: int64(mc.MaxAudioMB) * mb,
		MaxVideoBytes: int64(mc.MaxVideoMB) * mb, QuotaBytes: mc.QuotaBytes(),
	})
	svc.Start(context.Background())
	log.Printf("Text channel attachments enabled (S3 %s, bucket %s, quota %d MB)", mc.S3Endpoint, mc.Bucket, mc.QuotaMB)
	return svc
}
