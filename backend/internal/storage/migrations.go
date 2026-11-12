package storage

import (
	"database/sql"
	"fmt"
	"log"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
)

// Migration represents a database migration
type Migration struct {
	Version int
	Name    string
	SQL     string
}

// migrations is the list of all migrations in order
var migrations = []Migration{
	{
		Version: 1,
		Name:    "create_users_table",
		SQL: `CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			nickname TEXT NOT NULL,
			created_at DATETIME NOT NULL,
			last_seen DATETIME NOT NULL
		);`,
	},
	{
		Version: 2,
		Name:    "create_categories_table",
		SQL: `CREATE TABLE IF NOT EXISTS categories (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL UNIQUE,
			created_at DATETIME NOT NULL
		);`,
	},
	{
		Version: 3,
		Name:    "create_rooms_table",
		SQL: `CREATE TABLE IF NOT EXISTS rooms (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			owner_id TEXT,
			max_users INTEGER NOT NULL,
			created_at DATETIME NOT NULL,
			category_id TEXT,
			FOREIGN KEY (owner_id) REFERENCES users(id),
			FOREIGN KEY (category_id) REFERENCES categories(id)
		);`,
	},
	{
		Version: 4,
		Name:    "add_oauth_fields_to_users",
		SQL: `ALTER TABLE users ADD COLUMN auth_provider TEXT DEFAULT 'guest';
ALTER TABLE users ADD COLUMN provider_id TEXT;
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN is_guest BOOLEAN DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_users_provider ON users(auth_provider, provider_id);`,
	},
	{
		Version: 5,
		Name:    "add_oauth_nickname_to_users",
		SQL: `ALTER TABLE users ADD COLUMN oauth_nickname TEXT;
UPDATE users SET oauth_nickname = nickname WHERE auth_provider != 'guest';`,
	},
	{
		Version: 6,
		Name:    "add_sort_order_to_rooms",
		SQL: `ALTER TABLE rooms ADD COLUMN sort_order INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_rooms_sort_order ON rooms(category_id, sort_order);`,
	},
	{
		Version: 7,
		Name:    "add_sort_order_to_categories",
		SQL: `ALTER TABLE categories ADD COLUMN sort_order INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_categories_sort_order ON categories(sort_order);`,
	},
	{
		Version: 8,
		Name:    "add_role_to_users",
		SQL: `ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'guest';
UPDATE users SET role = 'user' WHERE is_guest = 0;
UPDATE users SET role = 'guest' WHERE is_guest = 1;
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);`,
	},
	{
		Version: 9,
		Name:    "add_password_auth",
		SQL: `ALTER TABLE users ADD COLUMN password_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_nickname ON users(nickname);`,
	},
	{
		Version: 10,
		Name:    "create_debug_logs_table",
		SQL: `CREATE TABLE IF NOT EXISTS debug_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id TEXT NOT NULL,
			username TEXT NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			log_filename TEXT NOT NULL
		);
CREATE INDEX IF NOT EXISTS idx_debug_logs_user_id ON debug_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_debug_logs_created_at ON debug_logs(created_at);`,
	},
	{
		Version: 11,
		Name:    "add_version_to_debug_logs",
		SQL:     `ALTER TABLE debug_logs ADD COLUMN version TEXT DEFAULT '';`,
	},
	{
		Version: 12,
		Name:    "populate_original_nickname_for_all_users",
		SQL:     `UPDATE users SET oauth_nickname = nickname WHERE oauth_nickname IS NULL OR oauth_nickname = '';`,
	},
	{
		Version: 13,
		Name:    "rename_oauth_nickname_to_original_nickname",
		SQL: `ALTER TABLE users RENAME COLUMN oauth_nickname TO original_nickname;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_original_nickname_provider ON users(original_nickname, auth_provider) WHERE auth_provider IN ('password', 'guest');`,
	},
	{
		Version: 14,
		Name:    "add_sound_pack_to_users",
		SQL:     `ALTER TABLE users ADD COLUMN sound_pack TEXT DEFAULT 'default';`,
	},
	{
		Version: 15,
		Name:    "add_type_to_rooms",
		SQL:     `ALTER TABLE rooms ADD COLUMN type TEXT NOT NULL DEFAULT 'voice';`,
	},
	{
		Version: 16,
		Name:    "create_audio_files_table",
		SQL: `CREATE TABLE IF NOT EXISTS audio_files (
			id TEXT PRIMARY KEY,
			filename TEXT NOT NULL,
			display_name TEXT NOT NULL,
			uploaded_by TEXT,
			file_size INTEGER NOT NULL,
			duration REAL DEFAULT 0,
			is_system BOOLEAN DEFAULT 0,
			created_at DATETIME NOT NULL,
			FOREIGN KEY (uploaded_by) REFERENCES users(id)
		);
CREATE INDEX IF NOT EXISTS idx_audio_files_uploaded_by ON audio_files(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_audio_files_is_system ON audio_files(is_system);`,
	},
	{
		Version: 17,
		Name:    "add_world_to_rooms",
		SQL:     `ALTER TABLE rooms ADD COLUMN world TEXT NOT NULL DEFAULT 'default';`,
	},
	{
		Version: 18,
		Name:    "add_system_info_to_debug_logs",
		SQL:     `ALTER TABLE debug_logs ADD COLUMN system_info TEXT DEFAULT '';`,
	},
	{
		Version: 19,
		Name:    "create_user_sessions_table",
		SQL: `CREATE TABLE IF NOT EXISTS user_sessions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id TEXT NOT NULL,
			room_id TEXT NOT NULL,
			first_seen DATETIME NOT NULL,
			last_seen DATETIME NOT NULL,
			platform TEXT NOT NULL DEFAULT 'unknown',
			system_name TEXT NOT NULL DEFAULT 'unknown',
			device_info TEXT NOT NULL DEFAULT '',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_room ON user_sessions(user_id, room_id, last_seen);
CREATE INDEX IF NOT EXISTS idx_user_sessions_last_seen ON user_sessions(last_seen);`,
	},
	{
		Version: 20,
		Name:    "add_app_version_to_user_sessions",
		SQL: `ALTER TABLE user_sessions ADD COLUMN app_version TEXT NOT NULL DEFAULT '';
UPDATE user_sessions
   SET app_version = COALESCE(json_extract(device_info, '$.app_version'), '')
 WHERE json_valid(device_info) AND device_info != '';
CREATE INDEX IF NOT EXISTS idx_user_sessions_app_version ON user_sessions(app_version);`,
	},
	{
		Version: 21,
		Name:    "create_halloween_tables",
		SQL: `CREATE TABLE IF NOT EXISTS halloween_items (
			id         TEXT PRIMARY KEY,
			name       TEXT NOT NULL,
			socket     TEXT NOT NULL,
			rarity     TEXT NOT NULL,
			sort_order INTEGER DEFAULT 0
		);
CREATE INDEX IF NOT EXISTS idx_halloween_items_rarity ON halloween_items(rarity);

CREATE TABLE IF NOT EXISTS halloween_game_results (
			id               INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id          TEXT NOT NULL,
			completed_rounds INTEGER NOT NULL,
			score            INTEGER NOT NULL,
			is_incomplete    BOOLEAN NOT NULL DEFAULT 0,
			is_cheater       BOOLEAN NOT NULL DEFAULT 0,
			report_json      TEXT NOT NULL,
			reward_json      TEXT,
			created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
CREATE INDEX IF NOT EXISTS idx_halloween_game_results_user  ON halloween_game_results(user_id);
CREATE INDEX IF NOT EXISTS idx_halloween_game_results_score ON halloween_game_results(score);

CREATE TABLE IF NOT EXISTS halloween_rewards (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id    TEXT NOT NULL,
			item_id    TEXT NOT NULL,
			source     TEXT NOT NULL DEFAULT 'game',
			game_id    INTEGER,
			granted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (user_id, item_id),
			FOREIGN KEY (item_id) REFERENCES halloween_items(id),
			FOREIGN KEY (game_id) REFERENCES halloween_game_results(id)
		);
CREATE INDEX IF NOT EXISTS idx_halloween_rewards_user ON halloween_rewards(user_id);

CREATE TABLE IF NOT EXISTS halloween_pumpkins (
			user_id      TEXT PRIMARY KEY,
			equipped_json TEXT NOT NULL DEFAULT '{}',
			updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		);`,
	},
	{
		Version: 22,
		Name:    "seed_halloween_items",
		SQL: `INSERT OR IGNORE INTO halloween_items (id, name, socket, rarity, sort_order) VALUES
			('hat_party', 'Party hat', 'hat', 'rare', 1),
			('hat_frog', 'Frog hat', 'hat', 'rare', 2),
			('hat_beret', 'Beret', 'hat', 'regular', 3),
			('eyes_sinister', 'Sinister', 'eyes', 'rare', 10),
			('eyes_scared', 'Scared', 'eyes', 'common', 11),
			('eyes_smiling', 'Smiling', 'eyes', 'uncommon', 12),
			('eyes_cat', 'Cat eyes', 'eyes', 'uncommon', 13),
			('mouth_vampire', 'Vampire', 'mouth', 'rare', 20),
			('mouth_crooked', 'Crooked', 'mouth', 'uncommon', 21),
			('mouth_pumpkin', 'Pumpkin', 'mouth', 'common', 22);`,
	},
	{
		Version: 23,
		Name:    "add_source_model_to_halloween_game_results",
		SQL: `ALTER TABLE halloween_game_results ADD COLUMN source TEXT NOT NULL DEFAULT 'human';
ALTER TABLE halloween_game_results ADD COLUMN model TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_halloween_game_results_source ON halloween_game_results(source);`,
	},
	{
		Version: 24,
		Name:    "halloween_socket_system",
		SQL: `ALTER TABLE halloween_items ADD COLUMN asset_path TEXT NOT NULL DEFAULT '';
ALTER TABLE halloween_items ADD COLUMN z_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE halloween_items ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_halloween_items_deleted ON halloween_items(is_deleted);

CREATE TABLE IF NOT EXISTS halloween_base_sockets (
			base_id  TEXT NOT NULL REFERENCES halloween_items(id) ON DELETE CASCADE,
			socket   TEXT NOT NULL,
			offset_x REAL NOT NULL DEFAULT 0,
			offset_y REAL NOT NULL DEFAULT 0,
			PRIMARY KEY (base_id, socket)
);

INSERT OR IGNORE INTO halloween_items (id, name, socket, rarity, sort_order, asset_path, z_index, is_deleted) VALUES
			('base_a', 'Classic', 'base', 'regular', 0, '/assets/hw26/user-pumpkins/bases/base_a.png', 0, 0),
			('feet_boots', 'Boots', 'feet', 'common', 30, '/assets/hw26/user-pumpkins/feet/feet_A.png', -1, 0),
			('feet_roots', 'Roots', 'feet', 'uncommon', 31, '/assets/hw26/user-pumpkins/feet/feet_A.png', -1, 0),
			('feet_sneakers', 'Sneakers', 'feet', 'rare', 32, '/assets/hw26/user-pumpkins/feet/feet_A.png', -1, 0);

UPDATE halloween_items SET asset_path = '/assets/hw26/user-pumpkins/hats/hat_A.png', z_index = 20 WHERE socket = 'hat' AND asset_path = '';
UPDATE halloween_items SET asset_path = '/assets/hw26/user-pumpkins/eyes/eye_A.png', z_index = 10 WHERE socket = 'eyes' AND asset_path = '';
UPDATE halloween_items SET asset_path = '/assets/hw26/user-pumpkins/mouths/mouth_A.png', z_index = 11 WHERE socket = 'mouth' AND asset_path = '';

INSERT OR IGNORE INTO halloween_base_sockets (base_id, socket, offset_x, offset_y) VALUES
			('base_a', 'hat', 0, -0.45),
			('base_a', 'eyes', 0, -0.05),
			('base_a', 'mouth', 0, 0.2),
			('base_a', 'feet', 0, 0.48);`,
	},
	{
		Version: 25,
		Name:    "halloween_backend_owned_assets",
		SQL: `UPDATE halloween_items SET asset_path = '/api/halloween/assets/' || id WHERE socket != 'base' AND (asset_path = '' OR asset_path LIKE '/assets/hw26/user-pumpkins/%');
UPDATE halloween_items SET asset_path = '/api/halloween/assets/' || id WHERE socket = 'base' AND (asset_path = '' OR asset_path LIKE '/assets/hw26/user-pumpkins/%');

INSERT OR IGNORE INTO halloween_items (id, name, socket, rarity, sort_order, asset_path, z_index, is_deleted) VALUES
			('base_a', 'Classic', 'base', 'regular', 0, '/api/halloween/assets/base_a', 0, 0),
			('feet_boots', 'Boots', 'feet', 'common', 30, '/api/halloween/assets/feet_boots', -1, 0),
			('feet_roots', 'Roots', 'feet', 'uncommon', 31, '/api/halloween/assets/feet_roots', -1, 0),
			('feet_sneakers', 'Sneakers', 'feet', 'rare', 32, '/api/halloween/assets/feet_sneakers', -1, 0);

INSERT OR IGNORE INTO halloween_base_sockets (base_id, socket, offset_x, offset_y) VALUES
			('base_a', 'hat', 0, -0.45),
			('base_a', 'eyes', 0, -0.05),
			('base_a', 'mouth', 0, 0.2),
			('base_a', 'feet', 0, 0.48);`,
	},
	{
		Version: 26,
		Name:    "drop_sort_order_from_halloween_items",
		SQL:     `ALTER TABLE halloween_items DROP COLUMN sort_order;`,
	},
	{
		Version: 27,
		Name:    "add_scale_to_halloween_items",
		SQL:     `ALTER TABLE halloween_items ADD COLUMN scale REAL NOT NULL DEFAULT 1;`,
	},
	{
		Version: 28,
		Name:    "flatten_halloween_rarity_to_common",
		SQL:     `UPDATE halloween_items SET rarity = 'common';`,
	},
	{
		Version: 29,
		Name:    "create_qr_login_challenges_table",
		SQL: `CREATE TABLE IF NOT EXISTS qr_login_challenges (
			id TEXT PRIMARY KEY,
			public_key TEXT NOT NULL,
			device_name TEXT NOT NULL DEFAULT '',
			device_info TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'pending',
			approved_by_user_id TEXT,
			sealed_payload TEXT,
			created_at DATETIME NOT NULL,
			expires_at DATETIME NOT NULL,
			consumed_at DATETIME
		);
CREATE INDEX IF NOT EXISTS idx_qr_login_challenges_expires ON qr_login_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_qr_login_challenges_status ON qr_login_challenges(status);`,
	},
	{
		Version: 30,
		Name:    "add_token_version_to_users",
		SQL: `ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_users_token_version ON users(token_version);`,
	},
	{
		Version: 31,
		Name:    "add_file_size_to_debug_logs",
		SQL:     `ALTER TABLE debug_logs ADD COLUMN file_size INTEGER NOT NULL DEFAULT -1;`,
	},
	{
		Version: 32,
		Name:    "add_custom_status_to_users",
		SQL:     `ALTER TABLE users ADD COLUMN custom_status TEXT NOT NULL DEFAULT '';`,
	},
	{
		Version: 33,
		Name:    "add_custom_status_emoji_to_users",
		SQL:     `ALTER TABLE users ADD COLUMN custom_status_emoji TEXT NOT NULL DEFAULT '';`,
	},
	{
		Version: 34,
		Name:    "create_rbac_tables",
		// Discord-style RBAC. Seeds @everyone / Guest system roles and an
		// "Admin" role that reproduces the legacy global admin capabilities,
		// then migrates legacy admins onto it. super_admin stays in users.role
		// as the single owner.
		SQL: fmt.Sprintf(`CREATE TABLE IF NOT EXISTS roles (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			color TEXT NOT NULL DEFAULT '',
			position INTEGER NOT NULL DEFAULT 0,
			permissions INTEGER NOT NULL DEFAULT 0,
			deny_permissions INTEGER NOT NULL DEFAULT 0,
			system_key TEXT UNIQUE,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
CREATE TABLE IF NOT EXISTS user_roles (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
			PRIMARY KEY (user_id, role_id)
		);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);
CREATE TABLE IF NOT EXISTS permission_overwrites (
			target_type TEXT NOT NULL,
			target_id TEXT NOT NULL,
			subject_type TEXT NOT NULL,
			subject_id TEXT NOT NULL,
			allow INTEGER NOT NULL DEFAULT 0,
			deny INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (target_type, target_id, subject_type, subject_id)
		);
ALTER TABLE rooms ADD COLUMN permissions_synced INTEGER NOT NULL DEFAULT 1;
INSERT INTO roles (id, name, position, permissions, deny_permissions, system_key) VALUES
			('everyone', '@everyone', 0, %d, 0, 'everyone'),
			('guest', 'Guest', 0, 0, %d, 'guest'),
			('admin', 'Admin', 1, %d, 0, NULL);
INSERT INTO user_roles (user_id, role_id) SELECT id, 'admin' FROM users WHERE role = 'admin';
UPDATE users SET role = 'user' WHERE role = 'admin';`,
			permissions.DefaultEveryone, permissions.DefaultGuestDeny, permissions.DefaultAdmin),
	},
	{
		Version: 35,
		Name:    "add_owner_system_role",
		// The super admin implicitly holds this role. It always sits at the
		// top and carries no permissions (the owner bypasses checks); it exists
		// so the owner's name/colour can be customised like any other role.
		SQL: fmt.Sprintf(`INSERT OR IGNORE INTO roles (id, name, position, permissions, deny_permissions, system_key) VALUES
			('owner', 'Owner', %d, 0, 0, 'owner');`, models.OwnerRolePosition),
	},
	{
		Version: 36,
		Name:    "create_soundboard_sounds",
		// aliases is a JSON array of lowercase search aliases.
		SQL: `CREATE TABLE IF NOT EXISTS soundboard_sounds (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			emoji TEXT NOT NULL DEFAULT '',
			aliases TEXT NOT NULL DEFAULT '[]',
			filename TEXT NOT NULL,
			format TEXT NOT NULL,
			file_size INTEGER NOT NULL DEFAULT 0,
			uploaded_by TEXT,
			created_at DATETIME NOT NULL
		);
CREATE INDEX IF NOT EXISTS idx_soundboard_sounds_created ON soundboard_sounds(created_at);`,
	},
	{
		Version: 37,
		Name:    "grant_soundboard_permissions",
		// Migration 34 only seeds defaults once, so existing databases need the
		// new soundboard bits granted explicitly. OR-ing keeps it idempotent.
		SQL: fmt.Sprintf(`UPDATE roles SET permissions = permissions | %d WHERE id = 'everyone';
UPDATE roles SET deny_permissions = deny_permissions | %d WHERE id = 'guest';
UPDATE roles SET permissions = permissions | %d WHERE id = 'admin';`,
			permissions.UseSoundboard|permissions.UploadSounds,
			permissions.UploadSounds,
			permissions.ManageSoundboard),
	},
	{
		Version: 38,
		Name:    "create_custom_emojis",
		// aliases is a JSON array of lowercase search aliases. Emojis are
		// referenced as "custom:<id>" so renames never break references.
		SQL: `CREATE TABLE IF NOT EXISTS custom_emojis (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			aliases TEXT NOT NULL DEFAULT '[]',
			filename TEXT NOT NULL,
			file_size INTEGER NOT NULL DEFAULT 0,
			uploaded_by TEXT,
			created_at DATETIME NOT NULL
		);
CREATE INDEX IF NOT EXISTS idx_custom_emojis_created ON custom_emojis(created_at);`,
	},
	{
		Version: 39,
		Name:    "grant_emoji_permissions",
		// Only admins may upload/manage custom emojis by default.
		SQL: fmt.Sprintf(`UPDATE roles SET permissions = permissions | %d WHERE id = 'admin';`,
			permissions.UploadEmojis|permissions.ManageEmojis),
	},
	{
		Version: 40,
		Name:    "custom_emoji_animated",
		// Emojis are stored as WebP, so animation can no longer be told from
		// the file extension. Existing GIFs are animated (or at least served
		// with a still frame); EmojiService.MigrateToWebP re-checks on convert.
		SQL: `ALTER TABLE custom_emojis ADD COLUMN animated INTEGER NOT NULL DEFAULT 0;
UPDATE custom_emojis SET animated = 1 WHERE filename LIKE '%.gif';`,
	},
	{
		Version: 41,
		Name:    "create_text_read_state",
		// Per-user read position in text channels (messages themselves live
		// in Meilisearch, see docs/specs/CHAT_SYSTEM.md).
		SQL: `CREATE TABLE IF NOT EXISTS text_read_state (
			user_id TEXT NOT NULL,
			room_id TEXT NOT NULL,
			last_read_seq INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (user_id, room_id)
		);
CREATE INDEX IF NOT EXISTS idx_text_read_state_room ON text_read_state(room_id);`,
	},
	{
		Version: 42,
		Name:    "grant_text_channel_permissions",
		// Attach Files is on for @everyone and denied to guests; Manage
		// Messages goes to the admin role. OR-ing keeps it idempotent.
		SQL: fmt.Sprintf(`UPDATE roles SET permissions = permissions | %d WHERE id = 'everyone';
UPDATE roles SET deny_permissions = deny_permissions | %d WHERE id = 'guest';
UPDATE roles SET permissions = permissions | %d WHERE id = 'admin';`,
			permissions.AttachFiles,
			permissions.AttachFiles,
			permissions.ManageMessages),
	},
	{
		Version: 43,
		Name:    "create_text_notify_settings",
		// Per-user notification mode per text channel; no row = 'all'.
		// muted_until is unix ms, NULL with mode 'muted' = forever.
		SQL: `CREATE TABLE IF NOT EXISTS text_notify_settings (
			user_id TEXT NOT NULL,
			room_id TEXT NOT NULL,
			mode TEXT NOT NULL CHECK (mode IN ('all','no_mentions','muted')),
			muted_until INTEGER,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (user_id, room_id)
		);
CREATE INDEX IF NOT EXISTS idx_text_notify_settings_room ON text_notify_settings(room_id);
CREATE INDEX IF NOT EXISTS idx_text_notify_settings_until ON text_notify_settings(muted_until) WHERE muted_until IS NOT NULL;`,
	},
	{
		Version: 44,
		Name:    "create_chat_attachments",
		// Text channel attachments from upload to purge (docs/specs/CHAT_SYSTEM.md
		// §7.12): ownership, quota usage and protection. Times are unix ms.
		SQL: `CREATE TABLE IF NOT EXISTS chat_attachments (
			id TEXT PRIMARY KEY,
			room_id TEXT NOT NULL,
			uploader_id TEXT NOT NULL,
			message_id TEXT,
			kind TEXT NOT NULL,
			mime TEXT NOT NULL,
			ext TEXT NOT NULL,
			filename TEXT NOT NULL,
			size_bytes INTEGER NOT NULL,
			stored_bytes INTEGER NOT NULL,
			width INTEGER,
			height INTEGER,
			duration_ms INTEGER,
			has_thumb INTEGER NOT NULL DEFAULT 0,
			peaks TEXT,
			status TEXT NOT NULL CHECK (status IN ('pending','attached','removed')),
			protected INTEGER NOT NULL DEFAULT 0,
			removed_reason TEXT,
			created_at INTEGER NOT NULL,
			attached_at INTEGER,
			removed_at INTEGER,
			purged_at INTEGER
		);
CREATE INDEX IF NOT EXISTS idx_chat_att_owner ON chat_attachments(uploader_id, status, protected, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_att_message ON chat_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_att_room ON chat_attachments(room_id);
CREATE INDEX IF NOT EXISTS idx_chat_att_purge ON chat_attachments(status, purged_at);`,
	},
	{
		Version: 45,
		Name:    "create_user_color_roles",
		// The role a user picked to color their nickname; no row = the
		// highest colored role. role_id may be the implicit 'owner' role.
		SQL: `CREATE TABLE IF NOT EXISTS user_color_roles (
			user_id TEXT PRIMARY KEY,
			role_id TEXT NOT NULL
		);
CREATE INDEX IF NOT EXISTS idx_user_color_roles_role ON user_color_roles(role_id);`,
	},
	{
		Version: 46,
		Name:    "create_chat_attachment_jobs",
		// Content extraction (OCR, image embeddings) per attachment, see
		// docs/specs/CHAT_SYSTEM.md §7.13. signature names the models that
		// produced the result; a model change re-queues the done rows.
		// vector is little-endian float32.
		SQL: `CREATE TABLE IF NOT EXISTS chat_attachment_jobs (
			attachment_id TEXT PRIMARY KEY,
			status TEXT NOT NULL CHECK (status IN ('pending','done','failed')),
			attempts INTEGER NOT NULL DEFAULT 0,
			next_attempt_at INTEGER NOT NULL DEFAULT 0,
			last_error TEXT,
			signature TEXT NOT NULL DEFAULT '',
			text TEXT NOT NULL DEFAULT '',
			vector BLOB,
			updated_at INTEGER NOT NULL
		);
CREATE INDEX IF NOT EXISTS idx_chat_att_jobs_due ON chat_attachment_jobs(status, next_attempt_at);`,
	},
}

