package store

import (
	"maps"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func checkMonth(t *testing.T, st *Store, month string, want map[int64]MonthlyUsage) {
	t.Helper()
	totals, err := st.MonthlyUsage(t.Context(), month)
	if err != nil {
		t.Fatal(err)
	}
	if !maps.Equal(totals, want) {
		t.Errorf("usage for %s = %+v, want %+v", month, totals, want)
	}
}

func TestMonthlyUsageMigration(t *testing.T) {
	ctx := t.Context()
	path := filepath.Join(t.TempDir(), "accounts.db")
	st, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	account := &Account{Email: "before-migration@example.org", UseCount: 20}
	if err := st.Save(ctx, account); err != nil {
		t.Fatal(err)
	}
	// A pre-usage database has the accounts table and no monthly history.
	if _, err := st.db.Exec("DROP TABLE account_monthly_usage"); err != nil {
		t.Fatal(err)
	}
	if err := st.Close(); err != nil {
		t.Fatal(err)
	}
	st, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	existing, err := st.Get(ctx, account.ID)
	if err != nil || existing.UseCount != 20 {
		t.Fatalf("old account was not preserved: %+v, %v", existing, err)
	}
	checkMonth(t, st, "2026-11", nil)

	// Both instants fall in December locally but only one does in UTC.
	first := time.Date(2026, 12, 1, 7, 59, 59, 0, time.FixedZone("UTC+8", 8*3600))
	if err := st.AddMonthlyUsage(ctx, account.ID, first, time.Second, true); err != nil {
		t.Fatal(err)
	}
	if err := st.AddMonthlyUsage(ctx, account.ID, first.Add(time.Second), 0, false); err != nil {
		t.Fatal(err)
	}
	again, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer again.Close()
	checkMonth(t, again, "2026-11", map[int64]MonthlyUsage{account.ID: {ReportedMS: 1000, ReportedTurns: 1}})
	checkMonth(t, again, "2026-12", map[int64]MonthlyUsage{account.ID: {EstimatedTurns: 1}})
}

func TestMonthlyUsageConcurrentWritersAndDeletion(t *testing.T) {
	ctx := t.Context()
	path := filepath.Join(t.TempDir(), "accounts.db")
	st, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	second, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	a := &Account{Email: "a@example.org"}
	b := &Account{Email: "b@example.org"}
	for _, account := range []*Account{a, b} {
		if err := st.Save(ctx, account); err != nil {
			t.Fatal(err)
		}
	}
	end := time.Date(2026, 11, 10, 8, 0, 0, 0, time.UTC)
	var writers sync.WaitGroup
	for i := range 40 {
		writers.Go(func() {
			writer := st
			if i%2 == 0 {
				writer = second
			}
			if err := writer.AddMonthlyUsage(ctx, a.ID, end, 25*time.Millisecond, i%2 == 0); err != nil {
				t.Error(err)
			}
		})
	}
	writers.Wait()
	if err := st.AddMonthlyUsage(ctx, b.ID, end, 10*time.Second, true); err != nil {
		t.Fatal(err)
	}
	bUsage := MonthlyUsage{ReportedMS: 10000, ReportedTurns: 1}
	checkMonth(t, st, "2026-11", map[int64]MonthlyUsage{
		a.ID: {ReportedMS: 500, EstimatedMS: 500, ReportedTurns: 20, EstimatedTurns: 20},
		b.ID: bUsage,
	})

	// A replacement SQL connection must enforce the same foreign keys.
	st.db.SetMaxIdleConns(0)
	if ok, err := st.Delete(ctx, a.ID); !ok || err != nil {
		t.Fatalf("delete account: %v, %v", ok, err)
	}
	if err := st.AddMonthlyUsage(ctx, a.ID, end, time.Second, false); err == nil {
		t.Fatal("accepted a late turn for a removed account")
	}
	checkMonth(t, st, "2026-11", map[int64]MonthlyUsage{b.ID: bUsage})
	if _, err := st.DeleteAll(ctx); err != nil {
		t.Fatal(err)
	}
	checkMonth(t, st, "2026-11", nil)
}
