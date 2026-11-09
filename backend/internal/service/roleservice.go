package service

import (
	"errors"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
)

// RoleService handles user role management
type RoleService struct {
	userRepo *repository.UserRepository
}

// NewRoleService creates a new role service
func NewRoleService(userRepo *repository.UserRepository) *RoleService {
	return &RoleService{
		userRepo: userRepo,
	}
}

// IsSuperAdmin checks if user is super_admin
func (s *RoleService) IsSuperAdmin(userID string) (bool, error) {
	role, err := s.GetUserRole(userID)
	if err != nil {
		return false, err
	}
	return role == models.RoleSuperAdmin, nil
}

// GetUserRole gets the role of a user
func (s *RoleService) GetUserRole(userID string) (string, error) {
	user, err := s.userRepo.GetByID(userID)
	if err != nil {
		return "", err
	}
	if user == nil {
		return "", errors.New("user not found")
	}
	return user.Role, nil
}

// AssignSuperAdminIfFirst makes the first non-guest user super_admin
func (s *RoleService) AssignSuperAdminIfFirst(userID string) error {
	// Check if any super_admin already exists
	hasSuperAdmin, err := s.userRepo.HasSuperAdmin()
	if err != nil {
		return err
	}

	// If super_admin already exists, do nothing
	if hasSuperAdmin {
		return nil
	}

	// Get the user
	user, err := s.userRepo.GetByID(userID)
	if err != nil {
		return err
	}
	if user == nil {
		return errors.New("user not found")
	}

	// Only non-guest users can become super_admin
	if user.IsGuest {
		return nil
	}

	// Make this user super_admin
	return s.userRepo.UpdateRole(userID, models.RoleSuperAdmin)
}
