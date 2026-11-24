package service

import (
	"regexp"
	"testing"
)

// IDs made back to back must differ: the random part used to come from the
// clock, so two rooms created in the same tick got the same id and the second
// insert failed (flaky RBAC fixture).
func TestGenerateIDUniqueBackToBack(t *testing.T) {
	format := regexp.MustCompile(`^\d{14}[A-Za-z0-9]{6}$`)
	seen := make(map[string]bool, 10000)
	for i := 0; i < 10000; i++ {
		id := generateID()
		if !format.MatchString(id) {
			t.Fatalf("id %q doesn't match the room id format", id)
		}
		if seen[id] {
			t.Fatalf("duplicate id %q after %d ids", id, i)
		}
		seen[id] = true
	}
}
