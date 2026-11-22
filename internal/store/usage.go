package store

import (
	"context"
	"errors"
	"time"
)

// MonthlyUsage counts completed turns and their durations in one UTC month.
type MonthlyUsage struct {
	ReportedMS     int64 `json:"reported_ms"`
	EstimatedMS    int64 `json:"estimated_ms"`
	ReportedTurns  int64 `json:"reported_turns"`
	EstimatedTurns int64 `json:"estimated_turns"`
}

// AddMonthlyUsage atomically records a turn in the UTC month it finished.
func (s *Store) AddMonthlyUsage(ctx context.Context, accountID int64, endedAt time.Time, duration time.Duration, reported bool) error {
	if endedAt.IsZero() || duration < 0 {
		return errors.New("missing completion time or negative usage duration")
	}
	var turn MonthlyUsage
	if reported {
		turn.ReportedMS, turn.ReportedTurns = duration.Milliseconds(), 1
	} else {
		turn.EstimatedMS, turn.EstimatedTurns = duration.Milliseconds(), 1
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO account_monthly_usage (month, account_id, reported_ms, estimated_ms, reported_turns, estimated_turns)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(month, account_id) DO UPDATE SET
	reported_ms = reported_ms + excluded.reported_ms,
	estimated_ms = estimated_ms + excluded.estimated_ms,
	reported_turns = reported_turns + excluded.reported_turns,
	estimated_turns = estimated_turns + excluded.estimated_turns`,
		endedAt.UTC().Format("2006-01"), accountID, turn.ReportedMS, turn.EstimatedMS, turn.ReportedTurns, turn.EstimatedTurns)
	return err
}

// MonthlyUsage returns totals keyed by account ID. Accounts with no recorded
// turns in the supplied YYYY-MM month have no map entry.
func (s *Store) MonthlyUsage(ctx context.Context, month string) (map[int64]MonthlyUsage, error) {
	if _, err := time.Parse("2006-01", month); err != nil {
		return nil, errors.New("month must be YYYY-MM")
	}
	rows, err := s.db.QueryContext(ctx, `SELECT account_id, reported_ms, estimated_ms, reported_turns, estimated_turns
FROM account_monthly_usage WHERE month = ?`, month)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	totals := make(map[int64]MonthlyUsage)
	for rows.Next() {
		var id int64
		var usage MonthlyUsage
		if err := rows.Scan(&id, &usage.ReportedMS, &usage.EstimatedMS, &usage.ReportedTurns, &usage.EstimatedTurns); err != nil {
			return nil, err
		}
		totals[id] = usage
	}
	return totals, rows.Err()
}
