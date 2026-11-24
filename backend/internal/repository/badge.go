package repository

import (
	"database/sql"
	"errors"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

// BadgeRepository stores badge definitions and who holds them. SQLite foreign
// keys are not enforced, so every path that removes rows does it explicitly.
type BadgeRepository struct {
	db *storage.DB
}

// ErrBadgeNotHeld means the user tried to display a badge they don't hold.
var ErrBadgeNotHeld = errors.New("badge is not one of the user's badges")

func NewBadgeRepository(db *storage.DB) *BadgeRepository {
	return &BadgeRepository{db: db}
}

const badgeColumns = `id, name, description, filename, file_size, created_by, created_at`

func scanBadge(row rowScanner) (*models.Badge, error) {
	b := &models.Badge{}
	var createdBy sql.NullString
	if err := row.Scan(&b.ID, &b.Name, &b.Description, &b.Filename, &b.FileSize, &createdBy, &b.CreatedAt); err != nil {
		return nil, err
	}
	b.CreatedBy = createdBy.String
	return b, nil
}

func (r *BadgeRepository) Create(b *models.Badge) error {
	_, err := r.db.Exec(
		`INSERT INTO badges (`+badgeColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		b.ID, b.Name, b.Description, b.Filename, b.FileSize, b.CreatedBy, b.CreatedAt,
	)
	return err
}

// GetByID returns (nil, nil) when the badge does not exist.
func (r *BadgeRepository) GetByID(id string) (*models.Badge, error) {
	b, err := scanBadge(r.db.QueryRow(`SELECT `+badgeColumns+` FROM badges WHERE id = ?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return b, err
}

// List returns every badge in upload order (the order clients display).
func (r *BadgeRepository) List() ([]*models.Badge, error) {
	rows, err := r.db.Query(`SELECT ` + badgeColumns + ` FROM badges ORDER BY created_at ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	badges := []*models.Badge{}
	for rows.Next() {
		b, err := scanBadge(rows)
		if err != nil {
			return nil, err
		}
		badges = append(badges, b)
	}
	return badges, rows.Err()
}

// NameTaken reports whether another badge already uses name (case-insensitive).
// exceptID lets an edit keep its own name.
func (r *BadgeRepository) NameTaken(name, exceptID string) (bool, error) {
	var n int
	err := r.db.QueryRow(
		`SELECT COUNT(*) FROM badges WHERE lower(name) = lower(?) AND id != ?`, name, exceptID,
	).Scan(&n)
	return n > 0, err
}

func (r *BadgeRepository) Update(b *models.Badge) error {
	_, err := r.db.Exec(
		`UPDATE badges SET name = ?, description = ? WHERE id = ?`,
		b.Name, b.Description, b.ID,
	)
	return err
}

// UpdateFile points a badge at a re-encoded image file. Returns sql.ErrNoRows
// when the badge was deleted meanwhile.
func (r *BadgeRepository) UpdateFile(id, filename string, fileSize int64) error {
	res, err := r.db.Exec(
		`UPDATE badges SET filename = ?, file_size = ? WHERE id = ?`, filename, fileSize, id,
	)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// Delete removes the badge and every assignment of it.
func (r *BadgeRepository) Delete(id string) error {
	return r.db.Transaction(func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DELETE FROM user_badges WHERE badge_id = ?`, id); err != nil {
			return err
		}
		_, err := tx.Exec(`DELETE FROM badges WHERE id = ?`, id)
		return err
	})
}

// Assignments returns every user's badges with their award dates.
func (r *BadgeRepository) Assignments() (models.BadgeAssignments, error) {
	rows, err := r.db.Query(
		`SELECT user_id, badge_id, assigned_at, displayed FROM user_badges ORDER BY assigned_at ASC, badge_id ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	out := models.BadgeAssignments{}
	for rows.Next() {
		var userID string
		var ub models.UserBadge
		if err := rows.Scan(&userID, &ub.BadgeID, &ub.AssignedAt, &ub.Displayed); err != nil {
			return nil, err
		}
		out[userID] = append(out[userID], ub)
	}
	return out, rows.Err()
}

// UserBadges returns one user's badges.
func (r *BadgeRepository) UserBadges(userID string) ([]models.UserBadge, error) {
	rows, err := r.db.Query(
		`SELECT badge_id, assigned_at, displayed FROM user_badges WHERE user_id = ? ORDER BY assigned_at ASC, badge_id ASC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	out := []models.UserBadge{}
	for rows.Next() {
		var ub models.UserBadge
		if err := rows.Scan(&ub.BadgeID, &ub.AssignedAt, &ub.Displayed); err != nil {
			return nil, err
		}
		out = append(out, ub)
	}
	return out, rows.Err()
}

// SetDisplayedBadge pins one of the user's badges ("" clears the pin, so
// clients show the newest award again). errBadgeNotHeld is returned when the
// badge is not one the user holds.
func (r *BadgeRepository) SetDisplayedBadge(userID, badgeID string) ([]models.UserBadge, error) {
	err := r.db.Transaction(func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE user_badges SET displayed = 0 WHERE user_id = ?`, userID); err != nil {
			return err
		}
		if badgeID == "" {
			return nil
		}
		res, err := tx.Exec(
			`UPDATE user_badges SET displayed = 1 WHERE user_id = ? AND badge_id = ?`,
			userID, badgeID,
		)
		if err != nil {
			return err
		}
		if n, err := res.RowsAffected(); err == nil && n == 0 {
			return ErrBadgeNotHeld
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return r.UserBadges(userID)
}

// ReplaceUserBadges makes the user hold exactly badgeIDs. Badges that stay
// keep their original assigned_at, so re-saving a picker never rewrites when a
// badge was awarded.
func (r *BadgeRepository) ReplaceUserBadges(userID string, badgeIDs []string, assignedBy string) ([]models.UserBadge, error) {
	want := make(map[string]struct{}, len(badgeIDs))
	for _, id := range badgeIDs {
		want[id] = struct{}{}
	}

	existing, err := r.UserBadges(userID)
	if err != nil {
		return nil, err
	}

	keep := make(map[string]struct{}, len(existing))
	for _, ub := range existing {
		if _, ok := want[ub.BadgeID]; ok {
			keep[ub.BadgeID] = struct{}{}
		} else if _, err := r.db.Exec(`DELETE FROM user_badges WHERE user_id = ? AND badge_id = ?`, userID, ub.BadgeID); err != nil {
			return nil, err
		}
	}

	now := time.Now()
	for _, id := range badgeIDs {
		if _, ok := keep[id]; ok {
			continue
		}
		if _, err := r.db.Exec(
			`INSERT OR IGNORE INTO user_badges (user_id, badge_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?)`,
			userID, id, assignedBy, now,
		); err != nil {
			return nil, err
		}
	}

	// Re-read so returned dates are exactly what is stored.
	return r.UserBadges(userID)
}
