package errlog

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"testing"

	"github.com/gorilla/websocket"
)

func TestAppendAndMirror(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "logs")
	path := filepath.Join(dir, "error.log")
	var stderr bytes.Buffer
	for range 2 {
		log, closer, err := Open(path, &stderr)
		if err != nil {
			t.Fatal(err)
		}
		log.Info("health check")
		var workers sync.WaitGroup
		for id := range 8 {
			workers.Go(func() { log.Error("refresh failed", "account_id", id) })
		}
		workers.Wait()
		if err := closer.Close(); err != nil {
			t.Fatal(err)
		}
	}
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(stderr.Bytes(), body) {
		t.Fatal("file and stderr should contain the same JSON lines")
	}
	lines := strings.Split(strings.TrimSpace(string(body)), "\n")
	if len(lines) != 16 {
		t.Fatalf("got %d log lines, want 16", len(lines))
	}
	for _, line := range lines {
		var event map[string]any
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			t.Fatal(err)
		}
		if event["level"] != "ERROR" || event["msg"] != "refresh failed" || event["time"] == nil {
			t.Fatalf("unexpected event: %s", line)
		}
	}
	if runtime.GOOS != "windows" {
		for name, want := range map[string]os.FileMode{path: 0o600, dir: 0o700} {
			st, err := os.Stat(name)
			if err != nil || st.Mode().Perm() != want {
				t.Errorf("unexpected permissions on %s: %v, %v", name, st, err)
			}
		}
	}
}

func TestWriteFailureReported(t *testing.T) {
	var stderr bytes.Buffer
	log, closer, err := Open(filepath.Join(t.TempDir(), "error.log"), &stderr)
	if err != nil {
		t.Fatal(err)
	}
	if err := closer.Close(); err != nil {
		t.Fatal(err)
	}
	log.Error("request failed")
	if !strings.Contains(stderr.String(), "request failed") || !strings.Contains(stderr.String(), "file closed") {
		t.Fatalf("missing original event or write failure: %s", stderr.String())
	}
}

func TestStderrOnlyAndContext(t *testing.T) {
	var stderr bytes.Buffer
	log, closer, err := Open("", &stderr)
	if err != nil {
		t.Fatal(err)
	}
	defer closer.Close()
	ctx := context.Background()
	if From(ctx) != slog.Default() || From(WithLogger(ctx, log)) != log {
		t.Fatal("logger context did not resolve")
	}
	log.Error("listen failed")
	if !strings.Contains(stderr.String(), "listen failed") {
		t.Fatal("missing stderr record")
	}
}

func TestSafeCauses(t *testing.T) {
	sensitive := errors.New("Bearer hidden; password=hidden")
	httpErr := WithHTTPStatus(sensitive, 401)
	if httpErr.Error() != sensitive.Error() || !errors.Is(httpErr, sensitive) || WithHTTPStatus(nil, 401) != nil {
		t.Fatal("HTTP diagnostic changed the existing error")
	}
	stageErr := At("register client", httpErr)
	if stageErr.Error() != sensitive.Error() || !errors.Is(stageErr, sensitive) || At("register client", nil) != nil {
		t.Fatal("operation diagnostic changed the existing error")
	}
	for _, tc := range []struct {
		err  error
		want string
	}{
		{nil, ""},
		{sensitive, "operation failed"},
		{fmt.Errorf("secret: %w", context.DeadlineExceeded), "deadline exceeded"},
		{&url.Error{Op: "GET", URL: "https://example/?secret", Err: syscall.ECONNREFUSED}, "connection refused"},
		{&net.DNSError{Err: sensitive.Error(), Name: "private"}, "DNS lookup failed"},
		{&websocket.CloseError{Code: 1008, Text: sensitive.Error()}, "upstream WebSocket close 1008"},
		{io.ErrUnexpectedEOF, "unexpected end of input"},
		{httpErr, "upstream HTTP 401"},
		{stageErr, "register client: upstream HTTP 401"},
		{At("begin login", At("register client", sensitive)), "begin login: register client"},
	} {
		if got := Cause(tc.err); got != tc.want {
			t.Errorf("Cause(%T) = %q, want %q", tc.err, got, tc.want)
		}
	}
}
