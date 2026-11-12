package repository

import (
	"database/sql"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

// RBACRepository handles roles, user role assignments and permission overwrites.
type RBACRepository struct {
	db *storage.DB
}

// NewRBACRepository creates a new RBAC repository
func NewRBACRepository(db *storage.DB) *RBACRepository {
	return &RBACRepository{db: db}
}

// GetRoles returns every role ordered by position (highest first).
func (r *RBACRepository) GetRoles() ([]*models.Role, error) {
	rows, err := r.db.Query(`SELECT id, name, color, position, permissions, deny_permissions, system_key, created_at FROM roles ORDER BY position DESC, created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var roles []*models.Role
	for rows.Next() {
		role := &models.Role{}
		var systemKey sql.NullString
		var perms, deny int64
		if err := rows.Scan(&role.ID, &role.Name, &role.Color, &role.Position, &perms, &deny, &systemKey, &role.CreatedAt); err != nil {
			return nil, err
		}
		role.Permissions = uint64(perms)
		role.DenyPermissions = uint64(deny)
		role.SystemKey = systemKey.String
		roles = append(roles, role)
	}
	return roles, rows.Err()
}

// CreateRole inserts a new (non-system) role.
func (r *RBACRepository) CreateRole(role *models.Role) error {
	_, err := r.db.Exec(
		`INSERT INTO roles (id, name, color, position, permissions, deny_permissions, system_key, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
		role.ID, role.Name, role.Color, role.Position, int64(role.Permissions), int64(role.DenyPermissions), role.CreatedAt,
	)
	return err
}

// UpdateRole updates a role's mutable fields.
func (r *RBACRepository) UpdateRole(role *models.Role) error {
	_, err := r.db.Exec(
		`UPDATE roles SET name = ?, color = ?, position = ?, permissions = ?, deny_permissions = ? WHERE id = ?`,
		role.Name, role.Color, role.Position, int64(role.Permissions), int64(role.DenyPermissions), role.ID,
	)
	return err
}

// UpdateRolePositions sets positions for many roles atomically.
func (r *RBACRepository) UpdateRolePositions(positions map[string]int) error {
	return r.db.Transaction(func(tx *sql.Tx) error {
		for id, pos := range positions {
			if _, err := tx.Exec(`UPDATE roles SET position = ? WHERE id = ?`, pos, id); err != nil {
				return err
			}
		}
		return nil
	})
}

// DeleteRole removes a role together with its assignments and overwrites.
func (r *RBACRepository) DeleteRole(id string) error {
	return r.db.Transaction(func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DELETE FROM user_roles WHERE role_id = ?`, id); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM user_color_roles WHERE role_id = ?`, id); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM permission_overwrites WHERE subject_type = 'role' AND subject_id = ?`, id); err != nil {
			return err
		}
		_, err := tx.Exec(`DELETE FROM roles WHERE id = ?`, id)
		return err
	})
}

// GetUserRoles returns user_id -> role IDs for every assignment.
func (r *RBACRepository) GetUserRoles() (map[string][]string, error) {
	rows, err := r.db.Query(`SELECT user_id, role_id FROM user_roles`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	out := make(map[string][]string)
	for rows.Next() {
		var userID, roleID string
		if err := rows.Scan(&userID, &roleID); err != nil {
			return nil, err
		}
		out[userID] = append(out[userID], roleID)
	}
	return out, rows.Err()
}

// SetUserRoles replaces the full set of roles assigned to a user.
func (r *RBACRepository) SetUserRoles(userID string, roleIDs []string) error {
	return r.db.Transaction(func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DELETE FROM user_roles WHERE user_id = ?`, userID); err != nil {
			return err
		}
		for _, roleID := range roleIDs {
			if _, err := tx.Exec(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, userID, roleID); err != nil {
				return err
			}
		}
		return nil
	})
}

// GetColorRoles returns user_id -> the role picked to color their nickname.
func (r *RBACRepository) GetColorRoles() (map[string]string, error) {
	rows, err := r.db.Query(`SELECT user_id, role_id FROM user_color_roles`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	out := make(map[string]string)
	for rows.Next() {
		var userID, roleID string
		if err := rows.Scan(&userID, &roleID); err != nil {
			return nil, err
		}
		out[userID] = roleID
	}
	return out, rows.Err()
}

// SetColorRole stores the role coloring a user's nickname; an empty roleID
// clears the pick (back to the highest colored role).
func (r *RBACRepository) SetColorRole(userID, roleID string) error {
	if roleID == "" {
		_, err := r.db.Exec(`DELETE FROM user_color_roles WHERE user_id = ?`, userID)
		return err
	}
	_, err := r.db.Exec(`INSERT INTO user_color_roles (user_id, role_id) VALUES (?, ?)
		ON CONFLICT(user_id) DO UPDATE SET role_id = excluded.role_id`, userID, roleID)
	return err
}

// GetOverwrites returns every permission overwrite.
func (r *RBACRepository) GetOverwrites() ([]*models.PermissionOverwrite, error) {
	rows, err := r.db.Query(`SELECT target_type, target_id, subject_type, subject_id, allow, deny FROM permission_overwrites`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []*models.PermissionOverwrite
	for rows.Next() {
		o := &models.PermissionOverwrite{}
		var allow, deny int64
		if err := rows.Scan(&o.TargetType, &o.TargetID, &o.SubjectType, &o.SubjectID, &allow, &deny); err != nil {
			return nil, err
		}
		o.Allow = uint64(allow)
		o.Deny = uint64(deny)
		out = append(out, o)
	}
	return out, rows.Err()
}

// UpsertOverwrite creates or replaces one overwrite.
func (r *RBACRepository) UpsertOverwrite(o *models.PermissionOverwrite) error {
	_, err := r.db.Exec(
		`INSERT INTO permission_overwrites (target_type, target_id, subject_type, subject_id, allow, deny) VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(target_type, target_id, subject_type, subject_id) DO UPDATE SET allow = excluded.allow, deny = excluded.deny`,
		o.TargetType, o.TargetID, o.SubjectType, o.SubjectID, int64(o.Allow), int64(o.Deny),
	)
	return err
}

// DeleteOverwrite removes one overwrite.
func (r *RBACRepository) DeleteOverwrite(targetType, targetID, subjectType, subjectID string) error {
	_, err := r.db.Exec(
		`DELETE FROM permission_overwrites WHERE target_type = ? AND target_id = ? AND subject_type = ? AND subject_id = ?`,
		targetType, targetID, subjectType, subjectID,
	)
	return err
}

// ReplaceTargetOverwrites atomically replaces all overwrites of a room/category.
func (r *RBACRepository) ReplaceTargetOverwrites(targetType, targetID string, overwrites []*models.PermissionOverwrite) error {
	return r.db.Transaction(func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DELETE FROM permission_overwrites WHERE target_type = ? AND target_id = ?`, targetType, targetID); err != nil {
			return err
		}
		for _, o := range overwrites {
			if _, err := tx.Exec(
				`INSERT INTO permission_overwrites (target_type, target_id, subject_type, subject_id, allow, deny) VALUES (?, ?, ?, ?, ?, ?)`,
				targetType, targetID, o.SubjectType, o.SubjectID, int64(o.Allow), int64(o.Deny),
			); err != nil {
				return err
			}
		}
		return nil
	})
}
