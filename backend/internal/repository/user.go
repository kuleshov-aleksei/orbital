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
		`INSERT INTO users (id, nickname, created_at, last_seen) VALUES (?, ?, ?, ?)`,
		user.ID, user.Nickname, user.CreatedAt, user.LastSeen,
	)
	return err
}

// GetByID retrieves a user by ID
func (r *UserRepository) GetByID(id string) (*models.User, error) {
	user := &models.User{}
	err := r.db.QueryRow(
		`SELECT id, nickname, created_at, last_seen FROM users WHERE id = ?`,
		id,
	).Scan(&user.ID, &user.Nickname, &user.CreatedAt, &user.LastSeen)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return user, nil
}

// Update updates a user's nickname and last_seen
func (r *UserRepository) Update(user *models.User) error {
	_, err := r.db.Exec(
		`UPDATE users SET nickname = ?, last_seen = ? WHERE id = ?`,
		user.Nickname, user.LastSeen, user.ID,
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
	rows, err := r.db.Query(`SELECT id, nickname, created_at, last_seen FROM users`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []*models.User
	for rows.Next() {
		user := &models.User{}
		err := rows.Scan(&user.ID, &user.Nickname, &user.CreatedAt, &user.LastSeen)
		if err != nil {
			return nil, err
		}
		users = append(users, user)
	}

	return users, rows.Err()
}
