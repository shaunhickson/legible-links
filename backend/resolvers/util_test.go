package resolvers

import (
	"errors"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestSafeHttpClient_BlocksPrivate(t *testing.T) {
	client := SafeHttpClient(1 * time.Second)
	_, err := client.Get("http://127.0.0.1:12345")
	if err == nil {
		t.Error("Expected error for 127.0.0.1, got nil")
	} else if !strings.Contains(err.Error(), "blocked") {
		t.Errorf("Expected 'blocked' error, got: %v", err)
	}
}

func TestIsHTMLContentType(t *testing.T) {
	tests := []struct {
		ct   string
		want bool
	}{
		{"", true},
		{"text/html", true},
		{"text/html; charset=utf-8", true},
		{"TEXT/HTML; charset=ISO-8859-1", true},
		{"application/xhtml+xml", true},
		{"application/json", false},
		{"image/png", false},
		{"text/plain", false},
		{"application/octet-stream", false},
		{"not a media type", false},
	}
	for _, tc := range tests {
		if got := IsHTMLContentType(tc.ct); got != tc.want {
			t.Errorf("IsHTMLContentType(%q) = %v, want %v", tc.ct, got, tc.want)
		}
	}
}

func TestExtractMetadata(t *testing.T) {
	tests := []struct {
		name     string
		html     string
		want     string
		wantDesc string
	}{
		{
			name: "OG Title",
			html: `<html><head><meta property="og:title" content="OG Title"><title>Fallback Title</title></head></html>`,
			want: "OG Title",
		},
		{
			name: "Standard Title",
			html: `<html><head><title>Standard Title</title></head></html>`,
			want: "Standard Title",
		},
		{
			name: "With Entities",
			html: `<html><head><title>A &amp; B &quot;C&quot; &#39;D&#39;</title></head></html>`,
			want: `A & B "C" 'D'`,
		},
		{
			name:     "OG Description",
			html:     `<html><head><meta property="og:title" content="Title"><meta property="og:description" content="Desc"></head></html>`,
			want:     "Title",
			wantDesc: "Desc",
		},
		{
			name:     "Attribute order swapped",
			html:     `<html><head><meta content="Swapped Title" property="og:title"><meta content="Swapped Desc" property="og:description"></head></html>`,
			want:     "Swapped Title",
			wantDesc: "Swapped Desc",
		},
		{
			name: "Single quotes",
			html: `<html><head><meta property='og:title' content='Single Quoted'></head></html>`,
			want: "Single Quoted",
		},
		{
			name: "Unquoted attribute values",
			html: `<html><head><meta property=og:title content=Unquoted></head></html>`,
			want: "Unquoted",
		},
		{
			name: "Self-closing meta",
			html: `<html><head><meta property="og:title" content="Self Closing" /></head></html>`,
			want: "Self Closing",
		},
		{
			name: "Uppercase tags and attributes",
			html: `<HTML><HEAD><META PROPERTY="og:title" CONTENT="Upper"></HEAD></HTML>`,
			want: "Upper",
		},
		{
			name: "Entities in og:title content",
			html: `<html><head><meta property="og:title" content="Tom &amp; Jerry &quot;S1&quot;"></head></html>`,
			want: `Tom & Jerry "S1"`,
		},
		{
			name: "Escaped markup in title stays literal text",
			html: `<html><head><title>&lt;img&gt;</title></head></html>`,
			want: "<img>",
		},
		{
			name: "Escaped markup in og:title stays literal text",
			html: `<html><head><meta property="og:title" content="&lt;img src=x onerror=alert(1)&gt;"></head></html>`,
			want: "<img src=x onerror=alert(1)>",
		},
		{
			name: "Raw markup inside title is text, not tags",
			html: `<html><head><title>Hello <b>World</b></title></head></html>`,
			want: "Hello <b>World</b>",
		},
		{
			name: "Whitespace collapsed and trimmed",
			html: "<html><head><title>\n\t  Hello \r\n   World  \t</title></head></html>",
			want: "Hello World",
		},
		{
			name: "Empty og:title falls back to title",
			html: `<html><head><meta property="og:title" content="   "><title>Real Title</title></head></html>`,
			want: "Real Title",
		},
		{
			name: "First og:title wins",
			html: `<html><head><meta property="og:title" content="First"><meta property="og:title" content="Second"></head></html>`,
			want: "First",
		},
		{
			name: "Meta in body is ignored after head",
			html: `<html><head><title>Head Title</title></head><body><meta property="og:title" content="Body Title"></body></html>`,
			want: "Head Title",
		},
		{
			name: "No head element at all",
			html: `<title>Bare Title</title><p>text</p>`,
			want: "Bare Title",
		},
		{
			name: "Title split across text tokens with comment",
			html: `<html><head><title>Part <!-- c --> One</title></head></html>`,
			want: "Part <!-- c --> One",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res, err := ExtractMetadata(strings.NewReader(tt.html))
			if err != nil {
				t.Fatalf("ExtractMetadata failed: %v", err)
			}
			if res.Title != tt.want {
				t.Errorf("Got title %q, want %q", res.Title, tt.want)
			}
			if tt.wantDesc != "" && res.Description != tt.wantDesc {
				t.Errorf("Got description %q, want %q", res.Description, tt.wantDesc)
			}
		})
	}
}

