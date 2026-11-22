package admin

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"quickwork-openai/internal/accounts"
	"quickwork-openai/internal/config"
	"quickwork-openai/internal/store"
)

func managementFixture(t *testing.T) (http.Handler, *store.Store) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "admin.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	cfg := config.Default()
	cfg.APIKeys = []string{"private-api-key"}
	return NewAPI(&cfg, st, accounts.New(st, &cfg)), st
}

func apiRequest(handler http.Handler, method, path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(method, "/admin/api/"+path, nil))
	return w
}

func TestOverviewProjectsAccountAndConfig(t *testing.T) {
	h, st := managementFixture(t)
	empty := apiRequest(h, "GET", "overview")
	if empty.Code != http.StatusOK || !strings.Contains(empty.Body.String(), `"accounts":[]`) {
		t.Fatalf("empty overview: %d %s", empty.Code, empty.Body)
	}
	account := store.Account{
		Email: "user@example.org", Provider: "social", UseCount: 3,
		AccessToken: "private-access", RefreshToken: "private-refresh", ClientSecret: "private-client",
		LastError: "endpoint returned private-error-detail",
	}
	if err := st.Save(t.Context(), &account); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	previous := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC).Add(-time.Second)
	if err := st.AddMonthlyUsage(t.Context(), account.ID, previous, time.Hour, true); err != nil {
		t.Fatal(err)
	}
	if err := st.AddMonthlyUsage(t.Context(), account.ID, now, time.Minute, false); err != nil {
		t.Fatal(err)
	}
	result := apiRequest(h, "GET", "overview")
	var got struct {
		Accounts []accountSummary `json:"accounts"`
		Period   struct {
			Month       string `json:"month"`
			Timezone    string `json:"timezone"`
			BudgetMS    int64  `json:"budget_ms"`
			NextResetAt int64  `json:"next_reset_at"`
		} `json:"usage_period"`
		Config struct {
			APIKeyRequired bool `json:"api_key_required"`
		} `json:"config"`
	}
	if err := json.Unmarshal(result.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if result.Code != http.StatusOK || !got.Config.APIKeyRequired || len(got.Accounts) != 1 {
		t.Fatalf("unexpected overview: %+v", got)
	}
	item := got.Accounts[0]
	nextMonth := time.Date(now.Year(), now.Month()+1, 1, 0, 0, 0, 0, time.UTC)
	if got.Period.Month != now.Format("2006-01") || got.Period.Timezone != "UTC" || got.Period.NextResetAt != nextMonth.Unix() || got.Period.BudgetMS != (10*time.Hour).Milliseconds() {
		t.Fatalf("unexpected usage period: %+v", got.Period)
	}
	if item.MonthlyUsage != (store.MonthlyUsage{EstimatedMS: 60_000, EstimatedTurns: 1}) {
		t.Fatalf("unexpected monthly usage: %+v", item.MonthlyUsage)
	}
	if item.ID != account.ID || item.UseCount != 3 || !item.HasError || item.Email != account.Email {
		t.Fatalf("unexpected account summary: %+v", item)
	}
	if strings.Contains(result.Body.String(), "private-") {
		t.Error("management overview contains a private field value")
	}
}

func TestAccountActions(t *testing.T) {
	h, st := managementFixture(t)
	account := store.Account{Email: "user@example.org", Provider: "social"}
	if err := st.Save(t.Context(), &account); err != nil {
		t.Fatal(err)
	}
	path := "accounts/" + strconv.FormatInt(account.ID, 10)
	if res := apiRequest(h, "POST", path+"/refresh"); res.Code != http.StatusConflict {
		t.Errorf("refresh without credentials: %d %s", res.Code, res.Body)
	}
	batch := apiRequest(h, "POST", "accounts/refresh")
	var counts struct{ Total, Failed int }
	if err := json.Unmarshal(batch.Body.Bytes(), &counts); err != nil || batch.Code != http.StatusOK || counts.Total != 1 || counts.Failed != 1 {
		t.Errorf("batch refresh: %d %s", batch.Code, batch.Body)
	}
	if res := apiRequest(h, "DELETE", "accounts/0"); res.Code != http.StatusBadRequest {
		t.Errorf("delete invalid id: %d", res.Code)
	}
	if res := apiRequest(h, "DELETE", path); res.Code != http.StatusNoContent || res.Body.Len() != 0 {
		t.Errorf("delete account: %d %s", res.Code, res.Body)
	}
	if res := apiRequest(h, "DELETE", path); res.Code != http.StatusNotFound {
		t.Errorf("delete missing account: %d", res.Code)
	}
	if res := apiRequest(h, "POST", path+"/refresh"); res.Code != http.StatusNotFound {
		t.Errorf("refresh missing account: %d", res.Code)
	}
}

func TestReadJSONAcceptsSingleBoundedObject(t *testing.T) {
	for _, tc := range []struct {
		name string
		mime string
		body string
		code int
	}{
		{"valid", "application/json; charset=utf-8", "  {}\n", http.StatusOK},
		{"content-type", "text/plain", "{}", http.StatusUnsupportedMediaType},
		{"null", "application/json", "null", http.StatusBadRequest},
		{"extra object", "application/json", "{}{}", http.StatusBadRequest},
		{"unknown field", "application/json", `{"unknown":true}`, http.StatusBadRequest},
		{"large", "application/json", strings.Repeat(" ", 65537), http.StatusRequestEntityTooLarge},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("POST", "/", strings.NewReader(tc.body))
			r.Header.Set("Content-Type", tc.mime)
			w := httptest.NewRecorder()
			ok := readJSON(w, r, &struct{}{})
			if ok != (tc.code == http.StatusOK) || w.Code != tc.code {
				t.Fatalf("readJSON: ok=%t, status=%d", ok, w.Code)
			}
		})
	}
}
