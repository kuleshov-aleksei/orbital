package repository

import (
	"database/sql"
	"encoding/json"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

type EmojiRepository struct {
	db *storage.DB
}

func NewEmojiRepository(db *storage.DB) *EmojiRepository {
	return &EmojiRepository{db: db}
}

const emojiColumns = `id, name, aliases, filename, file_size, uploaded_by, created_at`

func scanCustomEmoji(row rowScanner) (*models.CustomEmoji, error) {
	e := &models.CustomEmoji{}
	var aliases string
	var uploadedBy sql.NullString
	var createdAt time.Time
	if err := row.Scan(&e.ID, &e.Name, &aliases, &e.Filename, &e.FileSize, &uploadedBy, &createdAt); err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(aliases), &e.Aliases); err != nil || e.Aliases == nil {
		e.Aliases = []string{}
	}
	e.UploadedBy = uploadedBy.String
	e.CreatedAt = createdAt
	return e, nil
}

func (r *EmojiRepository) Create(e *models.CustomEmoji) error {
	aliases, err := json.Marshal(e.Aliases)
	if err != nil {
		return err
	}
	_, err = r.db.Exec(
		`INSERT INTO custom_emojis (`+emojiColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		e.ID, e.Name, string(aliases), e.Filename, e.FileSize, e.UploadedBy, e.CreatedAt,
	)
	return err
}

// GetByID returns (nil, nil) when the emoji does not exist.
func (r *EmojiRepository) GetByID(id string) (*models.CustomEmoji, error) {
	e, err := scanCustomEmoji(r.db.QueryRow(`SELECT `+emojiColumns+` FROM custom_emojis WHERE id = ?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return e, err
}

func (r *EmojiRepository) List() ([]*models.CustomEmoji, error) {
	rows, err := r.db.Query(`SELECT ` + emojiColumns + ` FROM custom_emojis ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	emojis := []*models.CustomEmoji{}
	for rows.Next() {
		e, err := scanCustomEmoji(rows)
		if err != nil {
			return nil, err
		}
		emojis = append(emojis, e)
	}
	return emojis, rows.Err()
}

func (r *EmojiRepository) Count() (int, error) {
	var n int
	err := r.db.QueryRow(`SELECT COUNT(*) FROM custom_emojis`).Scan(&n)
	return n, err
}

func (r *EmojiRepository) Update(e *models.CustomEmoji) error {
	aliases, err := json.Marshal(e.Aliases)
	if err != nil {
		return err
	}
	_, err = r.db.Exec(`UPDATE custom_emojis SET name = ?, aliases = ? WHERE id = ?`, e.Name, string(aliases), e.ID)
	return err
}

func (r *EmojiRepository) Delete(id string) error {
	_, err := r.db.Exec(`DELETE FROM custom_emojis WHERE id = ?`, id)
	return err
}
