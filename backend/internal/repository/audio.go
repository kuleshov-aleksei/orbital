package repository

import (
	"database/sql"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

type AudioRepository struct {
	db *storage.DB
}

func NewAudioRepository(db *storage.DB) *AudioRepository {
	return &AudioRepository{db: db}
}

func (r *AudioRepository) Create(file *models.AudioFile) error {
	_, err := r.db.Exec(
		`INSERT INTO audio_files (id, filename, display_name, uploaded_by, file_size, duration, is_system, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		file.ID, file.Filename, file.DisplayName, file.UploadedBy, file.FileSize, file.Duration, file.IsSystem, file.CreatedAt,
	)
	return err
}

func (r *AudioRepository) GetByID(id string) (*models.AudioFile, error) {
	file := &models.AudioFile{}
	var uploadedBy sql.NullString
	var createdAt time.Time

	err := r.db.QueryRow(
		`SELECT id, filename, display_name, uploaded_by, file_size, duration, is_system, created_at FROM audio_files WHERE id = ?`,
		id,
	).Scan(&file.ID, &file.Filename, &file.DisplayName, &uploadedBy, &file.FileSize, &file.Duration, &file.IsSystem, &createdAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	file.UploadedBy = uploadedBy.String
	file.CreatedAt = createdAt
	return file, nil
}

func (r *AudioRepository) GetAll() ([]*models.AudioFile, error) {
	rows, err := r.db.Query(
		`SELECT id, filename, display_name, uploaded_by, file_size, duration, is_system, created_at FROM audio_files ORDER BY is_system DESC, created_at DESC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var files []*models.AudioFile
	for rows.Next() {
		file := &models.AudioFile{}
		var uploadedBy sql.NullString
		var createdAt time.Time

		err := rows.Scan(&file.ID, &file.Filename, &file.DisplayName, &uploadedBy, &file.FileSize, &file.Duration, &file.IsSystem, &createdAt)
		if err != nil {
			return nil, err
		}

		file.UploadedBy = uploadedBy.String
		file.CreatedAt = createdAt
		files = append(files, file)
	}

	return files, rows.Err()
}

func (r *AudioRepository) GetByUserID(userID string) ([]*models.AudioFile, error) {
	rows, err := r.db.Query(
		`SELECT id, filename, display_name, uploaded_by, file_size, duration, is_system, created_at FROM audio_files WHERE uploaded_by = ? ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var files []*models.AudioFile
	for rows.Next() {
		file := &models.AudioFile{}
		var uploadedBy sql.NullString
		var createdAt time.Time

		err := rows.Scan(&file.ID, &file.Filename, &file.DisplayName, &uploadedBy, &file.FileSize, &file.Duration, &file.IsSystem, &createdAt)
		if err != nil {
			return nil, err
		}

		file.UploadedBy = uploadedBy.String
		file.CreatedAt = createdAt
		files = append(files, file)
	}

	return files, rows.Err()
}

func (r *AudioRepository) UpdateDisplayName(id string, displayName string) error {
	_, err := r.db.Exec(`UPDATE audio_files SET display_name = ? WHERE id = ?`, displayName, id)
	return err
}

func (r *AudioRepository) Delete(id string) error {
	_, err := r.db.Exec(`DELETE FROM audio_files WHERE id = ?`, id)
	return err
}
