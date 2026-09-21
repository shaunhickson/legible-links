package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"github.com/shaunhickson/legible-links/backend/logger"
	"github.com/shaunhickson/legible-links/backend/middleware"
	"github.com/shaunhickson/legible-links/backend/resolvers"
)

const (
	// globalMaxConcurrentResolves bounds outbound fetches across all requests.
	globalMaxConcurrentResolves = 64
	// shutdownTimeout is how long in-flight requests get to finish on SIGTERM.
	shutdownTimeout = 10 * time.Second
)

func getEnvInt(key string, defaultVal int) int {
	if valStr := os.Getenv(key); valStr != "" {
		if val, err := strconv.Atoi(valStr); err == nil {
			return val
		}
	}
	return defaultVal
}

func main() {
	// Initialize Structured Logger
	logger.Init()

	if err := run(); err != nil {
		slog.Error("Server exited with error", "error", err)
		os.Exit(1)
	}
}

func run() error {
	// Load .env file if it exists
	if err := godotenv.Load(); err != nil {
		slog.Info("No .env file found, relying on environment variables")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	if os.Getenv("GOOGLE_CLOUD_PROJECT") != "" {
		slog.Warn("GOOGLE_CLOUD_PROJECT is set but ignored: Firestore support was removed; using the in-memory cache")
	}

	// Root context: cancelled on SIGINT/SIGTERM, which also stops background work.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Initialize Rate Limiter
	middleware.TrustedProxyHops = getEnvInt("TRUSTED_PROXY_HOPS", 0)
	rateLimiter := middleware.NewRateLimiter(getEnvInt("RATE_LIMIT_RPM", 60), getEnvInt("RATE_LIMIT_BURST", 20))
	rateLimiter.SetGlobalLimit(getEnvInt("GLOBAL_RATE_LIMIT_RPS", 50), getEnvInt("GLOBAL_RATE_LIMIT_BURST", 100))
	// Clean up old visitors every minute, expire after 3 minutes
	rateLimiter.CleanupBackground(ctx, 1*time.Minute, 3*time.Minute)

	// Initialize Cache (bounded, in-memory, non-persistent)
	slog.Info("Initializing in-memory cache", "max_entries", DefaultCacheMaxEntries, "ttl", DefaultCacheTTL.String())
	cache := NewInMemoryCache(DefaultCacheMaxEntries, DefaultCacheTTL)

	// Initialize Resolver Manager
	manager := resolvers.NewResolverManager(cache)
	if ms := getEnvInt("RESOLVER_TIMEOUT_MS", 0); ms > 0 {
		manager.SetTimeout(time.Duration(ms) * time.Millisecond)
	}
	manager.SetMaxConcurrent(getEnvInt("MAX_CONCURRENT_RESOLVES", resolvers.DefaultMaxConcurrent))
	manager.SetGlobalSemaphore(resolvers.NewSemaphore(globalMaxConcurrentResolves))

	registerResolvers(manager)

	handler := NewHandler(manager)
	handler.MaxItems = getEnvInt("MAX_ITEMS_PER_REQUEST", 50)
	handler.MaxBodyBytes = int64(getEnvInt("MAX_BODY_BYTES", 10240))

	// Set up routes (RequestLogger -> Gzip -> RateLimiter -> Handler)
	mux := http.NewServeMux()
	mux.Handle("/resolve", middleware.RequestLogger(middleware.Gzip(rateLimiter.Middleware(handler))))
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		setSecurityHeaders(w.Header())
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte("OK")); err != nil {
			slog.Error("Health check write failed", "error", err)
		}
	})

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		errCh <- srv.ListenAndServe()
	}()
	slog.Info("Server listening", "port", port)

	select {
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		slog.Info("Shutdown signal received, draining connections", "timeout", shutdownTimeout.String())
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("graceful shutdown: %w", err)
		}
		slog.Info("Server stopped")
		return nil
	}
}

// registerResolvers wires up every resolver, honouring ENABLED_RESOLVERS
// (comma-separated names) when set. None of them needs an API key.
func registerResolvers(manager *resolvers.ResolverManager) {
	enabledResolvers := os.Getenv("ENABLED_RESOLVERS")
	isEnabled := func(name string) bool {
		if enabledResolvers == "" {
			return true
		}
		for _, r := range strings.Split(enabledResolvers, ",") {
			if strings.TrimSpace(r) == name {
				return true
			}
		}
		return false
	}

	if isEnabled("youtube") {
		manager.Register(resolvers.NewYouTubeResolver())
	}
	if isEnabled("unshortener") {
		manager.Register(resolvers.NewUnshortenerResolver(manager))
	}
	if isEnabled("github") {
		// GITHUB_TOKEN is optional; it only raises the API rate limit.
		manager.Register(resolvers.NewGitHubResolver(os.Getenv("GITHUB_TOKEN")))
	}
	if isEnabled("wikipedia") {
		manager.Register(resolvers.NewWikipediaResolver())
	}
	// OpenGraph is the generic fallback and must be registered last.
	if isEnabled("opengraph") {
		manager.Register(resolvers.NewOpenGraphResolver())
	}
}
