package errlog

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"strings"
	"syscall"

	"github.com/gorilla/websocket"
)

type httpStatusError struct {
	err    error
	status int
}

func (e httpStatusError) Error() string       { return e.err.Error() }
func (e httpStatusError) Unwrap() error       { return e.err }
func (e httpStatusError) HTTPStatusCode() int { return e.status }

// WithHTTPStatus preserves err for its existing callers while attaching a
// numeric upstream status for diagnostics.
func WithHTTPStatus(err error, status int) error {
	if err == nil || status < 100 || status > 599 {
		return err
	}
	return httpStatusError{err, status}
}

type operationError struct {
	operation string
	err       error
}

func (e operationError) Error() string { return e.err.Error() }
func (e operationError) Unwrap() error { return e.err }

// At attaches a fixed operation description for logs without changing err's
// message. Callers must use labels defined in code, never request data.
func At(operation string, err error) error {
	if err == nil {
		return nil
	}
	return operationError{operation, err}
}

// Cause returns diagnostic text suitable for logs. An upstream error's
// message can contain credentials, query parameters, or conversation text.
// Only fixed descriptions and typed numeric status codes are copied here.
func Cause(err error) string {
	reason := safeReason(err)
	var operations []string
	var step operationError
	for errors.As(err, &step) {
		operations = append(operations, step.operation)
		err = step.err
	}
	if len(operations) == 0 {
		return reason
	}
	if reason != "operation failed" {
		operations = append(operations, reason)
	}
	return strings.Join(operations, ": ")
}

func safeReason(err error) string {
	switch {
	case err == nil:
		return ""
	case errors.Is(err, context.Canceled):
		return "operation canceled"
	case errors.Is(err, context.DeadlineExceeded):
		return "deadline exceeded"
	case errors.Is(err, fs.ErrPermission):
		return "permission denied"
	case errors.Is(err, fs.ErrNotExist):
		return "file or directory not found"
	case errors.Is(err, fs.ErrClosed):
		return "file closed"
	case errors.Is(err, syscall.ENOSPC):
		return "no space left on device"
	case errors.Is(err, syscall.EADDRINUSE):
		return "address already in use"
	case errors.Is(err, syscall.ECONNREFUSED):
		return "connection refused"
	case errors.Is(err, syscall.ECONNRESET):
		return "connection reset"
	case errors.Is(err, syscall.ENETUNREACH):
		return "network unreachable"
	case errors.Is(err, sql.ErrNoRows):
		return "record not found"
	case errors.Is(err, io.ErrShortWrite):
		return "short write"
	case errors.Is(err, io.EOF), errors.Is(err, io.ErrUnexpectedEOF):
		return "unexpected end of input"
	}

	var statusErr interface{ HTTPStatusCode() int }
	if errors.As(err, &statusErr) {
		if status := statusErr.HTTPStatusCode(); status >= 100 && status <= 599 {
			return fmt.Sprintf("upstream HTTP %d", status)
		}
	}
	var closeErr *websocket.CloseError
	if errors.As(err, &closeErr) && closeErr.Code >= 1000 && closeErr.Code <= 4999 {
		return fmt.Sprintf("upstream WebSocket close %d", closeErr.Code)
	}

	var certErr *tls.CertificateVerificationError
	var unknownCA x509.UnknownAuthorityError
	var invalidCert x509.CertificateInvalidError
	var hostname x509.HostnameError
	if errors.As(err, &certErr) || errors.As(err, &unknownCA) || errors.As(err, &invalidCert) || errors.As(err, &hostname) {
		return "TLS certificate verification failed"
	}
	var dns *net.DNSError
	if errors.As(err, &dns) {
		return "DNS lookup failed"
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		if netErr.Timeout() {
			return "network timeout"
		}
		return "network request failed"
	}
	return "operation failed"
}