func TestExtractMetadata_NoTitle(t *testing.T) {
	for _, doc := range []string{
		``,
		`<html><head></head><body>no title</body></html>`,
		`<html><head><title></title></head></html>`,
		`<html><head><title>   </title></head></html>`,
		"<html><head><title>\u202E\u200B</title></head></html>",
		`<html><head><meta property="og:description" content="Desc only"></head></html>`,
	} {
		_, err := ExtractMetadata(strings.NewReader(doc))
		if !errors.Is(err, ErrNoTitle) {
			t.Errorf("doc %q: got err %v, want ErrNoTitle", doc, err)
		}
	}
}

func TestExtractMetadata_Sanitizes(t *testing.T) {
	t.Run("bidi override stripped", func(t *testing.T) {
		res, err := ExtractMetadata(strings.NewReader("<html><head><title>\u202Eevil\u202C safe\u2066x\u2069</title></head></html>"))
		if err != nil {
			t.Fatal(err)
		}
		// Invisible characters are removed outright, not turned into spaces,
		// so "safe⁦x" joins up as "safex".
		if res.Title != "evil safex" {
			t.Errorf("got %q", res.Title)
		}
		for _, r := range res.Title {
			if isInvisibleFormatting(r) {
				t.Errorf("title still contains U+%04X", r)
			}
		}
	})

	t.Run("control characters stripped", func(t *testing.T) {
		res, err := ExtractMetadata(strings.NewReader("<html><head><title>a\x01b\x7fc\u0085d</title></head></html>"))
		if err != nil {
			t.Fatal(err)
		}
		// U+0085 (NEL) is whitespace and collapses to a space; the rest vanish.
		if res.Title != "abc d" {
			t.Errorf("got %q", res.Title)
		}
	})

	t.Run("600 char title capped at 300 runes", func(t *testing.T) {
		long := strings.Repeat("x", 600)
		res, err := ExtractMetadata(strings.NewReader("<html><head><title>" + long + "</title></head></html>"))
		if err != nil {
			t.Fatal(err)
		}
		if n := utf8.RuneCountInString(res.Title); n != MaxTitleRunes {
			t.Errorf("got %d runes, want %d", n, MaxTitleRunes)
		}
	})

	t.Run("cap counts runes not bytes", func(t *testing.T) {
		long := strings.Repeat("é", 400)
		res, err := ExtractMetadata(strings.NewReader("<html><head><title>" + long + "</title></head></html>"))
		if err != nil {
			t.Fatal(err)
		}
		if n := utf8.RuneCountInString(res.Title); n != MaxTitleRunes {
			t.Errorf("got %d runes, want %d", n, MaxTitleRunes)
		}
		if !utf8.ValidString(res.Title) {
			t.Error("title is not valid UTF-8")
		}
	})

	t.Run("description capped at 500 runes", func(t *testing.T) {
		long := strings.Repeat("d", 800)
		res, err := ExtractMetadata(strings.NewReader(`<html><head><title>T</title><meta property="og:description" content="` + long + `"></head></html>`))
		if err != nil {
			t.Fatal(err)
		}
		if n := utf8.RuneCountInString(res.Description); n != MaxDescriptionRunes {
			t.Errorf("got %d runes, want %d", n, MaxDescriptionRunes)
		}
	})
}

func TestExtractMetadata_StopsAtByteLimit(t *testing.T) {
	// A title placed beyond the scan limit must not be found, proving the
	// reader is bounded rather than slurped.
	padding := "<!--" + strings.Repeat("p", MaxHTMLBytes) + "-->"
	doc := "<html><head>" + padding + "<title>Too Far</title></head></html>"
	_, err := ExtractMetadata(strings.NewReader(doc))
	if !errors.Is(err, ErrNoTitle) {
		t.Errorf("expected ErrNoTitle beyond the byte limit, got %v", err)
	}
}

func TestSanitizeText(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"", ""},
		{"   ", ""},
		{"plain", "plain"},
		{"  lead and trail  ", "lead and trail"},
		{"a\u200Bb\u200Fc\uFEFFd", "abcd"},
		{"\u202Aabc\u202C", "abc"},
		{"a\u061Cb", "ab"},
		{"tab\tsep\nline", "tab sep line"},
		{"nbsp\u00A0here", "nbsp here"},
		{"multi     space", "multi space"},
		{"\x00\x01\x02", ""},
		{"emoji \U0001F600 ok", "emoji \U0001F600 ok"},
	}
	for _, tc := range tests {
		if got := sanitizeText(tc.in, 100); got != tc.want {
			t.Errorf("sanitizeText(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}

	if got := sanitizeText("abcdef", 3); got != "abc" {
		t.Errorf("cap: got %q, want %q", got, "abc")
	}
	if got := sanitizeText("ab cd", 3); got != "ab" {
		t.Errorf("cap at boundary should not leave trailing space: got %q", got)
	}
}
