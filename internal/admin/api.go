// Package admin exposes the account operations used by the local web console.
package admin

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"quickwork-openai/internal/accounts"
	"quickwork-openai/internal/config"
	"quickwork-openai/internal/errlog"
	"quickwork-openai/internal/oauth"
	"quickwork-openai/internal/store"
)

type api struct {
	cfg   *config.Config
	store *store.Store
	mgr   *accounts.Manager
}

// NewAPI returns the management endpoints. The caller provides access control.
func NewAPI(cfg *config.Config, st *store.Store, mgr *accounts.Manager) http.Handler {
	a := &api{cfg: cfg, store: st, mgr: mgr}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /admin/api/overview", a.overview)
	mux.HandleFunc("POST /admin/api/accounts/{id}/refresh", a.refreshOne)
	mux.HandleFunc("POST /admin/api/accounts/refresh", a.refreshAll)
	mux.HandleFunc("DELETE /admin/api/accounts/{id}", a.remove)
	registerLogin(mux, cfg, st)
	return mux
}

// Account details and configuration are deliberately projected before encoding.
// Even the persisted last_error can contain an upstream response body.
type accountSummary struct {
	ID           int64              `json:"id"`
	Email        string             `json:"email"`
	DisplayName  string             `json:"display_name"`
	AccountName  string             `json:"account_name"`
	Provider     string             `json:"provider"`
	BuildStage   string             `json:"build_stage"`
	Region       string             `json:"region"`
	ExpiresAt    int64              `json:"expires_at"`
	UseCount     int64              `json:"use_count"`
	LastUsedAt   int64              `json:"last_used_at"`
	Disabled     bool               `json:"disabled"`
	HasError     bool               `json:"has_error"`
	MonthlyUsage store.MonthlyUsage `json:"monthly_usage"`
}

func (a *api) overview(w http.ResponseWriter, r *http.Request) {
	list, err := a.store.List(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "无法读取账号列表")
		return
	}
	now := time.Now().UTC()
	month := now.Format("2006-01")
	monthly, err := a.store.MonthlyUsage(r.Context(), month)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "无法读取本月用时")
		return
	}
	nextMonth := time.Date(now.Year(), now.Month()+1, 1, 0, 0, 0, 0, time.UTC)
	summaries := make([]accountSummary, 0, len(list))
	for _, acct := range list {
		summaries = append(summaries, accountSummary{
			ID:           acct.ID,
			Email:        acct.Email,
			DisplayName:  acct.DisplayName,
			AccountName:  acct.AccountName,
			Provider:     acct.Provider,
			BuildStage:   acct.BuildStage,
			Region:       acct.Region,
			ExpiresAt:    acct.ExpiresAt,
			UseCount:     acct.UseCount,
			LastUsedAt:   acct.LastUsedAt,
			Disabled:     acct.Disabled,
			HasError:     acct.LastError != "",
			MonthlyUsage: monthly[acct.ID],
		})
	}
	cfg := a.cfg
	writeJSON(w, http.StatusOK, map[string]any{
		"accounts": summaries,
		"usage_period": map[string]any{
			"month":         month,
			"timezone":      "UTC",
			"budget_ms":     cfg.MonthlyTimeBudget.Duration().Milliseconds(),
			"next_reset_at": nextMonth.Unix(),
		},
		"config": map[string]any{
			"models":          cfg.Models,
			"default_model":   cfg.DefaultModel,
			"request_timeout": cfg.RequestTimeout,
			"refresh_before":  cfg.RefreshBefore,
			"max_attempts":    cfg.MaxAttempts,
			"api_key_required": slices.ContainsFunc(cfg.APIKeys, func(key string) bool {
				return strings.TrimSpace(key) != ""
			}),
			"oauth": map[string]string{
				"provider":    cfg.OAuth.Provider,
				"build_stage": cfg.OAuth.BuildStage,
				"region":      cfg.OAuth.Region,
			},
		},
	})
}

func accountID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		writeError(w, r, http.StatusBadRequest, "账号 ID 必须为正整数")
		return 0, false
	}
	return id, true
}

func (a *api) refreshOne(w http.ResponseWriter, r *http.Request) {
	id, ok := accountID(w, r)
	if !ok {
		return
	}
	_, err := a.mgr.RefreshOne(r.Context(), id)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		writeError(w, r, http.StatusNotFound, "账号不存在")
	case errors.Is(err, oauth.ErrNoRefreshToken):
		writeError(w, r, http.StatusConflict, "该账号缺少刷新凭据，请重新登录")
	case err != nil:
		writeError(w, r, http.StatusBadGateway, "刷新失败，请稍后重试或重新登录账号")
	default:
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func (a *api) refreshAll(w http.ResponseWriter, r *http.Request) {
	results, err := a.mgr.RefreshAll(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "批量刷新中断，请重新加载账号列表")
		return
	}
	failed := 0
	for _, result := range results {
		if result.Err != nil {
			failed++
		}
	}
	writeJSON(w, http.StatusOK, map[string]int{"total": len(results), "failed": failed})
}

func (a *api) remove(w http.ResponseWriter, r *http.Request) {
	id, ok := accountID(w, r)
	if !ok {
		return
	}
	deleted, err := a.store.Delete(r.Context(), id)
	switch {
	case err != nil:
		writeError(w, r, http.StatusInternalServerError, "无法移除账号")
	case !deleted:
		writeError(w, r, http.StatusNotFound, "账号不存在")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, r *http.Request, status int, message string) {
	// Log only the route pattern and the fixed public error. Callback URLs carry credentials.
	errlog.From(r.Context()).Error("management request failed", "route", r.Pattern, "status", status, "reason", message)
	writeJSON(w, status, map[string]string{"error": message})
}

func readJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeError(w, r, http.StatusUnsupportedMediaType, "请求格式须为 application/json")
		return false
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, r, http.StatusRequestEntityTooLarge, "请求内容过大")
		} else {
			writeError(w, r, http.StatusBadRequest, "无法读取请求内容")
		}
		return false
	}
	data = bytes.TrimSpace(data)
	if len(data) == 0 || data[0] != '{' {
		writeError(w, r, http.StatusBadRequest, "请输入 JSON 对象")
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil || decoder.InputOffset() != int64(len(data)) {
		writeError(w, r, http.StatusBadRequest, "JSON 格式或字段无效")
		return false
	}
	return true
}
