package main

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"

	"github.com/shaunhickson/legible-links/backend/resolvers"
)

// MaxURLLength is the longest URL accepted in a resolve request.
const MaxURLLength = 2048

type ResolveRequest struct {
	URLs []string `json:"urls"`
}

type ResolveResponse struct {
	Titles  map[string]string            `json:"titles"`
	Details map[string]*resolvers.Result `json:"details,omitempty"`
}

type Handler struct {
	manager      *resolvers.ResolverManager
	MaxBodyBytes int64
	MaxItems     int
}

func NewHandler(manager *resolvers.ResolverManager) *Handler {
	return &Handler{
		manager:      manager,
		MaxBodyBytes: 10 * 1024, // Default 10KB
		MaxItems:     50,        // Default 50 items
	}
}

// setSecurityHeaders marks every response as uncacheable and non-sniffable.
func setSecurityHeaders(h http.Header) {
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	setSecurityHeaders(w.Header())

	// CORS: the extension's content script has no stable origin.
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 1. Limit Body Size
	r.Body = http.MaxBytesReader(w, r.Body, h.MaxBodyBytes)

	var req ResolveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			http.Error(w, "Request body too large", http.StatusRequestEntityTooLarge)
		} else {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
		}
		return
	}

	// 2. Limit Item Count
	if len(req.URLs) > h.MaxItems {
		http.Error(w, "Too many items in request", http.StatusRequestEntityTooLarge)
		return
	}

	// 3. Validate and dedupe
	urls := normalizeURLs(req.URLs)

	w.Header().Set("Content-Type", "application/json")

	if len(urls) == 0 {
		if err := json.NewEncoder(w).Encode(ResolveResponse{Titles: map[string]string{}}); err != nil {
			slog.Error("Error encoding empty response", "error", err)
		}
		return
	}

	// 4. Resolve
	results := make(map[string]string)
	details := make(map[string]*resolvers.Result)

	for u, res := range h.manager.ResolveMulti(r.Context(), urls) {
		results[u] = res.Title
		details[u] = res
	}

	if err := json.NewEncoder(w).Encode(ResolveResponse{
		Titles:  results,
		Details: details,
	}); err != nil {
		slog.Error("Error encoding response", "error", err)
	}
}

// normalizeURLs drops entries that are not well-formed http(s) URLs of
// acceptable length and removes duplicates, preserving first-seen order.
func normalizeURLs(raw []string) []string {
	seen := make(map[string]struct{}, len(raw))
	out := make([]string, 0, len(raw))
	for _, s := range raw {
		if !isValidResolveURL(s) {
			continue
		}
		if _, dup := seen[s]; dup {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	return out
}

func isValidResolveURL(s string) bool {
	if s == "" || len(s) > MaxURLLength {
		return false
	}
	u, err := url.Parse(s)
	if err != nil {
		return false
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}
	return u.Hostname() != ""
}
