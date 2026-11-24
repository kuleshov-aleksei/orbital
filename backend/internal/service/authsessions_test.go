package service

import "testing"

func TestDescribeDevice(t *testing.T) {
	cases := []struct {
		ua, client     string
		platform, name string
	}{
		{
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
			"", "web", "Chrome on Windows",
		},
		{
			"Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
			"", "web", "Firefox on Linux",
		},
		{
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
			"", "web", "Safari on macOS",
		},
		{
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
			"", "web", "Edge on Windows",
		},
		{
			"Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
			"", "web", "Safari on iOS",
		},
		{
			"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) orbital/1.5.2 Chrome/130.0.6723.191 Electron/33.2.1 Safari/537.36",
			"", "desktop", "Orbital desktop on Linux",
		},
		{
			"Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.39 Mobile Safari/537.36",
			"android/1.5.2", "android", "Orbital for Android 1.5.2",
		},
		{"", "", "web", "Unknown device"},
	}
	for _, c := range cases {
		platform, name := DescribeDevice(c.ua, c.client)
		if platform != c.platform || name != c.name {
			t.Errorf("DescribeDevice(%q, %q) = (%q, %q), want (%q, %q)", c.ua, c.client, platform, name, c.platform, c.name)
		}
	}
}
