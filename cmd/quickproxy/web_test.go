package main

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"quickwork-openai/internal/accounts"
	"quickwork-openai/internal/admin"
	"quickwork-openai/internal/config"
	"quickwork-openai/internal/errlog"
	"quickwork-openai/internal/store"
)

func TestConsoleAndProxyRoutes(t *testing.T) {
	cfg := config.Default()
	cfg.APIKeys = []string{"client"}
	st, err := store.Open(filepath.Join(t.TempDir(), "accounts.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	h := serviceHandler(&cfg, st, accounts.New(st, &cfg), "operator")
	for _, tc := range []struct {
		path, key, body string
		want            int
	}{
		{"/", "", "/admin/", 302},
		{"/admin/", "", "/admin/assets/", 200},
		{"/admin/api/overview", "client", "", 401},
		{"/admin/api/overview", "operator", `"accounts":[]`, 200},
		{"/v1/models", "operator", "", 401},
		{"/v1/models", "client", `"smart"`, 200},
		{"/healthz", "", `"ok"`, 200},
	} {
		r := httptest.NewRequest("GET", tc.path, nil)
		r.Header.Set("Authorization", "Bearer "+tc.key)
		r.Header.Set("X-Quickproxy-Admin", "1")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tc.want || !strings.Contains(w.Body.String(), tc.body) {
			t.Errorf("GET %s got %d, expected %d and body containing %q", tc.path, w.Code, tc.want, tc.body)
		}
		if strings.HasPrefix(tc.path, "/admin/") && w.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Errorf("proxy CORS headers applied to %s", tc.path)
		}
	}
}

func TestErrorLogFromCLIAndManagement(t *testing.T) {
	dir := t.TempDir()
	if code := run([]string{"logout", "-config", filepath.Join(dir, "config.json"), "-account", "999"}); code != 1 {
		t.Fatalf("logout exit code = %d", code)
	}
	body, err := os.ReadFile(filepath.Join(dir, "data", "error.log"))
	if err != nil {
		t.Fatal(err)
	}
	var record struct {
		Level     string
		Command   string
		AccountID int64 `json:"account_id"`
	}
	if err := json.Unmarshal(body, &record); err != nil || record.Level != "ERROR" || record.Command != "logout" || record.AccountID != 999 {
		t.Fatalf("unexpected log record %s (%v)", body, err)
	}

	var output bytes.Buffer
	ctx := errlog.WithLogger(t.Context(), slog.New(slog.NewJSONHandler(&output, nil)))
	r := httptest.NewRequest("POST", "/admin/api/login/private-session/callback?code=private-query", nil).WithContext(ctx)
	r.Header.Set("X-Quickproxy-Admin", "1")
	r.Header.Set("Authorization", "Bearer private-token")
	w := httptest.NewRecorder()
	admin.Protect(nil, "operator").ServeHTTP(w, r)
	if w.Code != 401 || !strings.Contains(output.String(), `"status":401`) || strings.Contains(output.String(), "private-") {
		t.Fatalf("unexpected management log or status %d: %s", w.Code, &output)
	}
}
