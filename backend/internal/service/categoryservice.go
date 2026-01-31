package service

import (
	"errors"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/orbital/internal/models"
)

// CategoryService manages room categories
type CategoryService struct {
	categories map[string]*models.Category
	mu         sync.RWMutex
}

// NewCategoryService creates a new CategoryService with a default "general" category
func NewCategoryService() *CategoryService {
	cs := &CategoryService{
		categories: make(map[string]*models.Category),
	}

	// Create default "general" category
	generalID := generateID()
	cs.categories[generalID] = &models.Category{
		ID:        generalID,
		Name:      "general",
		CreatedAt: time.Now(),
	}

	return cs
}

// Reset clears all categories and reinitializes with default.
// Intended for test environments only.
func (cs *CategoryService) Reset() {
	cs.mu.Lock()
	defer cs.mu.Unlock()

	cs.categories = make(map[string]*models.Category)

	// Re-create default "general" category
	generalID := generateID()
	cs.categories[generalID] = &models.Category{
		ID:        generalID,
		Name:      "general",
		CreatedAt: time.Now(),
	}
}

// CreateCategory creates a new category
func (cs *CategoryService) CreateCategory(name string) (*models.Category, error) {
	// Validate name length (max 32 characters)
	if utf8.RuneCountInString(name) > 32 {
		return nil, errors.New("category name exceeds maximum length of 32 characters")
	}

	// Validate name is not empty
	if name == "" {
		return nil, errors.New("category name cannot be empty")
	}

	cs.mu.Lock()
	defer cs.mu.Unlock()

	categoryID := generateID()
	category := &models.Category{
		ID:        categoryID,
		Name:      name,
		CreatedAt: time.Now(),
	}

	cs.categories[categoryID] = category

	return category, nil
}

// GetCategories returns all categories
func (cs *CategoryService) GetCategories() []models.Category {
	cs.mu.RLock()
	defer cs.mu.RUnlock()

	categories := make([]models.Category, 0, len(cs.categories))
	for _, category := range cs.categories {
		categories = append(categories, *category)
	}

	return categories
}

// GetCategory returns a specific category by ID
func (cs *CategoryService) GetCategory(categoryID string) (*models.Category, bool) {
	cs.mu.RLock()
	defer cs.mu.RUnlock()

	category, exists := cs.categories[categoryID]
	return category, exists
}

// RenameCategory renames a category
func (cs *CategoryService) RenameCategory(categoryID string, newName string) (*models.Category, error) {
	// Validate name length (max 32 characters)
	if utf8.RuneCountInString(newName) > 32 {
		return nil, errors.New("category name exceeds maximum length of 32 characters")
	}

	// Validate name is not empty
	if newName == "" {
		return nil, errors.New("category name cannot be empty")
	}

	cs.mu.Lock()
	defer cs.mu.Unlock()

	category, exists := cs.categories[categoryID]
	if !exists {
		return nil, errors.New("category not found")
	}

	category.Name = newName
	return category, nil
}

// DeleteCategory deletes a category and optionally its rooms or migrates them
// Returns the target category ID for migrations, or empty string if rooms were deleted
func (cs *CategoryService) DeleteCategory(categoryID string, deleteRooms bool, targetCategoryID string) (string, error) {
	cs.mu.Lock()
	defer cs.mu.Unlock()

	// Check if category exists
	if _, exists := cs.categories[categoryID]; !exists {
		return "", errors.New("category not found")
	}

	// Cannot delete the general category
	for id, cat := range cs.categories {
		if id == categoryID && cat.Name == "general" {
			return "", errors.New("cannot delete the default 'general' category")
		}
	}

	// If not deleting rooms, validate target category
	if !deleteRooms {
		if targetCategoryID == "" {
			// Find general category as default
			for id, cat := range cs.categories {
				if cat.Name == "general" {
					targetCategoryID = id
					break
				}
			}
		}

		if targetCategoryID == categoryID {
			return "", errors.New("cannot migrate rooms to the category being deleted")
		}

		if _, exists := cs.categories[targetCategoryID]; !exists {
			return "", errors.New("target category not found")
		}
	}

	// Delete the category
	delete(cs.categories, categoryID)

	if deleteRooms {
		return "", nil
	}

	return targetCategoryID, nil
}

// GetGeneralCategoryID returns the ID of the general category
func (cs *CategoryService) GetGeneralCategoryID() string {
	cs.mu.RLock()
	defer cs.mu.RUnlock()

	for id, cat := range cs.categories {
		if cat.Name == "general" {
			return id
		}
	}

	return ""
}
