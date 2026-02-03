package repository

import (
	"database/sql"
	"time"

	"github.com/orbital/internal/models"
	"github.com/orbital/internal/storage"
)

// UserRepository handles database operations for users
type UserRepository struct {
	db *storage.DB
}

// NewUserRepository creates a new user repository
func NewUserRepository(db *storage.DB) *UserRepository {
	return &UserRepository{db: db}
}

// Create inserts a new user into the database
func (r *UserRepository) Create(user *models.User) error {
	_, err := r.db.Exec(
		`INSERT INTO users (id, nickname, created_at, last_seen, auth_provider, provider_id, email, avatar_url, is_guest) 
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		user.ID, user.Nickname, user.CreatedAt, user.LastSeen,
		user.AuthProvider, user.ProviderID, user.Email, user.AvatarURL, user.IsGuest,
	)
	return err
}

// scanUser scans a user row, handling NULL values properly
func scanUser(scanner interface {
	Scan(dest ...interface{}) error
}) (*models.User, error) {
	user := &models.User{}
	var providerID, email, avatarURL sql.NullString
	var authProvider sql.NullString
	var isGuest sql.NullBool

	err := scanner.Scan(
		&user.ID,
		&user.Nickname,
		&user.CreatedAt,
		&user.LastSeen,
		&authProvider,
		&providerID,
		&email,
		&avatarURL,
		&isGuest,
	)
	if err != nil {
		return nil, err
	}

	// Convert NULL values to empty strings/booleans
	if authProvider.Valid {
		user.AuthProvider = models.AuthProvider(authProvider.String)
	} else {
		user.AuthProvider = models.AuthProviderGuest
	}
	if providerID.Valid {
		user.ProviderID = providerID.String
	}
	if email.Valid {
		user.Email = email.String
	}
	if avatarURL.Valid {
		user.AvatarURL = avatarURL.String
	}
	if isGuest.Valid {
		user.IsGuest = isGuest.Bool
	} else {
		user.IsGuest = true // Default to guest for old users
	}

	return user, nil
}

// GetByID retrieves a user by ID
func (r *UserRepository) GetByID(id string) (*models.User, error) {
	user, err := scanUser(r.db.QueryRow(
		`SELECT id, nickname, created_at, last_seen, auth_provider, provider_id, email, avatar_url, is_guest 
		 FROM users WHERE id = ?`,
		id,
	))

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return user, nil
}

// GetByProviderID retrieves a user by OAuth provider and provider ID
func (r *UserRepository) GetByProviderID(provider string, providerID string) (*models.User, error) {
	if providerID == "" {
		return nil, nil
	}

	user, err := scanUser(r.db.QueryRow(
		`SELECT id, nickname, created_at, last_seen, auth_provider, provider_id, email, avatar_url, is_guest 
		 FROM users WHERE auth_provider = ? AND provider_id = ?`,
		provider, providerID,
	))

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return user, nil
}

// Update updates a user's information
func (r *UserRepository) Update(user *models.User) error {
	_, err := r.db.Exec(
		`UPDATE users SET nickname = ?, last_seen = ?, email = ?, avatar_url = ? WHERE id = ?`,
		user.Nickname, user.LastSeen, user.Email, user.AvatarURL, user.ID,
	)
	return err
}

// UpdateLastSeen updates only the last_seen timestamp
func (r *UserRepository) UpdateLastSeen(id string, lastSeen time.Time) error {
	_, err := r.db.Exec(
		`UPDATE users SET last_seen = ? WHERE id = ?`,
		lastSeen, id,
	)
	return err
}

// Delete removes a user from the database
func (r *UserRepository) Delete(id string) error {
	_, err := r.db.Exec(`DELETE FROM users WHERE id = ?`, id)
	return err
}

// GetAll retrieves all users from the database
func (r *UserRepository) GetAll() ([]*models.User, error) {
	rows, err := r.db.Query(`SELECT id, nickname, created_at, last_seen, auth_provider, provider_id, email, avatar_url, is_guest FROM users`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []*models.User
	for rows.Next() {
		user, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, user)
	}

	return users, rows.Err()
}
