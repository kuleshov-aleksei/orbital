package repository

import (
	"database/sql"
	"encoding/json"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

type SoundboardRepository struct {
	db *storage.DB
}

func NewSoundboardRepository(db *storage.DB) *SoundboardRepository {
	return &SoundboardRepository{db: db}
}

const soundboardColumns = `id, name, emoji, aliases, filename, format, file_size, uploaded_by, created_at`

type rowScanner interface {
	Scan(dest ...any) error
}

func scanSoundboardSound(row rowScanner) (*models.SoundboardSound, error) {
	s := &models.SoundboardSound{}
	var aliases string
	var uploadedBy sql.NullString
	var createdAt time.Time
	if err := row.Scan(&s.ID, &s.Name, &s.Emoji, &aliases, &s.Filename, &s.Format, &s.FileSize, &uploadedBy, &createdAt); err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(aliases), &s.Aliases); err != nil || s.Aliases == nil {
		s.Aliases = []string{}
	}
	s.UploadedBy = uploadedBy.String
	s.CreatedAt = createdAt
	return s, nil
}

func (r *SoundboardRepository) Create(s *models.SoundboardSound) error {
	aliases, err := json.Marshal(s.Aliases)
	if err != nil {
		return err
	}
	_, err = r.db.Exec(
		`INSERT INTO soundboard_sounds (`+soundboardColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		s.ID, s.Name, s.Emoji, string(aliases), s.Filename, s.Format, s.FileSize, s.UploadedBy, s.CreatedAt,
	)
	return err
}

// GetByID returns (nil, nil) when the sound does not exist.
func (r *SoundboardRepository) GetByID(id string) (*models.SoundboardSound, error) {
	s, err := scanSoundboardSound(r.db.QueryRow(`SELECT `+soundboardColumns+` FROM soundboard_sounds WHERE id = ?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return s, err
}

func (r *SoundboardRepository) List() ([]*models.SoundboardSound, error) {
	rows, err := r.db.Query(`SELECT ` + soundboardColumns + ` FROM soundboard_sounds ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	sounds := []*models.SoundboardSound{}
	for rows.Next() {
		s, err := scanSoundboardSound(rows)
		if err != nil {
			return nil, err
		}
		sounds = append(sounds, s)
	}
	return sounds, rows.Err()
}

func (r *SoundboardRepository) Count() (int, error) {
	var n int
	err := r.db.QueryRow(`SELECT COUNT(*) FROM soundboard_sounds`).Scan(&n)
	return n, err
}

func (r *SoundboardRepository) Update(s *models.SoundboardSound) error {
	aliases, err := json.Marshal(s.Aliases)
	if err != nil {
		return err
	}
	_, err = r.db.Exec(`UPDATE soundboard_sounds SET name = ?, emoji = ?, aliases = ? WHERE id = ?`,
		s.Name, s.Emoji, string(aliases), s.ID)
	return err
}

// UpdateAudio points a sound at a new stored file.
func (r *SoundboardRepository) UpdateAudio(s *models.SoundboardSound) error {
	_, err := r.db.Exec(`UPDATE soundboard_sounds SET filename = ?, format = ?, file_size = ? WHERE id = ?`,
		s.Filename, s.Format, s.FileSize, s.ID)
	return err
}

func (r *SoundboardRepository) Delete(id string) error {
	_, err := r.db.Exec(`DELETE FROM soundboard_sounds WHERE id = ?`, id)
	return err
}
