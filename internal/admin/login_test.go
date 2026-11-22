package admin

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"quickwork-openai/internal/config"
)

func TestWebLoginSessionLifecycle(t *testing.T) {
	for _, expire := range []bool{false, true} {
		cfg := config.Default()
		if expire {
			cfg.OAuth.Timeout = config.Duration(time.Nanosecond)
		}
		mux := http.NewServeMux()
		registerLogin(mux, &cfg, nil)
		request := func(method, path, body string) *httptest.ResponseRecorder {
			t.Helper()
			r := httptest.NewRequest(method, "/admin/api/login"+path, strings.NewReader(body))
			r.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, r)
			return w
		}
		start := request("POST", "", "{}")
		var login loginResponse
		if err := json.Unmarshal(start.Body.Bytes(), &login); err != nil || start.Code != http.StatusCreated || login.ID == "" || login.Step != "discovery" {
			t.Fatalf("cannot begin login: %d %s", start.Code, start.Body)
		}
		path := "/" + login.ID
		if !expire {
			if w := request("POST", path+"/callback", `{"url":"invalid"}`); w.Code != http.StatusBadRequest {
				t.Fatalf("invalid callback: %d", w.Code)
			}
			if w := request("DELETE", path, ""); w.Code != http.StatusNoContent {
				t.Fatalf("cancel login: %d", w.Code)
			}
		}
		if w := request("POST", path+"/callback", `{"url":"invalid"}`); w.Code != http.StatusGone {
			t.Fatalf("closed session accepted callback: %d", w.Code)
		}
	}
}
