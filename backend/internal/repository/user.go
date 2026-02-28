package repository

import (
	"database/sql"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
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
		`INSERT INTO users (id, nickname, oauth_nickname, created_at, last_seen, auth_provider, provider_id, email, avatar_url, is_guest, role, password_hash) 
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		user.ID, user.Nickname, user.OAuthNickname, user.CreatedAt, user.LastSeen,
		user.AuthProvider, user.ProviderID, user.Email, user.AvatarURL, user.IsGuest, user.Role, user.PasswordHash,
	)
	return err
}

// scanUser scans a user row, handling NULL values properly
func scanUser(scanner interface {
	Scan(dest ...interface{}) error
}) (*models.User, error) {
	user := &models.User{}
	var providerID, email, avatarURL, oauthNickname, role, passwordHash sql.NullString
	var authProvider sql.NullString
	var isGuest sql.NullBool

	err := scanner.Scan(
		&user.ID,
		&user.Nickname,
		&oauthNickname,
		&user.CreatedAt,
		&user.LastSeen,
		&authProvider,
		&providerID,
		&email,
		&avatarURL,
		&isGuest,
		&role,
		&passwordHash,
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
	if oauthNickname.Valid {
		user.OAuthNickname = oauthNickname.String
	}
	if isGuest.Valid {
		user.IsGuest = isGuest.Bool
	} else {
		user.IsGuest = true // Default to guest for old users
	}
	if role.Valid {
		user.Role = role.String
	} else {
		user.Role = models.RoleGuest // Default to guest for old users
	}
	if passwordHash.Valid {
		user.PasswordHash = passwordHash.String
	}

	return user, nil
}

// GetByID retrieves a user by ID
func (r *UserRepository) GetByID(id string) (*models.User, error) {
	user, err := scanUser(r.db.QueryRow(
		`SELECT id, nickname, oauth_nickname, created_at, last_seen, auth_provider, provider_id, email, avatar_url, is_guest, role, password_hash 
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
		`SELECT id, nickname, oauth_nickname, created_at, last_seen, auth_provider, provider_id, email, avatar_url, is_guest, role, password_hash 
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
		`UPDATE users SET nickname = ?, oauth_nickname = ?, last_seen = ?, email = ?, avatar_url = ? WHERE id = ?`,
		user.Nickname, user.OAuthNickname, user.LastSeen, user.Email, user.AvatarURL, user.ID,
	)
	return err
}

// UpdateAvatarURL updates only the avatar_url field
func (r *UserRepository) UpdateAvatarURL(userID string, avatarURL string) error {
	_, err := r.db.Exec(
		`UPDATE users SET avatar_url = ? WHERE id = ?`,
		avatarURL, userID,
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

// UpdateNickname updates only the nickname and last_seen timestamp
func (r *UserRepository) UpdateNickname(id string, nickname string, lastSeen time.Time) error {
	_, err := r.db.Exec(
		`UPDATE users SET nickname = ?, last_seen = ? WHERE id = ?`,
		nickname, lastSeen, id,
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
	rows, err := r.db.Query(`SELECT id, nickname, oauth_nickname, created_at, last_seen, auth_provider, provider_id, email, avatar_url, is_guest, role, password_hash FROM users`)
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

// UpdateRole updates a user's role
func (r *UserRepository) UpdateRole(userID string, role string) error {
	_, err := r.db.Exec(
		`UPDATE users SET role = ? WHERE id = ?`,
		role, userID,
	)
	return err
}

// HasSuperAdmin checks if any super_admin exists in the system
func (r *UserRepository) HasSuperAdmin() (bool, error) {
	var count int
	err := r.db.QueryRow(
		`SELECT COUNT(*) FROM users WHERE role = ?`,
		models.RoleSuperAdmin,
	).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// DeleteAllGuests deletes all guest users and returns the count of deleted users
func (r *UserRepository) DeleteAllGuests() (int64, error) {
	result, err := r.db.Exec(`DELETE FROM users WHERE is_guest = 1`)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// GetByEmail retrieves a user by email
func (r *UserRepository) GetByEmail(email string, authProvider *models.AuthProvider) (*models.User, error) {
	if email == "" {
		return nil, nil
	}

	var query string
	var args []interface{}

	if authProvider != nil {
		query = `SELECT id, nickname, oauth_nickname, created_at, last_seen, auth_provider, provider_id, email, avatar_url, is_guest, role, password_hash 
		 FROM users WHERE LOWER(email) = LOWER(?) AND auth_provider = ?`
		args = []interface{}{email, *authProvider}
	} else {
		query = `SELECT id, nickname, oauth_nickname, created_at, last_seen, auth_provider, provider_id, email, avatar_url, is_guest, role, password_hash 
		 FROM users WHERE LOWER(email) = LOWER(?)`
		args = []interface{}{email}
	}

	user, err := scanUser(r.db.QueryRow(query, args...))

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return user, nil
}

// GetByNickname retrieves a user by nickname
func (r *UserRepository) GetByNickname(nickname string, authProvider *models.AuthProvider) (*models.User, error) {
	if nickname == "" {
		return nil, nil
	}

	var query string
	var args []interface{}

	if authProvider != nil {
		query = `SELECT id, nickname, oauth_nickname, created_at, last_seen, auth_provider, provider_id, email, avatar_url, is_guest, role, password_hash 
		 FROM users WHERE LOWER(nickname) = LOWER(?) AND auth_provider = ?`
		args = []interface{}{nickname, *authProvider}
	} else {
		query = `SELECT id, nickname, oauth_nickname, created_at, last_seen, auth_provider, provider_id, email, avatar_url, is_guest, role, password_hash 
		 FROM users WHERE LOWER(nickname) = LOWER(?)`
		args = []interface{}{nickname}
	}

	user, err := scanUser(r.db.QueryRow(query, args...))

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return user, nil
}

// EmailExists checks if an email is already registered (for password auth users)
func (r *UserRepository) EmailExists(email string) (bool, error) {
	if email == "" {
		return false, nil
	}

	var count int
	err := r.db.QueryRow(
		`SELECT COUNT(*) FROM users WHERE LOWER(email) = LOWER(?) AND auth_provider = ?`,
		email, models.AuthProviderPassword,
	).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// NicknameExists checks if a nickname is already taken
func (r *UserRepository) NicknameExists(nickname string) (bool, error) {
	if nickname == "" {
		return false, nil
	}

	var count int
	err := r.db.QueryRow(
		`SELECT COUNT(*) FROM users WHERE LOWER(nickname) = LOWER(?)`,
		nickname,
	).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// UpdatePasswordHash updates the password hash for a user
func (r *UserRepository) UpdatePasswordHash(userID string, passwordHash string) error {
	_, err := r.db.Exec(
		`UPDATE users SET password_hash = ? WHERE id = ?`,
		passwordHash, userID,
	)
	return err
}
