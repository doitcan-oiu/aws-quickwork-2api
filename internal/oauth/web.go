package oauth

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"quickwork-openai/internal/store"
)

var awsRegion = regexp.MustCompile(`^[a-z]{2}(-[a-z0-9]+)+-[0-9]+$`)

// WebLogin holds the PKCE and discovery state for one browser login.
// The caller serializes callbacks and discards the flow on completion or timeout.
type WebLogin struct {
	flow     *loginFlow
	idpHosts []string
}

type WebLoginStep struct {
	Step      string `json:"step"`
	URL       string `json:"url,omitempty"`
	AccountID int64  `json:"account_id,omitempty"`
}

// BeginWebLogin creates the discovery link without opening a listener.
func BeginWebLogin(opts LoginOptions, st *store.Store, idpHosts []string) (*WebLogin, WebLoginStep, error) {
	opts = normalizeLoginOptions(opts)
	opts.Provider = strings.ToLower(strings.TrimSpace(opts.Provider))
	opts.Stage = strings.ToLower(strings.TrimSpace(opts.Stage))
	opts.Region = strings.TrimSpace(opts.Region)
	if opts.Provider != normalizedProvider(opts.Provider) || opts.Stage != normalizedStage(opts.Stage) {
		return nil, WebLoginStep{}, stepErrorf(http.StatusBadRequest, "登录方式或环境无效")
	}
	if opts.Region != "" && opts.Region != "dynamic" && !awsRegion.MatchString(opts.Region) {
		return nil, WebLoginStep{}, stepErrorf(http.StatusBadRequest, "请输入有效的 AWS 区域，例如 us-east-1")
	}
	f, err := newLoginFlow(opts, st, opts.Port)
	if err != nil {
		return nil, WebLoginStep{}, errors.New("无法创建登录流程")
	}
	start := discoveryURL(f.provider, f.stage, f.region, f.nonce, f.port, opts.AppVersion)
	return &WebLogin{flow: f, idpHosts: idpHosts}, WebLoginStep{Step: "discovery", URL: start}, nil
}

// Callback consumes the full localhost URL copied from the browser. Responses to the
// web client use fixed error messages; upstream errors may contain secrets.
func (s *WebLogin) Callback(ctx context.Context, raw string) (WebLoginStep, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	f := s.flow
	if err != nil || u.Scheme != "http" || u.User != nil || u.Port() != itoa(f.port) ||
		(u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1") {
		return WebLoginStep{}, stepErrorf(http.StatusBadRequest, "请粘贴浏览器地址栏中的完整 localhost 回调地址")
	}
	q, err := parseCallbackURL(u.String())
	if err != nil {
		return WebLoginStep{}, stepErrorf(http.StatusBadRequest, "回调地址缺少登录参数")
	}
	if q.Get("error") != "" {
		return WebLoginStep{}, stepErrorf(http.StatusBadRequest, "身份提供方拒绝了登录，请重新授权")
	}
	switch classifyCallback(q) {
	case callbackDiscovery:
		if !s.validDiscovery(q) {
			return WebLoginStep{}, stepErrorf(http.StatusBadRequest, "回调中的服务地址或区域无效。自定义企业身份提供方请先配置 oauth.web_idp_hosts")
		}
		authURL, err := f.processDiscovery(ctx, q)
		if err != nil {
			return WebLoginStep{}, stepErrorf(statusOf(err), "无法完成服务发现，请核对回调地址或重新登录")
		}
		return WebLoginStep{Step: "authorize", URL: authURL}, nil
	case callbackCode:
		if !f.discoveryDone {
			return WebLoginStep{}, stepErrorf(http.StatusBadRequest, "请先提交服务发现回调")
		}
		acct, err := f.completeLogin(ctx, q)
		if err != nil {
			return WebLoginStep{}, stepErrorf(statusOf(err), "授权未完成，请核对当前流程的回调地址或重新登录")
		}
		return WebLoginStep{Step: "complete", AccountID: acct.ID}, nil
	default:
		return WebLoginStep{}, stepErrorf(http.StatusBadRequest, "无法识别回调，请复制登录跳转后的完整地址")
	}
}

// WebLoginStatus returns the HTTP status for a web login error.
func WebLoginStatus(err error) int { return statusOf(err) }

// A pasted discovery URL is user input. Only Quick service hosts may receive
// account tokens or become a stored WebSocket target. Enterprise IdPs can be
// trusted separately by exact hostname in the local config.
func (s *WebLogin) validDiscovery(q url.Values) bool {
	for _, region := range []string{firstQuery(q, "idcRegion", "idc_region"), firstQuery(q, "region")} {
		if region != "" && !awsRegion.MatchString(region) {
			return false
		}
	}
	if raw := firstQuery(q, "tenantUrl", "tenant_url"); raw != "" {
		host := httpsHost(raw)
		if !quickHost(host) {
			return false
		}
	}
	if !isEnterpriseDiscovery(s.flow.provider) {
		return true
	}
	for _, raw := range []string{firstQuery(q, "authEndpoint", "auth_endpoint"), firstQuery(q, "tokenEndpoint", "token_endpoint")} {
		host := httpsHost(raw)
		if host == "" || !s.trustedIDP(host) {
			return false
		}
	}
	return firstQuery(q, "tenantUrl", "tenant_url") != ""
}

func httpsHost(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Fragment != "" ||
		(u.Port() != "" && u.Port() != "443") {
		return ""
	}
	return strings.ToLower(u.Hostname())
}

func quickHost(host string) bool {
	for _, domain := range []string{
		"quick.aws.com", "quicksight.aws.amazon.com", "plato.ai.aws.dev", "quicksuite.aws.dev",
		"spaceneedle-alpha.amazon.com", "spaceneedle-beta.amazon.com",
	} {
		if host == domain || strings.HasSuffix(host, "."+domain) {
			return true
		}
	}
	return false
}

func (s *WebLogin) trustedIDP(host string) bool {
	if quickHost(host) || host == "login.microsoftonline.com" || host == "accounts.google.com" || host == "oauth2.googleapis.com" {
		return true
	}
	if strings.HasPrefix(host, "oidc.") && strings.HasSuffix(host, ".amazonaws.com") {
		region := strings.TrimSuffix(strings.TrimPrefix(host, "oidc."), ".amazonaws.com")
		if awsRegion.MatchString(region) {
			return true
		}
	}
	for _, h := range s.idpHosts {
		if strings.EqualFold(host, strings.TrimSpace(h)) {
			return true
		}
	}
	return false
}
