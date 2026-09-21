package resolvers

import (
	"strings"
	"testing"
	"unicode"
	"unicode/utf8"
)

// FuzzExtractMetadata asserts the HTML metadata extractor never panics and
// that whatever it returns has already been sanitized: no control or bidi
// characters, no surrounding whitespace, within the rune caps.
func FuzzExtractMetadata(f *testing.F) {
	seeds := []string{
		`<html><head><title>Hello</title></head></html>`,
		`<html><head><meta property="og:title" content="OG &amp; co"><title>x</title></head>`,
		`<head><meta content='single' property='og:title'><meta property="og:description" content="d"></head>`,
		`<title>&lt;img src=x onerror=alert(1)&gt;</title>`,
		"<title>a" + string(rune(0x202E)) + "b" + string(rune(0)) + "c</title>",
		`<html><body><p>no head</p></body></html>`,
		`<title>` + strings.Repeat("x", 5000) + `</title>`,
		`<META PROPERTY="OG:TITLE" CONTENT="upper">`,
		``,
		`<title><!-- c --> t</title>`,
	}
	for _, s := range seeds {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, html string) {
		res, err := ExtractMetadata(strings.NewReader(html))
		if err != nil {
			return
		}
		checkClean(t, "title", res.Title, MaxTitleRunes)
		checkClean(t, "description", res.Description, MaxDescriptionRunes)
		if res.Title == "" {
			t.Fatalf("returned a result with an empty title")
		}
	})
}

// FuzzSanitizeText asserts the sanitizer's output invariants for any input.
func FuzzSanitizeText(f *testing.F) {
	seeds := []string{
		"",
		" a  b ",
		string(rune(0x202E)) + "evil" + string(rune(0x202C)),
		"x" + string(rune(0)) + "y",
		strings.Repeat("é", 400),
		string(rune(0xFEFF)) + "bom",
	}
	for _, s := range seeds {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, s string) {
		checkClean(t, "text", SanitizeTitle(s), MaxTitleRunes)
	})
}

func checkClean(t *testing.T, what, s string, maxRunes int) {
	t.Helper()
	if !utf8.ValidString(s) {
		t.Fatalf("%s is not valid UTF-8", what)
	}
	if utf8.RuneCountInString(s) > maxRunes {
		t.Fatalf("%s exceeds %d runes", what, maxRunes)
	}
	if strings.TrimSpace(s) != s {
		t.Fatalf("%s has surrounding whitespace: %q", what, s)
	}
	if strings.Contains(s, "  ") {
		t.Fatalf("%s has a double space: %q", what, s)
	}
	for _, r := range s {
		if unicode.IsControl(r) || isInvisibleFormatting(r) {
			t.Fatalf("%s contains U+%04X: %q", what, r, s)
		}
	}
}
