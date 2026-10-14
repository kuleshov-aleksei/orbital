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

func (r *HalloweenRepository) scanItem(rows *sql.Rows) (*models.HalloweenItem, error) {
	item := &models.HalloweenItem{}
	var assetPath sql.NullString
	var isDeleted sql.NullBool
	if err := rows.Scan(&item.ID, &item.Name, &item.Socket, &item.Rarity, &assetPath, &item.ZIndex, &isDeleted); err != nil {
		return nil, err
	}
	item.AssetPath = assetPath.String
	item.IsDeleted = isDeleted.Valid && isDeleted.Bool
	return item, nil
}

// GetAllItems returns live (non-soft-deleted) catalog items for clients.
func (r *HalloweenRepository) GetAllItems() ([]*models.HalloweenItem, error) {
	rows, err := r.db.Query(
		`SELECT id, name, socket, rarity, asset_path, z_index, is_deleted FROM halloween_items WHERE is_deleted = 0`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []*models.HalloweenItem
	for rows.Next() {
		item, err := r.scanItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// GetAllItemsAdmin returns every catalog row including soft-deleted ones.
func (r *HalloweenRepository) GetAllItemsAdmin() ([]*models.HalloweenItem, error) {
	rows, err := r.db.Query(
		`SELECT id, name, socket, rarity, asset_path, z_index, is_deleted FROM halloween_items`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []*models.HalloweenItem
	for rows.Next() {
		item, err := r.scanItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *HalloweenRepository) GetItemsByRarity(rarity string) ([]*models.HalloweenItem, error) {
	rows, err := r.db.Query(
		`SELECT id, name, socket, rarity, asset_path, z_index, is_deleted FROM halloween_items WHERE rarity = ? AND is_deleted = 0`,
		rarity,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []*models.HalloweenItem
	for rows.Next() {
		item, err := r.scanItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *HalloweenRepository) GetItem(id string) (*models.HalloweenItem, error) {
	item := &models.HalloweenItem{}
	var assetPath sql.NullString
	var isDeleted sql.NullBool
	err := r.db.QueryRow(
		`SELECT id, name, socket, rarity, asset_path, z_index, is_deleted FROM halloween_items WHERE id = ? AND is_deleted = 0`,
		id,
	).Scan(&item.ID, &item.Name, &item.Socket, &item.Rarity, &assetPath, &item.ZIndex, &isDeleted)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	item.AssetPath = assetPath.String
	item.IsDeleted = isDeleted.Valid && isDeleted.Bool
	return item, nil
}

// GetItemAdmin fetches a row regardless of soft-delete state.
func (r *HalloweenRepository) GetItemAdmin(id string) (*models.HalloweenItem, error) {
	item := &models.HalloweenItem{}
	var assetPath sql.NullString
	var isDeleted sql.NullBool
	err := r.db.QueryRow(
		`SELECT id, name, socket, rarity, asset_path, z_index, is_deleted FROM halloween_items WHERE id = ?`,
		id,
	).Scan(&item.ID, &item.Name, &item.Socket, &item.Rarity, &assetPath, &item.ZIndex, &isDeleted)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	item.AssetPath = assetPath.String
	item.IsDeleted = isDeleted.Valid && isDeleted.Bool
	return item, nil
}

func (r *HalloweenRepository) CreateItem(item *models.HalloweenItem) error {
	_, err := r.db.Exec(
		`INSERT INTO halloween_items (id, name, socket, rarity, asset_path, z_index, is_deleted) VALUES (?, ?, ?, ?, ?, ?, 0)`,
		item.ID, item.Name, item.Socket, item.Rarity, item.AssetPath, item.ZIndex,
	)
	return err
}

func (r *HalloweenRepository) UpdateItem(item *models.HalloweenItem) error {
	_, err := r.db.Exec(
		`UPDATE halloween_items SET name = ?, socket = ?, rarity = ?, z_index = ? WHERE id = ?`,
		item.Name, item.Socket, item.Rarity, item.ZIndex, item.ID,
	)
	return err
}

func (r *HalloweenRepository) SetItemAssetPath(id string, assetPath string) error {
	_, err := r.db.Exec(`UPDATE halloween_items SET asset_path = ? WHERE id = ?`, assetPath, id)
	return err
}

// SoftDeleteItem marks an item as deleted; live queries exclude it.
func (r *HalloweenRepository) SoftDeleteItem(id string) error {
	_, err := r.db.Exec(`UPDATE halloween_items SET is_deleted = 1 WHERE id = ?`, id)
	return err
}

func (r *HalloweenRepository) RestoreItem(id string) error {
	_, err := r.db.Exec(`UPDATE halloween_items SET is_deleted = 0 WHERE id = ?`, id)
	return err
}

// GetBaseSockets returns the socket anchors for one base (empty when unmapped).
func (r *HalloweenRepository) GetBaseSockets(baseID string) ([]*models.HalloweenBaseSocket, error) {
	rows, err := r.db.Query(
		`SELECT base_id, socket, offset_x, offset_y FROM halloween_base_sockets WHERE base_id = ?`,
		baseID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*models.HalloweenBaseSocket
	for rows.Next() {
		s := &models.HalloweenBaseSocket{}
		if err := rows.Scan(&s.BaseID, &s.Socket, &s.OffsetX, &s.OffsetY); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// GetAllBaseSockets returns every base layout row (client state payload).
func (r *HalloweenRepository) GetAllBaseSockets() ([]*models.HalloweenBaseSocket, error) {
	rows, err := r.db.Query(`SELECT base_id, socket, offset_x, offset_y FROM halloween_base_sockets`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*models.HalloweenBaseSocket
	for rows.Next() {
		s := &models.HalloweenBaseSocket{}
		if err := rows.Scan(&s.BaseID, &s.Socket, &s.OffsetX, &s.OffsetY); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *HalloweenRepository) UpsertBaseSockets(baseID string, sockets []*models.HalloweenBaseSocket) error {
	return r.db.Transaction(func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DELETE FROM halloween_base_sockets WHERE base_id = ?`, baseID); err != nil {
			return err
		}
		for _, s := range sockets {
			if _, err := tx.Exec(
				`INSERT INTO halloween_base_sockets (base_id, socket, offset_x, offset_y) VALUES (?, ?, ?, ?)`,
				baseID, s.Socket, s.OffsetX, s.OffsetY,
			); err != nil {
				return err
			}
		}
		return nil
	})
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
			`INSERT INTO halloween_game_results (user_id, completed_rounds, score, is_incomplete, is_cheater, source, model, report_json, reward_json)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			result.UserID, result.CompletedRounds, result.Score, result.IsIncomplete, result.IsCheater,
			result.Source, result.Model, result.ReportJSON, result.RewardJSON,
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
		 WHERE gr.is_cheater = 0 AND gr.source = 'human'
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
		`SELECT gr.id, gr.user_id, COALESCE(u.nickname, ?) AS nickname, gr.completed_rounds, gr.score,
		        gr.is_incomplete, gr.is_cheater, gr.source, gr.model, gr.report_json, gr.reward_json, gr.created_at
		 FROM halloween_game_results gr
		 LEFT JOIN users u ON u.id = gr.user_id
		 ORDER BY gr.created_at DESC`,
		DeletedUserPlaceholder,
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
			&result.ID, &result.UserID, &result.Nickname, &result.CompletedRounds, &result.Score,
			&result.IsIncomplete, &result.IsCheater, &result.Source, &result.Model,
			&result.ReportJSON, &rewardJSON, &createdAt,
		); err != nil {
			return nil, err
		}

		result.RewardJSON = rewardJSON.String
		result.CreatedAt = createdAt
		results = append(results, result)
	}
	return results, rows.Err()
}

// GetRewardsForGame returns the decorations granted for a single game.
func (r *HalloweenRepository) GetRewardsForGame(gameID int64) ([]*models.HalloweenRewardGranted, error) {
	rows, err := r.db.Query(
		`SELECT hr.item_id, COALESCE(hi.name, hr.item_id) AS name, hi.rarity, hi.socket, hr.source
		 FROM halloween_rewards hr
		 LEFT JOIN halloween_items hi ON hi.id = hr.item_id
		 WHERE hr.game_id = ?
		 ORDER BY hr.granted_at ASC`,
		gameID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rewards []*models.HalloweenRewardGranted
	for rows.Next() {
		reward := &models.HalloweenRewardGranted{}
		var rarity, socket sql.NullString
		if err := rows.Scan(&reward.ItemID, &reward.Name, &rarity, &socket, &reward.Source); err != nil {
			return nil, err
		}
		reward.Rarity = rarity.String
		reward.Socket = socket.String
		rewards = append(rewards, reward)
	}
	return rewards, rows.Err()
}

// GetAllRewards returns the full rewards ledger with user nicknames (admin view).
func (r *HalloweenRepository) GetAllRewards() ([]*models.HalloweenAdminReward, error) {
	rows, err := r.db.Query(
		`SELECT hr.user_id, COALESCE(u.nickname, ?) AS nickname, hr.item_id,
		        COALESCE(hi.name, hr.item_id) AS name, hi.rarity, hi.socket, hr.source, hr.game_id, hr.granted_at
		 FROM halloween_rewards hr
		 LEFT JOIN users u ON u.id = hr.user_id
		 LEFT JOIN halloween_items hi ON hi.id = hr.item_id
		 ORDER BY hr.granted_at DESC`,
		DeletedUserPlaceholder,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rewards []*models.HalloweenAdminReward
	for rows.Next() {
		reward := &models.HalloweenAdminReward{}
		var rarity, socket sql.NullString
		var gameID sql.NullInt64
		var grantedAt time.Time

		if err := rows.Scan(
			&reward.UserID, &reward.Nickname, &reward.ItemID, &reward.Name,
			&rarity, &socket, &reward.Source, &gameID, &grantedAt,
		); err != nil {
			return nil, err
		}

		reward.Rarity = rarity.String
		reward.Socket = socket.String
		if gameID.Valid {
			reward.GameID = &gameID.Int64
		}
		reward.GrantedAt = grantedAt
		rewards = append(rewards, reward)
	}
	return rewards, rows.Err()
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
