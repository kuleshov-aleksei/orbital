package repository

import (
	"database/sql"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

// CategoryRepository handles database operations for categories
type CategoryRepository struct {
	db *storage.DB
}

// NewCategoryRepository creates a new category repository
func NewCategoryRepository(db *storage.DB) *CategoryRepository {
	return &CategoryRepository{db: db}
}

// Create inserts a new category into the database
func (r *CategoryRepository) Create(category *models.Category) error {
	_, err := r.db.Exec(
		`INSERT INTO categories (id, name, created_at, sort_order) VALUES (?, ?, ?, ?)`,
		category.ID, category.Name, category.CreatedAt, category.SortOrder,
	)
	return err
}

// GetByID retrieves a category by ID
func (r *CategoryRepository) GetByID(id string) (*models.Category, error) {
	category := &models.Category{}
	err := r.db.QueryRow(
		`SELECT id, name, created_at, sort_order FROM categories WHERE id = ?`,
		id,
	).Scan(&category.ID, &category.Name, &category.CreatedAt, &category.SortOrder)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return category, nil
}

// GetByName retrieves a category by name
func (r *CategoryRepository) GetByName(name string) (*models.Category, error) {
	category := &models.Category{}
	err := r.db.QueryRow(
		`SELECT id, name, created_at, sort_order FROM categories WHERE name = ?`,
		name,
	).Scan(&category.ID, &category.Name, &category.CreatedAt, &category.SortOrder)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return category, nil
}

// Update updates a category's name and sort_order
func (r *CategoryRepository) Update(category *models.Category) error {
	_, err := r.db.Exec(
		`UPDATE categories SET name = ?, sort_order = ? WHERE id = ?`,
		category.Name, category.SortOrder, category.ID,
	)
	return err
}

// Delete removes a category from the database
func (r *CategoryRepository) Delete(id string) error {
	_, err := r.db.Exec(`DELETE FROM categories WHERE id = ?`, id)
	return err
}

// GetAll retrieves all categories from the database ordered by sort_order
func (r *CategoryRepository) GetAll() ([]*models.Category, error) {
	rows, err := r.db.Query(`SELECT id, name, created_at, sort_order FROM categories ORDER BY sort_order ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var categories []*models.Category
	for rows.Next() {
		category := &models.Category{}
		err := rows.Scan(&category.ID, &category.Name, &category.CreatedAt, &category.SortOrder)
		if err != nil {
			return nil, err
		}
		categories = append(categories, category)
	}

	return categories, rows.Err()
}

// UpdateSortOrder updates the sort order of a specific category
func (r *CategoryRepository) UpdateSortOrder(categoryID string, sortOrder int) error {
	_, err := r.db.Exec(
		`UPDATE categories SET sort_order = ? WHERE id = ?`,
		sortOrder, categoryID,
	)
	return err
}

// UpdateSortOrders updates the sort order of multiple categories in a transaction
func (r *CategoryRepository) UpdateSortOrders(updates map[string]int) error {
	return r.db.Transaction(func(tx *sql.Tx) error {
		for categoryID, sortOrder := range updates {
			_, err := tx.Exec(
				`UPDATE categories SET sort_order = ? WHERE id = ?`,
				sortOrder, categoryID,
			)
			if err != nil {
				return err
			}
		}
		return nil
	})
}
