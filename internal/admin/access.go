package admin

import (
	"crypto/subtle"
	"net"
	"net/http"
	"net/url"
	"strings"
)

// Protect keeps management permissions independent of the public proxy's API keys and CORS.
func Protect(next http.Handler, token string) http.Handler {
	token = strings.TrimSpace(token)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Header.Get("X-Quickproxy-Admin") != "1" || !sameOrigin(r) {
			writeError(w, r, http.StatusForbidden, "请从当前服务的管理页面发起请求")
			return
		}
		if token == "" {
			host, _, err := net.SplitHostPort(r.RemoteAddr)
			if err != nil || !net.ParseIP(host).IsLoopback() || !localHost(r.Host) || isForwarded(r) {
				writeError(w, r, http.StatusForbidden, "管理界面默认仅限本机访问。远程使用请在服务端设置 QUICKPROXY_ADMIN_TOKEN 并重启")
				return
			}
		} else {
			scheme, credential, ok := strings.Cut(r.Header.Get("Authorization"), " ")
			if !ok || !strings.EqualFold(scheme, "Bearer") || subtle.ConstantTimeCompare([]byte(credential), []byte(token)) != 1 {
				w.Header().Set("WWW-Authenticate", `Bearer realm="QuickProxy Admin"`)
				writeError(w, r, http.StatusUnauthorized, "请输入正确的管理令牌")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func localHost(authority string) bool {
	host, _, err := net.SplitHostPort(authority)
	if err != nil {
		host = strings.Trim(authority, "[]")
	}
	return strings.EqualFold(host, "localhost") || net.ParseIP(host).IsLoopback()
}

func isForwarded(r *http.Request) bool {
	for _, name := range []string{"Forwarded", "X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Real-Ip"} {
		if r.Header.Get(name) != "" {
			return true
		}
	}
	return false
}

func sameOrigin(r *http.Request) bool {
	if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		return false
	}
	raw := r.Header.Get("Origin")
	if raw == "" {
		return true
	}
	origin, err := url.Parse(raw)
	return err == nil && (origin.Scheme == "http" || origin.Scheme == "https") &&
		origin.User == nil && origin.Path == "" && strings.EqualFold(origin.Host, r.Host)
}
