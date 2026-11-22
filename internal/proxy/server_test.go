package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"quickwork-openai/internal/accounts"
	"quickwork-openai/internal/config"
	"quickwork-openai/internal/errlog"
	"quickwork-openai/internal/store"
)

func TestRejectedProxyRequestsLogOnlySafeFields(t *testing.T) {
	cfg := config.Default()
	cfg.APIKeys = []string{"valid"}
	h := NewServer(&cfg, nil).Handler()
	for _, tc := range []struct {
		token, body, code string
		status            int
	}{
		{"private-key", "", "invalid_api_key", http.StatusUnauthorized},
		{"valid", `{"n":"private-value"}`, "invalid_request_error", http.StatusBadRequest},
	} {
		var logs bytes.Buffer
		ctx := errlog.WithLogger(t.Context(), slog.New(slog.NewJSONHandler(&logs, nil)))
		r := httptest.NewRequestWithContext(ctx, http.MethodPost, "/v1/chat/completions?private-query", strings.NewReader(tc.body))
		r.Header.Set("X-Api-Key", tc.token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tc.status || !strings.Contains(logs.String(), tc.code) || strings.Contains(logs.String(), "private") {
			t.Errorf("got HTTP %d and logs %s", w.Code, &logs)
		}
	}
}

func TestChatAttemptsRecordUsageAndSafeErrors(t *testing.T) {
	var accepted atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/denied" {
			http.Error(w, "private denial", http.StatusForbidden)
			return
		}
		upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.Close()
		for range 4 { // session_connect, federate_status, session_create, user_message
			if _, _, err := conn.ReadMessage(); err != nil {
				t.Error(err)
				return
			}
		}
		frames := []string{`{"type":"text_delta","payload":"reply"}`}
		if accepted.Add(1) == 1 {
			frames = append(frames, `{"type":"turn_usage","payload":{"output_tokens":2,"duration_ms":450}}`,
				`{"type":"turn_usage","payload":{"output_tokens":3,"duration_ms":750}}`, `{"type":"turn_completed"}`)
		} else {
			frames = append(frames, `{"type":"stream_error","error":"private upstream detail"}`)
		}
		for _, frame := range frames {
			if err := conn.WriteMessage(websocket.TextMessage, []byte(frame)); err != nil {
				t.Error(err)
				return
			}
		}
	}))
	defer upstream.Close()
	st, err := store.Open(filepath.Join(t.TempDir(), "chat.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	var logs bytes.Buffer
	ctx := errlog.WithLogger(t.Context(), slog.New(slog.NewJSONHandler(&logs, nil)))
	var ids []int64
	for _, path := range []string{"/denied", "/chat"} {
		acct := &store.Account{Email: "private-email" + path, Provider: "social", AccessToken: "private-token",
			WSHost: "ws" + strings.TrimPrefix(upstream.URL, "http"), WSPath: path}
		if err := st.Save(ctx, acct); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, acct.ID)
	}
	cfg := config.Default()
	cfg.APIKeys = []string{"private-api-key"}
	cfg.MaxAttempts = 2
	handler := NewServer(&cfg, accounts.New(st, &cfg)).Handler()
	for _, stream := range []bool{false, true} {
		body := fmt.Sprintf(`{"stream":%t,"messages":[{"role":"user","content":"private prompt"}]}`, stream)
		r := httptest.NewRequestWithContext(ctx, http.MethodPost, "/v1/chat/completions?test=private-query", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer private-api-key")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "reply") {
			t.Fatalf("stream=%t: %d %s", stream, w.Code, w.Body)
		}
		if stream && (!w.Flushed || !strings.Contains(w.Body.String(), "private upstream detail") || !strings.Contains(w.Body.String(), "data: [DONE]")) {
			t.Fatalf("stream lost error or terminator: %s", w.Body)
		}
		if !stream && !strings.Contains(w.Body.String(), `"completion_tokens":5`) {
			t.Fatalf("incorrect token usage: %s", w.Body)
		}
	}
	usage, err := st.MonthlyUsage(ctx, time.Now().UTC().Format("2006-01"))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := usage[ids[0]]; ok {
		t.Fatal("handshake rejection was counted")
	}
	if got := usage[ids[1]]; got.ReportedMS != 1200 || got.ReportedTurns != 1 || got.EstimatedTurns != 1 {
		t.Fatalf("usage on serving account: %+v", got)
	}
	acct, err := st.Get(ctx, ids[1])
	if err != nil || acct.LastError != "upstream stream_error" {
		t.Fatalf("stored failure: %+v, %v", acct, err)
	}
	for _, want := range []string{"upstream HTTP 403", "upstream stream_error", `"code":"upstream_error"`, `"status":200`, `"route":"/v1/chat/completions"`} {
		if !strings.Contains(logs.String(), want) {
			t.Errorf("missing %q in %s", want, &logs)
		}
	}
	if strings.Contains(logs.String(), "private") || strings.Contains(logs.String(), upstream.URL) {
		t.Errorf("sensitive data in log: %s", &logs)
	}
}

