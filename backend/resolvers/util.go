package resolvers

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"
	"unicode"

	"golang.org/x/net/html"

	"github.com/shaunhickson/legible-links/backend/transport"
)

// UserAgent identifies every outbound request this service makes, so that
// site operators can recognise and, if they wish, block it.
const UserAgent = "LegibleLinks/0.9 (+https://github.com/shaunhickson/legible-links)"

const (
	// MaxHTMLBytes is how much of an HTML document is scanned for metadata.
	MaxHTMLBytes = 512 * 1024
	// MaxJSONBytes bounds the size of any JSON API response we decode.
	MaxJSONBytes = 256 * 1024
	// MaxTitleRunes caps the length of a title returned to clients.
	MaxTitleRunes = 300
	// MaxDescriptionRunes caps the length of a description returned to clients.
	MaxDescriptionRunes = 500
)

// ErrNoTitle is returned when a document contains no usable title.
var ErrNoTitle = errors.New("no title found")

// SafeHttpClient returns an http.Client with SSRF protection
func SafeHttpClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Transport: transport.NewSafeTransport(),
		Timeout:   timeout,
	}
}

// LimitJSON bounds a JSON response body before decoding.
func LimitJSON(r io.Reader) io.Reader {
	return io.LimitReader(r, MaxJSONBytes)
}

// IsHTMLContentType reports whether a Content-Type header value describes an
// HTML or XHTML document. An absent header is treated as HTML.
func IsHTMLContentType(ct string) bool {
	if strings.TrimSpace(ct) == "" {
		return true
	}
	mediaType, _, err := mime.ParseMediaType(ct)
	if err != nil {
		return false
	}
	return mediaType == "text/html" || mediaType == "application/xhtml+xml"
}

// ExtractMetadata tokenizes an HTML document and returns its title (preferring
// og:title over <title>) and og:description. Only the first MaxHTMLBytes are
// read and scanning stops at the end of <head>. All returned text is
// sanitized with SanitizeTitle / SanitizeDescription.
func ExtractMetadata(r io.Reader) (*Result, error) {
	z := html.NewTokenizer(io.LimitReader(r, MaxHTMLBytes))

	var ogTitle, ogDesc, title strings.Builder
	inTitle := false

scan:
	for {
		switch z.Next() {
		case html.ErrorToken:
			// io.EOF, the byte limit, or malformed input: use what we have.
			break scan

		case html.StartTagToken, html.SelfClosingTagToken:
			name, hasAttr := z.TagName()
			switch string(name) {
			case "meta":
				prop, content := metaAttrs(z, hasAttr)
				switch prop {
				case "og:title":
					if ogTitle.Len() == 0 {
						ogTitle.WriteString(content)
					}
				case "og:description":
					if ogDesc.Len() == 0 {
						ogDesc.WriteString(content)
					}
				}
			case "title":
				inTitle = true
			case "body":
				break scan
			}

		case html.EndTagToken:
			name, _ := z.TagName()
			switch string(name) {
			case "title":
				inTitle = false
			case "head":
				break scan
			}

		case html.TextToken:
			if inTitle {
				// The tokenizer treats <title> as RCDATA and has already
				// decoded character references in z.Text().
				title.Write(z.Text())
			}
		}
	}

	res := &Result{
		Title:       SanitizeTitle(ogTitle.String()),
		Description: SanitizeDescription(ogDesc.String()),
	}
	if res.Title == "" {
		res.Title = SanitizeTitle(title.String())
	}
	if res.Title == "" {
		return nil, ErrNoTitle
	}
	return res, nil
}

// metaAttrs returns the property (or name) and content attributes of the
// current <meta> token regardless of attribute order. Attribute values come
// back from the tokenizer with character references already decoded.
func metaAttrs(z *html.Tokenizer, hasAttr bool) (property, content string) {
	for hasAttr {
		var key, val []byte
		key, val, hasAttr = z.TagAttr()
		switch string(key) {
		case "property":
			property = strings.ToLower(strings.TrimSpace(string(val)))
		case "name":
			if property == "" {
				property = strings.ToLower(strings.TrimSpace(string(val)))
			}
		case "content":
			content = string(val)
		}
	}
	return property, content
}

// SanitizeTitle cleans text destined for a link's visible title.
func SanitizeTitle(s string) string { return sanitizeText(s, MaxTitleRunes) }

// SanitizeDescription cleans text destined for a tooltip or description.
func SanitizeDescription(s string) string { return sanitizeText(s, MaxDescriptionRunes) }

// sanitizeText strips C0/C1 control characters, bidirectional-override and
// zero-width characters, collapses runs of whitespace to a single space, trims,
// and caps the result at maxRunes runes.
func sanitizeText(s string, maxRunes int) string {
	var b strings.Builder
	b.Grow(len(s))

	pendingSpace := false
	count := 0 // runes written so far, spaces included
	for _, r := range s {
		switch {
		case isInvisibleFormatting(r):
			continue
		case unicode.IsSpace(r):
			pendingSpace = true
			continue
		case unicode.IsControl(r):
			continue
		}
		if pendingSpace && count > 0 {
			// A space is only emitted when the rune after it also fits, so
			// the result never ends in a space.
			if count+1 >= maxRunes {
				break
			}
			b.WriteByte(' ')
			count++
		}
		pendingSpace = false
		if count >= maxRunes {
			break
		}
		b.WriteRune(r)
		count++
	}
	return b.String()
}

// isInvisibleFormatting reports whether r is a bidi control, zero-width, or
// byte-order-mark character: invisible on screen but able to reorder or hide
// what is displayed.
func isInvisibleFormatting(r rune) bool {
	switch {
	case r == 0x061C: // ARABIC LETTER MARK
		return true
	case r >= 0x200B && r <= 0x200F: // zero-width space/joiners, LRM, RLM
		return true
	case r >= 0x202A && r <= 0x202E: // LRE, RLE, PDF, LRO, RLO
		return true
	case r >= 0x2060 && r <= 0x2064: // word joiner, invisible operators
		return true
	case r >= 0x2066 && r <= 0x2069: // LRI, RLI, FSI, PDI
		return true
	case r == 0xFEFF: // BOM / zero-width no-break space
		return true
	}
	return false
}
