package logger

import (
	"log/slog"
	"os"
)

// Init sets up the structured logger
func Init() {
	opts := &slog.HandlerOptions{
		Level: slog.LevelInfo,
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			// Map level -> severity (GCP convention)
			if a.Key == slog.LevelKey {
				a.Key = "severity"
			}
			// Map msg -> message (GCP convention)
			if a.Key == slog.MessageKey {
				a.Key = "message"
			}
			return a
		},
	}

	// Enable Debug level via env var
	if os.Getenv("DEBUG") == "true" {
		opts.Level = slog.LevelDebug
	}

	handler := slog.NewJSONHandler(os.Stdout, opts)
	logger := slog.New(handler)
	slog.SetDefault(logger)
}
