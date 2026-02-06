package repository

import (
	"database/sql"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

// RoomRepository handles database operations for rooms
type RoomRepository struct {
	db *storage.DB
}

// NewRoomRepository creates a new room repository
func NewRoomRepository(db *storage.DB) *RoomRepository {
	return &RoomRepository{db: db}
}

// Create inserts a new room into the database
func (r *RoomRepository) Create(room *models.Room) error {
	_, err := r.db.Exec(
		`INSERT INTO rooms (id, name, owner_id, max_users, created_at, category_id, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		room.ID, room.Name, room.OwnerID, room.MaxUsers, room.CreatedAt, room.Category, room.SortOrder,
	)
	return err
}

// GetByID retrieves a room by ID
func (r *RoomRepository) GetByID(id string) (*models.Room, error) {
	room := &models.Room{}
	var ownerID sql.NullString
	var categoryID sql.NullString

	err := r.db.QueryRow(
		`SELECT id, name, owner_id, max_users, created_at, category_id, sort_order FROM rooms WHERE id = ?`,
		id,
	).Scan(&room.ID, &room.Name, &ownerID, &room.MaxUsers, &room.CreatedAt, &categoryID, &room.SortOrder)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if ownerID.Valid {
		room.OwnerID = ownerID.String
	}
	if categoryID.Valid {
		room.Category = categoryID.String
	}

	return room, nil
}

// Update updates a room's information
func (r *RoomRepository) Update(room *models.Room) error {
	_, err := r.db.Exec(
		`UPDATE rooms SET name = ?, owner_id = ?, max_users = ?, category_id = ?, sort_order = ? WHERE id = ?`,
		room.Name, room.OwnerID, room.MaxUsers, room.Category, room.SortOrder, room.ID,
	)
	return err
}

// Delete removes a room from the database
func (r *RoomRepository) Delete(id string) error {
	_, err := r.db.Exec(`DELETE FROM rooms WHERE id = ?`, id)
	return err
}

// GetAll retrieves all rooms from the database ordered by sort_order
func (r *RoomRepository) GetAll() ([]*models.Room, error) {
	rows, err := r.db.Query(`SELECT id, name, owner_id, max_users, created_at, category_id, sort_order FROM rooms ORDER BY sort_order ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rooms []*models.Room
	for rows.Next() {
		room := &models.Room{}
		var ownerID sql.NullString
		var categoryID sql.NullString

		err := rows.Scan(&room.ID, &room.Name, &ownerID, &room.MaxUsers, &room.CreatedAt, &categoryID, &room.SortOrder)
		if err != nil {
			return nil, err
		}

		if ownerID.Valid {
			room.OwnerID = ownerID.String
		}
		if categoryID.Valid {
			room.Category = categoryID.String
		}

		rooms = append(rooms, room)
	}

	return rooms, rows.Err()
}

// GetByCategory retrieves all rooms in a specific category ordered by sort_order
func (r *RoomRepository) GetByCategory(categoryID string) ([]*models.Room, error) {
	rows, err := r.db.Query(
		`SELECT id, name, owner_id, max_users, created_at, category_id, sort_order FROM rooms WHERE category_id = ? ORDER BY sort_order ASC`,
		categoryID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rooms []*models.Room
	for rows.Next() {
		room := &models.Room{}
		var ownerID sql.NullString
		var catID sql.NullString

		err := rows.Scan(&room.ID, &room.Name, &ownerID, &room.MaxUsers, &room.CreatedAt, &catID, &room.SortOrder)
		if err != nil {
			return nil, err
		}

		if ownerID.Valid {
			room.OwnerID = ownerID.String
		}
		if catID.Valid {
			room.Category = catID.String
		}

		rooms = append(rooms, room)
	}

	return rooms, rows.Err()
}

// UpdateCategory updates the category of all rooms from one category to another
func (r *RoomRepository) UpdateCategory(oldCategoryID, newCategoryID string) error {
	_, err := r.db.Exec(
		`UPDATE rooms SET category_id = ? WHERE category_id = ?`,
		newCategoryID, oldCategoryID,
	)
	return err
}

// UpdateSortOrder updates the sort order of a specific room
func (r *RoomRepository) UpdateSortOrder(roomID string, sortOrder int) error {
	_, err := r.db.Exec(
		`UPDATE rooms SET sort_order = ? WHERE id = ?`,
		sortOrder, roomID,
	)
	return err
}

// UpdateSortOrders updates the sort order of multiple rooms in a transaction
func (r *RoomRepository) UpdateSortOrders(updates map[string]int) error {
	return r.db.Transaction(func(tx *sql.Tx) error {
		for roomID, sortOrder := range updates {
			_, err := tx.Exec(
				`UPDATE rooms SET sort_order = ? WHERE id = ?`,
				sortOrder, roomID,
			)
			if err != nil {
				return err
			}
		}
		return nil
	})
}
