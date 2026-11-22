package admin

import (
	"context"
	"crypto/rand"
	"net/http"
	"strings"
	"sync"
	"time"

	"quickwork-openai/internal/config"
	"quickwork-openai/internal/oauth"
	"quickwork-openai/internal/store"
)

const maxPendingLogins = 16

type pendingLogin struct {
	mu     sync.Mutex
	flow   *oauth.WebLogin
	ctx    context.Context
	cancel context.CancelFunc
}

type loginSessions struct {
	mu      sync.Mutex
	entries map[string]*pendingLogin
	cfg     *config.Config
	store   *store.Store
}

type loginResponse struct {
	ID string `json:"id"`
	oauth.WebLoginStep
}

func registerLogin(mux *http.ServeMux, cfg *config.Config, st *store.Store) {
	s := &loginSessions{entries: make(map[string]*pendingLogin), cfg: cfg, store: st}
	mux.HandleFunc("POST /admin/api/login", s.start)
	mux.HandleFunc("POST /admin/api/login/{id}/callback", s.callback)
	mux.HandleFunc("DELETE /admin/api/login/{id}", s.cancel)
}

func (s *loginSessions) start(w http.ResponseWriter, r *http.Request) {
	opts := oauth.LoginOptions{
		Provider: s.cfg.OAuth.Provider, Stage: s.cfg.OAuth.BuildStage, Region: s.cfg.OAuth.Region,
		Port: s.cfg.OAuth.CallbackPort, Timeout: s.cfg.OAuth.Timeout.Duration(), AppVersion: s.cfg.AppVersion,
	}
	input := struct {
		Provider string `json:"provider"`
		Stage    string `json:"stage"`
		Region   string `json:"region"`
	}{}
	if !readJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Provider) != "" {
		opts.Provider = input.Provider
	}
	if strings.TrimSpace(input.Stage) != "" {
		opts.Stage = input.Stage
	}
	if strings.TrimSpace(input.Region) != "" {
		opts.Region = input.Region
	}
	flow, step, err := oauth.BeginWebLogin(opts, s.store, s.cfg.OAuth.WebIDPHosts)
	if err != nil {
		writeError(w, r, oauth.WebLoginStatus(err), err.Error())
		return
	}
	id := rand.Text()
	s.mu.Lock()
	if len(s.entries) >= maxPendingLogins {
		s.mu.Unlock()
		writeError(w, r, http.StatusTooManyRequests, "待完成的登录过多，请先结束其他登录或稍后重试")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), opts.Timeout)
	session := &pendingLogin{flow: flow, ctx: ctx, cancel: cancel}
	s.entries[id] = session
	context.AfterFunc(ctx, func() {
		s.mu.Lock()
		delete(s.entries, id)
		s.mu.Unlock()
	})
	s.mu.Unlock()
	writeJSON(w, http.StatusCreated, loginResponse{id, step})
}

// acquire permits one callback or cancellation at a time for each flow.
func (s *loginSessions) acquire(w http.ResponseWriter, r *http.Request) *pendingLogin {
	id := r.PathValue("id")
	s.mu.Lock()
	session := s.entries[id]
	s.mu.Unlock()
	if session != nil && !session.mu.TryLock() {
		writeError(w, r, http.StatusConflict, "此登录流程正在处理回调，请稍后重试")
		return nil
	}
	if session == nil || session.ctx.Err() != nil {
		if session != nil {
			session.mu.Unlock()
		}
		writeError(w, r, http.StatusGone, "登录流程已结束或过期，请重新开始")
		return nil
	}
	return session
}

func (s *loginSessions) callback(w http.ResponseWriter, r *http.Request) {
	var input struct {
		URL string `json:"url"`
	}
	if !readJSON(w, r, &input) {
		return
	}
	id := r.PathValue("id")
	session := s.acquire(w, r)
	if session == nil {
		return
	}
	defer session.mu.Unlock()
	// End outbound exchanges on either browser disconnect or session expiry.
	deadline, _ := session.ctx.Deadline()
	ctx, cancel := context.WithDeadline(r.Context(), deadline)
	defer cancel()
	step, err := session.flow.Callback(ctx, input.URL)
	if err != nil {
		if time.Now().After(deadline) {
			writeError(w, r, http.StatusGone, "登录流程已过期，请重新开始")
			return
		}
		writeError(w, r, oauth.WebLoginStatus(err), err.Error())
		return
	}
	if step.Step == "complete" {
		session.cancel()
	}
	writeJSON(w, http.StatusOK, loginResponse{id, step})
}

func (s *loginSessions) cancel(w http.ResponseWriter, r *http.Request) {
	session := s.acquire(w, r)
	if session == nil {
		return
	}
	defer session.mu.Unlock()
	session.cancel()
	w.WriteHeader(http.StatusNoContent)
}
