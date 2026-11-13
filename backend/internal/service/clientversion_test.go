package service

import "testing"

func TestParseAppVersion(t *testing.T) {
	cases := map[string]bool{
		"1.5.0": true, "v1.5.0": true, "1.5.0-816skays": true, " 2.10.3 ": true,
		"dev-unknown": false, "": false, "1.5": false, "1.5.x": false, "1.-5.0": false,
	}
	for in, ok := range cases {
		if _, got := ParseAppVersion(in); got != ok {
			t.Errorf("ParseAppVersion(%q) ok = %v, want %v", in, got, ok)
		}
	}
	a, _ := ParseAppVersion("1.10.0")
	b, _ := ParseAppVersion("1.9.9")
	if CompareAppVersions(a, b) != 1 || CompareAppVersions(b, a) != -1 || CompareAppVersions(a, a) != 0 {
		t.Fatal("numeric (not lexical) comparison expected")
	}
}

func TestClientVersionIsOutdated(t *testing.T) {
	store := NewMemoryAppSettings()
	s, err := NewClientVersionService(store)
	if err != nil {
		t.Fatal(err)
	}
	if s.IsOutdated("android/0.0.1") {
		t.Fatal("no floor: nothing is outdated")
	}
	notified := 0
	s.OnChange(func() { notified++ })
	if err := s.SetAndroidMinVersion("1.5.0"); err != nil {
		t.Fatal(err)
	}
	if notified != 1 {
		t.Fatalf("listeners notified %d times", notified)
	}

	cases := map[string]bool{
		"android/1.4.9":          true,
		"Android/1.4.9-abcd1234": true,
		"android/1.5.0":          false,
		"android/1.5.0-abcd1234": false,
		"android/2.0.0":          false,
		"android/dev-unknown":    false, // dev builds are never blocked
		"android":                false,
		"electron/1.0.0":         false, // Android only
		"web/1.0.0":              false,
		"":                       false,
	}
	for client, want := range cases {
		if got := s.IsOutdated(client); got != want {
			t.Errorf("IsOutdated(%q) = %v, want %v", client, got, want)
		}
	}

	// The floor survives a restart and can be cleared.
	s2, _ := NewClientVersionService(store)
	if s2.AndroidMinVersion() != "1.5.0" {
		t.Fatalf("reloaded floor = %q", s2.AndroidMinVersion())
	}
	if err := s.SetAndroidMinVersion("nope"); err == nil {
		t.Fatal("invalid version accepted")
	}
	if err := s.SetAndroidMinVersion(""); err != nil || s.IsOutdated("android/0.0.1") {
		t.Fatal("clearing the floor should unblock everyone")
	}
}
