// Package errlog writes structured error events for quickproxy.
package errlog

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
)

// Open creates an ERROR-level JSON-lines logger. It appends to path and
// mirrors each record to stderr. An empty path selects stderr alone.
func Open(path string, stderr io.Writer) (*slog.Logger, io.Closer, error) {
	if stderr == nil {
		stderr = os.Stderr
	}
	options := &slog.HandlerOptions{Level: slog.LevelError}
	if path == "" {
		return slog.New(slog.NewJSONHandler(stderr, options)), noFile{}, nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, nil, fmt.Errorf("create error log directory: %w", err)
	}
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, nil, fmt.Errorf("open error log: %w", err)
	}
	info, err := file.Stat()
	if err == nil && !info.Mode().IsRegular() {
		err = errors.New("expected a regular file")
	}
	if err == nil && info.Mode().Perm() != 0o600 {
		err = file.Chmod(0o600)
	}
	if err != nil {
		file.Close()
		return nil, nil, fmt.Errorf("prepare error log: %w", err)
	}
	output := mirrorWriter{file: file, stderr: stderr}
	return slog.New(slog.NewJSONHandler(output, options)), file, nil
}

type noFile struct{}

func (noFile) Close() error { return nil }

type mirrorWriter struct {
	file   *os.File
	stderr io.Writer
}

func (w mirrorWriter) Write(record []byte) (int, error) {
	_, fileErr := w.file.Write(record)
	n, stderrErr := w.stderr.Write(record)
	if stderrErr == nil && n != len(record) {
		stderrErr = io.ErrShortWrite
	}
	// slog.Logger cannot return write failures to its caller. Report a failed
	// destination on the surviving output alongside the original event.
	if fileErr != nil && stderrErr == nil {
		slog.New(slog.NewJSONHandler(w.stderr, nil)).Error("could not write error log file", "cause", Cause(fileErr))
	}
	if stderrErr != nil && fileErr == nil {
		slog.New(slog.NewJSONHandler(w.file, nil)).Error("could not write error log to stderr", "cause", Cause(stderrErr))
	}
	if err := errors.Join(fileErr, stderrErr); err != nil {
		return 0, err
	}
	return len(record), nil
}

type loggerKey struct{}

// WithLogger makes logger available to operations derived from ctx.
func WithLogger(ctx context.Context, logger *slog.Logger) context.Context {
	return context.WithValue(ctx, loggerKey{}, logger)
}

// From returns the operation's logger or the process default.
func From(ctx context.Context) *slog.Logger {
	if logger, _ := ctx.Value(loggerKey{}).(*slog.Logger); logger != nil {
		return logger
	}
	return slog.Default()
}