// RunMigrationsUpTo applies migrations up to and including maxVersion.
// Intended for tests that need to simulate an older schema.
func RunMigrationsUpTo(db *DB, maxVersion int) error {
	if err := db.createMigrationsTable(); err != nil {
		return err
	}
	current, err := db.getCurrentVersion()
	if err != nil {
		return err
	}
	for _, m := range migrations {
		if m.Version > current && m.Version <= maxVersion {
			if err := db.runMigration(m); err != nil {
				return fmt.Errorf("failed to run migration %d (%s): %w", m.Version, m.Name, err)
			}
		}
	}
	return nil
}

func (db *DB) RunMigrations() error {
	// Create migrations tracking table if it doesn't exist
	if err := db.createMigrationsTable(); err != nil {
		return fmt.Errorf("failed to create migrations table: %w", err)
	}

	// Get current migration version
	currentVersion, err := db.getCurrentVersion()
	if err != nil {
		return fmt.Errorf("failed to get current migration version: %w", err)
	}

	log.Printf("Current database version: %d", currentVersion)

	// Run pending migrations
	for _, migration := range migrations {
		if migration.Version > currentVersion {
			if err := db.runMigration(migration); err != nil {
				return fmt.Errorf("failed to run migration %d (%s): %w", migration.Version, migration.Name, err)
			}
			log.Printf("Applied migration %d: %s", migration.Version, migration.Name)
		}
	}

	return nil
}

// createMigrationsTable creates the table to track migrations
func (db *DB) createMigrationsTable() error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version INTEGER PRIMARY KEY,
		applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`)
	return err
}

// getCurrentVersion returns the current migration version
func (db *DB) getCurrentVersion() (int, error) {
	var version int
	row := db.QueryRow("SELECT COALESCE(MAX(version), 0) FROM schema_migrations")
	err := row.Scan(&version)
	if err != nil {
		return 0, err
	}
	return version, nil
}

// runMigration executes a single migration within a transaction
func (db *DB) runMigration(migration Migration) error {
	return db.Transaction(func(tx *sql.Tx) error {
		// Execute the migration SQL
		if _, err := tx.Exec(migration.SQL); err != nil {
			return fmt.Errorf("migration SQL failed: %w", err)
		}

		// Record the migration
		_, err := tx.Exec(
			"INSERT INTO schema_migrations (version) VALUES (?)",
			migration.Version,
		)
		if err != nil {
			return fmt.Errorf("failed to record migration: %w", err)
		}

		return nil
	})
}
