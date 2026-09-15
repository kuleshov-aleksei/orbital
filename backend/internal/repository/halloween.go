package repository

import (
	"database/sql"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

// DeletedUserPlaceholder replaces a user_id in halloween_game_results when a
// guest is purged. Rewards are deleted, results are kept for history.
const DeletedUserPlaceholder = "<DELETED>"

type HalloweenRepository struct {
	db *storage.DB
}

func NewHalloweenRepository(db *storage.DB) *HalloweenRepository {
	return &HalloweenRepository{db: db}
}

func (r *HalloweenRepository) GetAllItems() ([]*models.HalloweenItem, error) {
	rows, err := r.db.Query(
		`SELECT id, name, socket, rarity, sort_order FROM halloween_items ORDER BY sort_order, id`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []*models.HalloweenItem
	for rows.Next() {
		item := &models.HalloweenItem{}
		if err := rows.Scan(&item.ID, &item.Name, &item.Socket, &item.Rarity, &item.SortOrder); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *HalloweenRepository) GetItemsByRarity(rarity string) ([]*models.HalloweenItem, error) {
	rows, err := r.db.Query(
		`SELECT id, name, socket, rarity, sort_order FROM halloween_items WHERE rarity = ? ORDER BY sort_order, id`,
		rarity,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []*models.HalloweenItem
	for rows.Next() {
		item := &models.HalloweenItem{}
		if err := rows.Scan(&item.ID, &item.Name, &item.Socket, &item.Rarity, &item.SortOrder); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *HalloweenRepository) GetItem(id string) (*models.HalloweenItem, error) {
	item := &models.HalloweenItem{}
	err := r.db.QueryRow(
		`SELECT id, name, socket, rarity, sort_order FROM halloween_items WHERE id = ?`,
		id,
	).Scan(&item.ID, &item.Name, &item.Socket, &item.Rarity, &item.SortOrder)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return item, nil
}

func (r *HalloweenRepository) GetPumpkinState(userID string) (*models.PumpkinState, error) {
	state := &models.PumpkinState{}
	var updatedAt time.Time

	err := r.db.QueryRow(
		`SELECT user_id, equipped_json, updated_at FROM halloween_pumpkins WHERE user_id = ?`,
		userID,
	).Scan(&state.UserID, &state.Equipped, &updatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	state.UpdatedAt = updatedAt
	return state, nil
}

func (r *HalloweenRepository) UpsertPumpkinState(userID string, equippedJSON string) error {
	_, err := r.db.Exec(
		`INSERT INTO halloween_pumpkins (user_id, equipped_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
		 ON CONFLICT(user_id) DO UPDATE SET equipped_json = excluded.equipped_json, updated_at = CURRENT_TIMESTAMP`,
		userID, equippedJSON,
	)
	return err
}

func (r *HalloweenRepository) GetOwnedItems(userID string) ([]*models.HalloweenOwnedItem, error) {
	rows, err := r.db.Query(
		`SELECT item_id FROM halloween_rewards WHERE user_id = ? ORDER BY granted_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var owned []*models.HalloweenOwnedItem
	for rows.Next() {
		item := &models.HalloweenOwnedItem{}
		if err := rows.Scan(&item.ItemID); err != nil {
			return nil, err
		}
		owned = append(owned, item)
	}
	return owned, rows.Err()
}

func (r *HalloweenRepository) OwnsItem(userID string, itemID string) (bool, error) {
	var exists int
	err := r.db.QueryRow(
		`SELECT COUNT(1) FROM halloween_rewards WHERE user_id = ? AND item_id = ?`,
		userID, itemID,
	).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists > 0, nil
}

// SubmitGameResult inserts a game result and its granted rewards in one
// transaction. Granted items that the user already owns are skipped
// (INSERT OR IGNORE on the per-user no-duplicate pool).
func (r *HalloweenRepository) SubmitGameResult(result *models.GameResult, granted []string) (int64, error) {
	var gameID int64
	err := r.db.Transaction(func(tx *sql.Tx) error {
		res, err := tx.Exec(
			`INSERT INTO halloween_game_results (user_id, completed_rounds, score, is_incomplete, is_cheater, report_json, reward_json)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			result.UserID, result.CompletedRounds, result.Score, result.IsIncomplete, result.IsCheater,
			result.ReportJSON, result.RewardJSON,
		)
		if err != nil {
			return err
		}

		gameID, err = res.LastInsertId()
		if err != nil {
			return err
		}

		for _, itemID := range granted {
			if _, err := tx.Exec(
				`INSERT OR IGNORE INTO halloween_rewards (user_id, item_id, source, game_id)
				 VALUES (?, ?, 'game', ?)`,
				result.UserID, itemID, gameID,
			); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return gameID, nil
}

func (r *HalloweenRepository) GetLeaderboard(limit int) ([]*models.HalloweenLeaderboardEntry, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := r.db.Query(
		`SELECT gr.user_id, COALESCE(u.nickname, ?) AS nickname, MAX(gr.score) AS best_score, MAX(gr.completed_rounds) AS completed_rounds
		 FROM halloween_game_results gr
		 LEFT JOIN users u ON u.id = gr.user_id
		 WHERE gr.is_cheater = 0
		 GROUP BY gr.user_id
		 ORDER BY best_score DESC
		 LIMIT ?`,
		DeletedUserPlaceholder, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []*models.HalloweenLeaderboardEntry
	for rows.Next() {
		entry := &models.HalloweenLeaderboardEntry{}
		if err := rows.Scan(&entry.UserID, &entry.Nickname, &entry.BestScore, &entry.CompletedRounds); err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func (r *HalloweenRepository) GetAllGameResults() ([]*models.GameResult, error) {
	rows, err := r.db.Query(
		`SELECT id, user_id, completed_rounds, score, is_incomplete, is_cheater, report_json, reward_json, created_at
		 FROM halloween_game_results ORDER BY created_at DESC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []*models.GameResult
	for rows.Next() {
		result := &models.GameResult{}
		var createdAt time.Time
		var rewardJSON sql.NullString

		if err := rows.Scan(
			&result.ID, &result.UserID, &result.CompletedRounds, &result.Score,
			&result.IsIncomplete, &result.IsCheater, &result.ReportJSON, &rewardJSON, &createdAt,
		); err != nil {
			return nil, err
		}

		result.RewardJSON = rewardJSON.String
		result.CreatedAt = createdAt
		results = append(results, result)
	}
	return results, rows.Err()
}

// IssueReward grants an item directly (admin). Returns false if the user
// already owns the item (per-user no-duplicate pool).
func (r *HalloweenRepository) IssueReward(userID string, itemID string) (bool, error) {
	result, err := r.db.Exec(
		`INSERT OR IGNORE INTO halloween_rewards (user_id, item_id, source, game_id) VALUES (?, ?, 'admin', NULL)`,
		userID, itemID,
	)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return affected > 0, nil
}

// PurgeUser is called when a user is deleted. Game history is preserved with a
// placeholder user_id; rewards and pumpkin state are removed.
func (r *HalloweenRepository) PurgeUser(userID string) error {
	return r.db.Transaction(func(tx *sql.Tx) error {
		if _, err := tx.Exec(
			`UPDATE halloween_game_results SET user_id = ? WHERE user_id = ?`,
			DeletedUserPlaceholder, userID,
		); err != nil {
			return err
		}
		if _, err := tx.Exec(
			`DELETE FROM halloween_rewards WHERE user_id = ?`,
			userID,
		); err != nil {
			return err
		}
		if _, err := tx.Exec(
			`DELETE FROM halloween_pumpkins WHERE user_id = ?`,
			userID,
		); err != nil {
			return err
		}
		return nil
	})
}
