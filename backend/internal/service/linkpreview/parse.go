package linkpreview

import (
	"bytes"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"

	"golang.org/x/net/html"
	"golang.org/x/net/html/charset"
)

const (
	maxTitleRunes       = 256
	maxDescriptionRunes = 350
	maxSiteNameRunes    = 100
)

// pageMeta is what a page says about itself.
type pageMeta struct {
	title, description, siteName, image string
}

// parseHead reads the OpenGraph / Twitter / plain HTML metadata of a page.
// The body may be in any charset (declared in the header or a <meta>).
func parseHead(body []byte, contentType, headerCharset string) pageMeta {
	ct := contentType
	if headerCharset != "" {
		ct += "; charset=" + headerCharset
	}
	r, err := charset.NewReader(bytes.NewReader(body), ct)
	if err != nil {
		r = bytes.NewReader(body)
	}

	og := map[string]string{}
	var title string
	inTitle := false
	z := html.NewTokenizer(r)
loop:
	for {
		switch z.Next() {
		case html.ErrorToken:
			break loop
		case html.StartTagToken, html.SelfClosingTagToken:
			name, hasAttr := z.TagName()
			switch string(name) {
			case "meta":
				if !hasAttr {
					continue
				}
				var key, content string
				for {
					k, v, more := z.TagAttr()
					switch string(k) {
					case "property", "name", "itemprop":
						if key == "" {
							key = strings.ToLower(strings.TrimSpace(string(v)))
						}
					case "content":
						content = string(v)
					}
					if !more {
						break
					}
				}
				if key != "" && content != "" {
					if _, dup := og[key]; !dup {
						og[key] = content
					}
				}
			case "title":
				inTitle = title == ""
			case "body":
				break loop // metadata lives in <head>
			}
		case html.TextToken:
			if inTitle {
				title += string(z.Text())
			}
		case html.EndTagToken:
			name, _ := z.TagName()
			switch string(name) {
			case "title":
				inTitle = false
			case "head":
				break loop
			}
		}
	}

	pick := func(keys ...string) string {
		for _, k := range keys {
			if v := strings.TrimSpace(og[k]); v != "" {
				return v
			}
		}
		return ""
	}
	return pageMeta{
		title:       clip(pick("og:title", "twitter:title"), title, maxTitleRunes),
		description: clip(pick("og:description", "twitter:description", "description"), "", maxDescriptionRunes),
		siteName:    clip(pick("og:site_name", "application-name"), "", maxSiteNameRunes),
		image:       pick("og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"),
	}
}

var spaceRe = regexp.MustCompile(`\s+`)

// clip collapses whitespace and cuts s (or fallback when s is empty) to n
// runes with an ellipsis.
func clip(s, fallback string, n int) string {
	if s == "" {
		s = fallback
	}
	s = strings.TrimSpace(spaceRe.ReplaceAllString(html.UnescapeString(s), " "))
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return strings.TrimSpace(string(r[:n-1])) + "…"
}

// resolveRef resolves a (possibly relative) image URL against the page.
func resolveRef(base *url.URL, ref string) string {
	if ref == "" {
		return ""
	}
	u, err := base.Parse(strings.TrimSpace(ref))
	if err != nil || !allowedURL(u) {
		return ""
	}
	return u.String()
}

var youtubeIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

// youtubeID returns the video id of a YouTube watch/short/share link.
func youtubeID(u *url.URL) string {
	host := strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
	host = strings.TrimPrefix(host, "m.")
	var id string
	switch host {
	case "youtu.be":
		id = strings.Trim(u.Path, "/")
	case "youtube.com", "music.youtube.com", "youtube-nocookie.com":
		switch {
		case u.Path == "/watch":
			id = u.Query().Get("v")
		case strings.HasPrefix(u.Path, "/shorts/"), strings.HasPrefix(u.Path, "/embed/"),
			strings.HasPrefix(u.Path, "/live/"):
			parts := strings.Split(strings.Trim(u.Path, "/"), "/")
			if len(parts) >= 2 {
				id = parts[1]
			}
		}
	}
	if youtubeIDRe.MatchString(id) {
		return id
	}
	return ""
}
