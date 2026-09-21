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

var wikiLangPattern = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)

type WikipediaResolver struct {
	client *http.Client
}

func NewWikipediaResolver() *WikipediaResolver {
	return &WikipediaResolver{
		client: SafeHttpClient(2 * time.Second),
	}
}

func (r *WikipediaResolver) Name() string {
	return "wikipedia"
}

func isWikipediaHost(host string) bool {
	host = strings.ToLower(host)
	return host == "wikipedia.org" || strings.HasSuffix(host, ".wikipedia.org")
}

func (r *WikipediaResolver) CanHandle(u *url.URL) bool {
	return isWikipediaHost(u.Hostname()) && strings.HasPrefix(u.Path, "/wiki/")
}

func (r *WikipediaResolver) Resolve(ctx context.Context, u *url.URL) (*Result, error) {
	// Extract the article title from the URL path (/wiki/Title)
	parts := strings.Split(u.Path, "/")
	if len(parts) < 3 || parts[2] == "" {
		return nil, errors.New("invalid wikipedia path")
	}
	articleTitle := parts[2]

	// The language is the subdomain (en.wikipedia.org -> en); default to en.
	hostParts := strings.Split(strings.ToLower(u.Hostname()), ".")
	lang := "en"
	if len(hostParts) == 3 && wikiLangPattern.MatchString(hostParts[0]) {
		lang = hostParts[0]
	}

	apiURL := fmt.Sprintf("https://%s.wikipedia.org/api/rest_v1/page/summary/%s", lang, url.PathEscape(articleTitle))

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
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
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	var data struct {
		Title       string `json:"title"`
		Description string `json:"description"`
	}

	if err := json.NewDecoder(LimitJSON(resp.Body)).Decode(&data); err != nil {
		return nil, err
	}

	title := data.Title
	if data.Description != "" {
		title = fmt.Sprintf("%s - %s", title, data.Description)
	}

	return &Result{
		Title:    title,
		Platform: "Wikipedia",
	}, nil
}
