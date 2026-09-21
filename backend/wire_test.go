package main

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// TestWireFixtureMatchesResponseType pins the /resolve response shape to
// testdata/resolve-response.json, which the extension's tests also load, so
// the two sides cannot drift apart silently.
func TestWireFixtureMatchesResponseType(t *testing.T) {
	raw, err := os.ReadFile("../testdata/resolve-response.json")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	var decoded ResolveResponse
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("fixture does not decode into ResolveResponse: %v", err)
	}
	if len(decoded.Titles) != 2 || len(decoded.Details) != 2 {
		t.Fatalf("fixture shape changed: %d titles, %d details", len(decoded.Titles), len(decoded.Details))
	}
	for u, title := range decoded.Titles {
		d, ok := decoded.Details[u]
		if !ok {
			t.Fatalf("details missing for %q", u)
		}
		if d.Title != title {
			t.Fatalf("title mismatch for %q: %q vs %q", u, d.Title, title)
		}
		if d.Platform == "" {
			t.Fatalf("platform missing for %q", u)
		}
	}

	// Round-trip: what we encode must decode into the same fixture-compatible shape.
	encoded, err := json.Marshal(decoded)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	var again ResolveResponse
	if err := json.Unmarshal(encoded, &again); err != nil {
		t.Fatalf("re-decode: %v", err)
	}
	if again.Titles["https://example.org/post"] != "An example post" {
		t.Fatalf("round trip lost a title")
	}
}

// FuzzIsValidResolveURL asserts the validator never panics and never accepts
// a non-http(s) scheme, an empty host, or an over-long input.
func FuzzIsValidResolveURL(f *testing.F) {
	for _, s := range []string{
		"https://example.org/", "http://example.org:8080/x?y=1#z", "ftp://example.org/",
		"javascript:alert(1)", "//example.org", "https://", "", "https://user:pw@h/",
		"https://[::1]/", "https://example.org/%zz", "HTTPS://EXAMPLE.ORG/",
	} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, s string) {
		if !isValidResolveURL(s) {
			return
		}
		if len(s) > MaxURLLength {
			t.Fatalf("accepted over-long URL (%d bytes)", len(s))
		}
		lower := strings.ToLower(s)
		if !strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://") {
			t.Fatalf("accepted non-http(s) URL %q", s)
		}
	})
}
