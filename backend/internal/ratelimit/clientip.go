package ratelimit

import (
	"net"
	"net/http"
	"strings"
)

func ClientIP(r *http.Request) string {
	if r == nil {
		return ""
	}

	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		first, _, _ := strings.Cut(forwarded, ",")
		if ip := normalizeIP(strings.TrimSpace(first)); ip != "" {
			return ip
		}
	}

	if ip := normalizeIP(r.RemoteAddr); ip != "" {
		return ip
	}
	return r.RemoteAddr
}

func normalizeIP(value string) string {
	if value == "" {
		return ""
	}

	host := value
	if parsedHost, _, err := net.SplitHostPort(value); err == nil {
		host = parsedHost
	}
	host = strings.Trim(host, "[]")

	if ip := net.ParseIP(host); ip != nil {
		return ip.String()
	}
	return ""
}
