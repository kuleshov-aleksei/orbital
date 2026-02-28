package repository

import (
	"database/sql"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

type DebugLogRepository struct {
	db *storage.DB
}

func NewDebugLogRepository(db *storage.DB) *DebugLogRepository {
	return &DebugLogRepository{db: db}
}

func (r *DebugLogRepository) Create(log *models.DebugLog) error {
	result, err := r.db.Exec(
		`INSERT INTO debug_logs (user_id, username, version, created_at, log_filename) VALUES (?, ?, ?, ?, ?)`,
		log.UserID, log.Username, log.Version, log.CreatedAt, log.LogFilename,
	)
	if err != nil {
		return err
	}

	id, err := result.LastInsertId()
	if err != nil {
		return err
	}

	log.ID = id
	return nil
}

func (r *DebugLogRepository) GetByID(id int64) (*models.DebugLog, error) {
	log := &models.DebugLog{}
	var createdAt time.Time

	err := r.db.QueryRow(
		`SELECT id, user_id, username, version, created_at, log_filename FROM debug_logs WHERE id = ?`,
		id,
	).Scan(&log.ID, &log.UserID, &log.Username, &log.Version, &createdAt, &log.LogFilename)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	log.CreatedAt = createdAt
	return log, nil
}

func (r *DebugLogRepository) GetAll() ([]*models.DebugLog, error) {
	rows, err := r.db.Query(
		`SELECT id, user_id, username, version, created_at, log_filename FROM debug_logs ORDER BY created_at DESC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []*models.DebugLog
	for rows.Next() {
		log := &models.DebugLog{}
		var createdAt time.Time

		err := rows.Scan(&log.ID, &log.UserID, &log.Username, &log.Version, &createdAt, &log.LogFilename)
		if err != nil {
			return nil, err
		}

		log.CreatedAt = createdAt
		logs = append(logs, log)
	}

	return logs, rows.Err()
}

func (r *DebugLogRepository) Delete(id int64) error {
	_, err := r.db.Exec(`DELETE FROM debug_logs WHERE id = ?`, id)
	return err
}
