package admin

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestManagementAccess(t *testing.T) {
	for _, tc := range []struct {
		name, host, peer, origin, token, bearer string
		omitHeader, forwarded                   bool
		want                                    int
	}{
		{name: "local", host: "localhost:8080", peer: "127.0.0.1:5000", origin: "http://localhost:8080", want: 204},
		{name: "local ipv6", host: "[::1]:8080", peer: "[::1]:5000", want: 204},
		{name: "foreign host", host: "external.example", peer: "127.0.0.1:5000", want: 403},
		{name: "remote client", host: "localhost", peer: "192.0.2.1:5000", want: 403},
		{name: "forwarded", host: "localhost", peer: "127.0.0.1:5000", forwarded: true, want: 403},
		{name: "foreign origin", host: "localhost", peer: "127.0.0.1:5000", origin: "http://external.example", want: 403},
		{name: "simple request", host: "localhost", peer: "127.0.0.1:5000", omitHeader: true, want: 403},
		{name: "missing token locally", host: "localhost", peer: "127.0.0.1:5000", token: "admin", want: 401},
		{name: "proxy key", host: "external.example", peer: "192.0.2.1:5000", token: "admin", bearer: "proxy-key", want: 401},
		{name: "authorized remote", host: "external.example", peer: "192.0.2.1:5000", origin: "https://external.example", token: "admin", bearer: "admin", want: 204},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/admin/api/login", nil)
			r.Host, r.RemoteAddr = tc.host, tc.peer
			r.Header.Set("Origin", tc.origin)
			if !tc.omitHeader {
				r.Header.Set("X-Quickproxy-Admin", "1")
			}
			if tc.bearer != "" {
				r.Header.Set("Authorization", "Bearer "+tc.bearer)
			}
			if tc.forwarded {
				r.Header.Set("X-Forwarded-For", "192.0.2.1")
			}
			w := httptest.NewRecorder()
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusNoContent)
			})
			Protect(next, tc.token).ServeHTTP(w, r)
			if w.Code != tc.want || w.Header().Get("Access-Control-Allow-Origin") != "" {
				t.Errorf("got status %d (want %d), headers %v", w.Code, tc.want, w.Header())
			}
		})
	}
}
