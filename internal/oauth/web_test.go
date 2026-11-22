package oauth

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

type oauthRoundTrip func(*http.Request) (*http.Response, error)

func (f oauthRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestWebLoginBindsEndpointsAndCompletes(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	flow, _, err := BeginWebLogin(LoginOptions{Provider: "enterprise", Stage: "prod"}, st, []string{"idp.example.org"})
	if err != nil {
		t.Fatal(err)
	}
	q := url.Values{
		"nonce":         {flow.flow.nonce},
		"authEndpoint":  {"https://idp.example.org/authorize"},
		"tokenEndpoint": {"https://idp.example.org/token"},
		"tenantUrl":     {"https://tenant.us-east-1.enterprise.quick.aws.com"},
		"clientSecret":  {"test-client-secret"},
	}
	for _, tc := range []struct{ field, value string }{
		{"tokenEndpoint", "http://idp.example.org/token"},
		{"tokenEndpoint", "https://idp.example.org:9000/token"},
		{"authEndpoint", "https://idp.example.org.example/authorize"},
		{"tenantUrl", "https://idp.example.org"},
		{"region", "bad/region"},
		{"nonce", "different-nonce"},
	} {
		original := q.Get(tc.field)
		q.Set(tc.field, tc.value)
		_, err := flow.Callback(ctx, "http://localhost:18080/callback?"+q.Encode())
		if err == nil || WebLoginStatus(err) != http.StatusBadRequest || strings.Contains(err.Error(), "test-client-secret") {
			t.Fatalf("unexpected result for %s: %v", tc.field, err)
		}
		q.Set(tc.field, original)
	}

	auth, err := flow.Callback(ctx, "http://localhost:18080/callback?"+q.Encode())
	if err != nil || auth.Step != "authorize" || strings.Contains(auth.URL, "test-client-secret") {
		t.Fatalf("discovery failed: %v", err)
	}
	authorizeURL, err := url.Parse(auth.URL)
	if err != nil || authorizeURL.Query().Get("code_challenge_method") != "S256" {
		t.Fatalf("invalid authorize URL")
	}
	state := authorizeURL.Query().Get("state")
	_, err = flow.Callback(ctx, "http://localhost:18080/?code=test&state=wrong")
	if err == nil || WebLoginStatus(err) != http.StatusBadRequest {
		t.Fatalf("expected invalid state error: %v", err)
	}

	transport := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = transport })
	http.DefaultTransport = oauthRoundTrip(func(r *http.Request) (*http.Response, error) {
		var body string
		switch r.URL.String() {
		case "https://idp.example.org/token":
			if err := r.ParseForm(); err != nil || r.Form.Get("code_verifier") != flow.flow.verifier {
				t.Fatal("missing PKCE verifier")
			}
			body = `{"access_token":"test-access","refresh_token":"test-refresh","expires_in":3600}`
		case "https://tenant.us-east-1.enterprise.quick.aws.com/integration/quick-work/user-info":
			body = `{"userInfo":{"email":"test@example.org"}}`
		default:
			t.Fatalf("unexpected OAuth destination %s", r.URL)
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})
	result, err := flow.Callback(ctx, "http://localhost:18080/#code=test&state="+state)
	if err != nil || result.Step != "complete" || result.AccountID == 0 {
		t.Fatalf("code exchange failed: %v", err)
	}
	a, err := st.Get(ctx, result.AccountID)
	if err != nil || a.Email != "test@example.org" {
		t.Fatalf("account was not saved: %v", err)
	}
}
