package storage

import (
	"database/sql"
	"fmt"
	"log"
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
}

// RunMigrations runs all pending migrations
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
