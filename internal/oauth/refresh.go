package oauth

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"quickwork-openai/internal/errlog"
	"quickwork-openai/internal/store"
)

// ErrNoRefreshToken means the account must be logged in again.
var ErrNoRefreshToken = errlog.At("missing refresh_token", errors.New("no refresh_token stored; run login again"))

// Refresh renews an account's tokens and returns an updated copy. The caller
// persists it with Store.Update.
func Refresh(ctx context.Context, a *store.Account) (*store.Account, error) {
	if a == nil {
		return nil, errors.New("account is nil")
	}
	if strings.TrimSpace(a.RefreshToken) == "" {
		return nil, ErrNoRefreshToken
	}
	out := *a
	provider := normalizedProvider(out.Provider)

	var (
		raw map[string]any
		err error
	)
	switch {
	case isEnterpriseDiscovery(provider):
		if out.TokenEndpoint == "" {
			return nil, errlog.At("missing token endpoint", errors.New("account has no token_endpoint; run login again"))
		}
		form := url.Values{
			"grant_type":    {"refresh_token"},
			"refresh_token": {out.RefreshToken},
			"client_id":     {out.ClientID},
		}
		if out.ClientSecret != "" {
			form.Set("client_secret", out.ClientSecret)
		}
		raw, err = postForm(ctx, out.TokenEndpoint, form)
	default:
		endpoint := out.TokenEndpoint
		if endpoint == "" {
			region := out.IDCRegion
			if region == "" {
				region = out.Region
			}
			if region == "" {
				region = "us-east-1"
			}
			endpoint = "https://oidc." + region + ".amazonaws.com/token"
		}
		raw, err = postJSON(ctx, endpoint, map[string]any{
			"clientId":     out.ClientID,
			"clientSecret": out.ClientSecret,
			"grantType":    "refresh_token",
			"refreshToken": out.RefreshToken,
		}, nil)
	}
	if err != nil {
		return nil, errlog.At("request refreshed token", err)
	}
	t := tokensFromMap(raw)
	if t.AccessToken == "" {
		return nil, errlog.At("missing refreshed access token", errors.New("refresh returned no access_token"))
	}
	if t.RefreshToken == "" {
		t.RefreshToken = out.RefreshToken
	}

	d := discovery{
		TenantURL: out.TenantURL,
		Region:    out.Region,
	}
	info, err := fetchUserInfo(ctx, provider, out.BuildStage, d, out.TenantURL, t.AccessToken)
	if err != nil {
		return nil, errlog.At("fetch refreshed user info", fmt.Errorf("user info after refresh: %w", err))
	}
	if err := applySession(&out, t, info); err != nil {
		return nil, errlog.At("prepare refreshed session", err)
	}
	return &out, nil
}
