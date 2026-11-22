package accounts

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"quickwork-openai/internal/config"
	"quickwork-openai/internal/errlog"
	"quickwork-openai/internal/store"
)

func testManager(t *testing.T) (*Manager, *store.Store) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "accounts.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	cfg := config.Default()
	return New(st, &cfg), st
}

func TestRefreshAllLogsIndividualFailures(t *testing.T) {
	mgr, st := testManager(t)
	var logs bytes.Buffer
	ctx := errlog.WithLogger(t.Context(), slog.New(slog.NewJSONHandler(&logs, nil)))
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/denied":
			http.Error(w, "private-token-error", http.StatusUnauthorized)
		case "/token":
			_, _ = w.Write([]byte(`{"access_token":"private-access"}`))
		default:
			_, _ = w.Write([]byte(`{}`))
		}
	}))
	defer srv.Close()
	for _, name := range []string{"denied", "missing", "token"} {
		a := validAccount(name + "@private.example")
		a.Provider, a.TenantURL, a.TokenEndpoint = "enterprise", srv.URL, srv.URL+"/"+name
		if name != "missing" {
			a.RefreshToken = "private-refresh"
		}
		if err := st.Save(ctx, a); err != nil {
			t.Fatal(err)
		}
	}
	results, err := mgr.RefreshAll(ctx)
	if err != nil || len(results) != 3 {
		t.Fatalf("refresh results: %d, %v", len(results), err)
	}
	if got := strings.Count(logs.String(), "\n"); got != 2 {
		t.Fatalf("logged %d failures, want 2: %s", got, &logs)
	}
	for _, res := range results {
		if res.Err != nil && !strings.Contains(logs.String(), fmt.Sprintf(`"account_id":%d`, res.Account.ID)) {
			t.Errorf("missing failed account %d in %s", res.Account.ID, &logs)
		}
	}
	for _, want := range []string{"upstream HTTP 401", "missing refresh_token", "refresh_account"} {
		if !strings.Contains(logs.String(), want) {
			t.Errorf("missing %q in %s", want, &logs)
		}
	}
	if strings.Contains(logs.String(), "private") || strings.Contains(logs.String(), srv.URL) {
		t.Fatalf("sensitive data in logs: %s", &logs)
	}
}

func validAccount(email string) *store.Account {
	return &store.Account{
		Email:       email,
		Provider:    "social",
		BuildStage:  "prod",
		TenantURL:   "https://tenant.example",
		WSHost:      "tenant.example",
		AccessToken: "access",
		ExpiresAt:   time.Now().Add(time.Hour).Unix(),
	}
}

func TestNextRoundRobin(t *testing.T) {
	mgr, st := testManager(t)
	ctx := context.Background()
	a1 := validAccount("a@example.com")
	a2 := validAccount("b@example.com")
	if err := st.Save(ctx, a1); err != nil {
		t.Fatal(err)
	}
	if err := st.Save(ctx, a2); err != nil {
		t.Fatal(err)
	}

	var got []int64
	for range 4 {
		a, err := mgr.Next(ctx)
		if err != nil {
			t.Fatal(err)
		}
		got = append(got, a.ID)
	}
	want := []int64{a1.ID, a2.ID, a1.ID, a2.ID}
	if len(got) != len(want) {
		t.Fatalf("unexpected selection count: %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("selection %d: got %d want %d (all: %v)", i, got[i], want[i], got)
		}
	}
}

func TestNextSkipsExpiredWithoutRefreshToken(t *testing.T) {
	mgr, st := testManager(t)
	ctx := context.Background()
	dead := validAccount("dead@example.com")
	dead.AccessToken = "old"
	dead.RefreshToken = ""
	dead.ExpiresAt = time.Now().Add(-time.Hour).Unix()
	live := validAccount("live@example.com")
	if err := st.Save(ctx, dead); err != nil {
		t.Fatal(err)
	}
	if err := st.Save(ctx, live); err != nil {
		t.Fatal(err)
	}

	for range 2 {
		a, err := mgr.Next(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if a.ID != live.ID {
			t.Fatalf("expected live account %d, got %d", live.ID, a.ID)
		}
	}
	stored, err := st.Get(ctx, dead.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(stored.LastError, "refresh_token") {
		t.Fatalf("expected refresh error on expired account, got %q", stored.LastError)
	}
}

func TestNextRefreshesExpiringAccount(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "accounts.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/token":
			_, _ = w.Write([]byte(`{"access_token":"new-access","expires_in":3600}`))
		case "/integration/quick-work/user-info":
			_, _ = w.Write([]byte(`{"userInfo":{"email":"auto@example.com"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	a := validAccount("auto@example.com")
	a.Provider = "enterprise"
	a.TenantURL = srv.URL
	a.WSHost = strings.TrimPrefix(srv.URL, "http://")
	a.AccessToken = "old-access"
	a.RefreshToken = "refresh-token"
	a.ClientID = "client-id"
	a.TokenEndpoint = srv.URL + "/token"
	a.ExpiresAt = time.Now().Add(-time.Minute).Unix()
	if err := st.Save(context.Background(), a); err != nil {
		t.Fatal(err)
	}
	cfg := config.Default()
	mgr := New(st, &cfg)
	got, err := mgr.Next(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got.AccessToken != "new-access" {
		t.Fatalf("access token = %q", got.AccessToken)
	}
	stored, err := st.Get(context.Background(), a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.AccessToken != "new-access" || stored.ExpiresAt <= time.Now().Unix() {
		t.Fatalf("refreshed account not persisted: %+v", stored)
	}
}
