package middleware

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGzipMiddleware(t *testing.T) {
	testData := []byte("hello world this is some compressible text that should be compressed")

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(testData)
	})

	middlewareHandler := Gzip(handler)

	// Test case 1: Client accepts gzip
	t.Run("AcceptsGzip", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/", nil)
		req.Header.Set("Accept-Encoding", "gzip")
		rr := httptest.NewRecorder()

		middlewareHandler.ServeHTTP(rr, req)

		if rr.Header().Get("Content-Encoding") != "gzip" {
			t.Errorf("Expected Content-Encoding gzip, got %v", rr.Header().Get("Content-Encoding"))
		}

		if rr.Header().Get("Vary") != "Accept-Encoding" {
			t.Errorf("Expected Vary Accept-Encoding, got %v", rr.Header().Get("Vary"))
		}

		// Read the gzip response
		gz, err := gzip.NewReader(rr.Body)
		if err != nil {
			t.Fatalf("Failed to create gzip reader: %v", err)
		}
		defer func() { _ = gz.Close() }()

		uncompressed, err := io.ReadAll(gz)
		if err != nil {
			t.Fatalf("Failed to read uncompressed data: %v", err)
		}

		if !bytes.Equal(uncompressed, testData) {
			t.Errorf("Expected body %s, got %s", testData, uncompressed)
		}
	})

	// Test case 2: Client does not accept gzip
	t.Run("DoesNotAcceptGzip", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/", nil)
		rr := httptest.NewRecorder()

		middlewareHandler.ServeHTTP(rr, req)

		if rr.Header().Get("Content-Encoding") == "gzip" {
			t.Error("Did not expect Content-Encoding gzip")
		}

		if !bytes.Equal(rr.Body.Bytes(), testData) {
			t.Errorf("Expected body %s, got %s", testData, rr.Body.Bytes())
		}
	})
}