func TestTurnTimingUsesCompletionAndHandlesPartialReports(t *testing.T) {
	started := time.Unix(100, 0)
	ended := started.Add(2 * time.Second)
	for _, raw := range []string{"", "null", "-5", `"invalid"`, "9223372036854775807"} {
		c := turnClock{startedAt: started, completedAt: ended}
		c.addUsage(json.RawMessage("100"), true, ended)
		c.addUsage(json.RawMessage(raw), true, ended.Add(5*time.Second))
		timing := c.timing()
		if timing.reported || timing.duration != 2*time.Second || !timing.endedAt.Equal(ended) {
			t.Errorf("%q gave %+v", raw, timing)
		}
	}
	c := turnClock{startedAt: started}
	c.addUsage(nil, false, ended)
	if got := c.timing(); !got.endedAt.IsZero() {
		t.Fatalf("turn without evidence of usage was counted: %+v", got)
	}
	c.progressAt = ended
	if got := c.timing(); got.reported || !got.endedAt.Equal(ended) || got.duration != 2*time.Second {
		t.Fatalf("interrupted turn must end at the last progress: %+v", got)
	}
}

func TestCancelWakesWebSocketReaderAndPersistsPartialTurn(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.Close()
		for range 4 {
			if _, _, err := conn.ReadMessage(); err != nil {
				t.Error(err)
				return
			}
		}
		if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"text_delta","payload":"partial reply"}`)); err != nil {
			t.Error(err)
			return
		}
		// Send nothing further. Closing the client socket should wake both readers.
		_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		_, _, _ = conn.ReadMessage()
	}))
	defer upstream.Close()
	st, err := store.Open(filepath.Join(t.TempDir(), "chat.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	acct := &store.Account{Email: "cancel@example.invalid", Provider: "social", AccessToken: "test",
		WSHost: "ws" + strings.TrimPrefix(upstream.URL, "http")}
	if err := st.Save(t.Context(), acct); err != nil {
		t.Fatal(err)
	}
	cfg := config.Default()
	s := NewServer(&cfg, accounts.New(st, &cfg))
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	progress := make(chan time.Time, 1)
	done := make(chan ChatResult, 1)
	go func() {
		result, _ := s.chatWithAccount(ctx, acct, ChatInput{Prompt: "test"}, func(StreamEvent) error {
			progress <- time.Now()
			return nil
		})
		done <- result
	}()
	var received time.Time
	select {
	case received = <-progress:
	case <-time.After(2 * time.Second):
		t.Fatal("missing partial output")
	}
	time.AfterFunc(50*time.Millisecond, cancel) // let the reader block again
	select {
	case result := <-done:
		if result.timing.endedAt.After(received) || result.timing.endedAt.IsZero() {
			t.Fatalf("usage continued after final delta: %v, received %v", result.timing, received)
		}
	case <-time.After(time.Second):
		t.Fatal("client cancellation left the WebSocket reader blocked")
	}
	usage, err := st.MonthlyUsage(t.Context(), received.UTC().Format("2006-01"))
	if err != nil || usage[acct.ID].EstimatedTurns != 1 {
		t.Fatalf("missing usage after cancellation: %+v, %v", usage, err)
	}
}
