package resolvers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// defaultYouTubeOEmbedURL is YouTube's keyless oEmbed endpoint.
const defaultYouTubeOEmbedURL = "https://www.youtube.com/oembed"

// ErrNoVideoID is returned when a YouTube URL carries no recognisable video ID.
var ErrNoVideoID = errors.New("could not extract a video ID from the YouTube URL")

// videoIDPattern matches the characters YouTube uses in video IDs.
var videoIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// YouTubeResolver resolves video titles through YouTube's public oEmbed
// endpoint, which needs no API key.
type YouTubeResolver struct {
	client *http.Client
	// oembedURL is the endpoint base; tests point it at an httptest.Server.
	oembedURL string
}

func NewYouTubeResolver() *YouTubeResolver {
	return &YouTubeResolver{
		client:    SafeHttpClient(2 * time.Second),
		oembedURL: defaultYouTubeOEmbedURL,
	}
}

func (r *YouTubeResolver) Name() string {
	return "youtube"
}

func isYouTubeHost(host string) bool {
	host = strings.ToLower(host)
	switch host {
	case "youtube.com", "www.youtube.com", "m.youtube.com",
		"youtu.be",
		"youtube-nocookie.com", "www.youtube-nocookie.com":
		return true
	}
	return false
}

func (r *YouTubeResolver) CanHandle(u *url.URL) bool {
	return isYouTubeHost(u.Hostname())
}

// extractVideoID pulls the video ID out of the URL forms YouTube uses:
// watch?v=ID, youtu.be/ID, /shorts/ID, /live/ID, /embed/ID and /v/ID.
func extractVideoID(u *url.URL) string {
	var id string
	if strings.EqualFold(u.Hostname(), "youtu.be") {
		id = firstSegment(u.Path)
	} else {
		id = u.Query().Get("v")
		if id == "" {
			for _, prefix := range []string{"/shorts/", "/live/", "/embed/", "/v/"} {
				if strings.HasPrefix(u.Path, prefix) {
					id = firstSegment(strings.TrimPrefix(u.Path, prefix))
					break
				}
			}
		}
	}
	if !videoIDPattern.MatchString(id) {
		return ""
	}
	return id
}

func firstSegment(path string) string {
	path = strings.TrimPrefix(path, "/")
	if i := strings.IndexByte(path, '/'); i >= 0 {
		path = path[:i]
	}
	return path
}

type youTubeOEmbedResponse struct {
	Title      string `json:"title"`
	AuthorName string `json:"author_name"`
}

func (r *YouTubeResolver) Resolve(ctx context.Context, u *url.URL) (*Result, error) {
	videoID := extractVideoID(u)
	if videoID == "" {
		return nil, ErrNoVideoID
	}

	q := url.Values{
		"url":    {"https://www.youtube.com/watch?v=" + videoID},
		"format": {"json"},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, r.oembedURL+"?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", UserAgent)
	req.Header.Set("Accept", "application/json")

	resp, err := r.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("youtube oembed returned status %d", resp.StatusCode)
	}

	var data youTubeOEmbedResponse
	if err := json.NewDecoder(LimitJSON(resp.Body)).Decode(&data); err != nil {
		return nil, fmt.Errorf("youtube oembed: decoding response: %w", err)
	}

	title := SanitizeTitle(data.Title)
	if title == "" {
		return nil, ErrNoTitle
	}

	return &Result{
		Title:       title,
		Description: SanitizeDescription(data.AuthorName),
		Platform:    "YouTube",
	}, nil
}
