package service

import (
	"errors"
	"log"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/orbital/internal/models"
	"github.com/orbital/internal/repository"
)

// CategoryService manages room categories
type CategoryService struct {
	categories map[string]*models.Category
	repo       *repository.CategoryRepository
	mu         sync.RWMutex
}

// NewCategoryService creates a new CategoryService
func NewCategoryService(repo *repository.CategoryRepository) *CategoryService {
	return &CategoryService{
		categories: make(map[string]*models.Category),
		repo:       repo,
	}
}

// LoadFromDB loads all categories from the database into memory
func (cs *CategoryService) LoadFromDB() error {
	cs.mu.Lock()
	defer cs.mu.Unlock()

	// Clear existing categories
	cs.categories = make(map[string]*models.Category)

	// Load from database
	categories, err := cs.repo.GetAll()
	if err != nil {
		return err
	}

	// Populate memory map
	for _, category := range categories {
		cs.categories[category.ID] = category
	}

	// If no categories exist, create the default "general" category
	if len(cs.categories) == 0 {
		generalID := generateID()
		generalCategory := &models.Category{
			ID:        generalID,
			Name:      "general",
			CreatedAt: time.Now(),
		}

		// Save to database
		if err := cs.repo.Create(generalCategory); err != nil {
			return err
		}

		// Add to memory
		cs.categories[generalID] = generalCategory
		log.Printf("Created default 'general' category: %s", generalID)
	}

	log.Printf("Loaded %d categories from database", len(cs.categories))
	return nil
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

	// Save to database first
	if cs.repo != nil {
		if err := cs.repo.Create(category); err != nil {
			return nil, err
		}
	}

	cs.categories[categoryID] = category
	log.Printf("Created category: %s (%s)", categoryID, name)

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

	// Update in database
	if cs.repo != nil {
		if err := cs.repo.Update(category); err != nil {
			return nil, err
		}
	}

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

	// Delete from database
	if cs.repo != nil {
		if err := cs.repo.Delete(categoryID); err != nil {
			return "", err
		}
	}

	// Delete from memory
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
