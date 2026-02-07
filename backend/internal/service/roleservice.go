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

// IsAdmin checks if user is admin or super_admin
func (s *RoleService) IsAdmin(userID string) (bool, error) {
	role, err := s.GetUserRole(userID)
	if err != nil {
		return false, err
	}
	return role == models.RoleAdmin || role == models.RoleSuperAdmin, nil
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

// PromoteToAdmin promotes a user to admin (super_admin only)
func (s *RoleService) PromoteToAdmin(superAdminID, targetUserID string) error {
	// Verify superAdminID is actually a super_admin
	isSuperAdmin, err := s.IsSuperAdmin(superAdminID)
	if err != nil {
		return err
	}
	if !isSuperAdmin {
		return errors.New("only super admin can promote users")
	}

	// Verify target user exists
	targetUser, err := s.userRepo.GetByID(targetUserID)
	if err != nil {
		return err
	}
	if targetUser == nil {
		return errors.New("target user not found")
	}

	// Cannot promote super_admin
	if targetUser.Role == models.RoleSuperAdmin {
		return errors.New("cannot promote super admin")
	}

	// Promote to admin
	return s.userRepo.UpdateRole(targetUserID, models.RoleAdmin)
}

// DemoteToUser demotes an admin to regular user (super_admin only)
func (s *RoleService) DemoteToUser(superAdminID, targetUserID string) error {
	// Verify superAdminID is actually a super_admin
	isSuperAdmin, err := s.IsSuperAdmin(superAdminID)
	if err != nil {
		return err
	}
	if !isSuperAdmin {
		return errors.New("only super admin can demote users")
	}

	// Cannot demote self
	if superAdminID == targetUserID {
		return errors.New("cannot demote yourself")
	}

	// Verify target user exists
	targetUser, err := s.userRepo.GetByID(targetUserID)
	if err != nil {
		return err
	}
	if targetUser == nil {
		return errors.New("target user not found")
	}

	// Cannot demote super_admin
	if targetUser.Role == models.RoleSuperAdmin {
		return errors.New("cannot demote super admin")
	}

	// Cannot demote guests
	if targetUser.Role == models.RoleGuest {
		return errors.New("cannot demote guests")
	}

	// Demote to regular user
	return s.userRepo.UpdateRole(targetUserID, models.RoleUser)
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
