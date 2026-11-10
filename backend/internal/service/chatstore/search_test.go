package chatstore

import (
	"context"
	"fmt"
	"testing"
)

func TestSearch(t *testing.T) {
	s, eng, _ := newTestService(t)
	ctx := context.Background()
	a := mustCreate(t, s, "r", "alice", "the quick brown fox")
	mustCreate(t, s, "r", "bob", "quick reply")
	mustCreate(t, s, "hidden", "alice", "quick secret")
	gone := mustCreate(t, s, "r", "alice", "quick but deleted")

	res, err := s.Search(ctx, SearchRequest{Text: "quick", RoomIDs: []string{"r"}})
	if err != nil {
		t.Fatal(err)
	}
	if res.Total != 3 || len(res.Hits) != 3 {
		t.Fatalf("hits = %d total = %d", len(res.Hits), res.Total)
	}
	eng.Hold()
	if _, err := s.Delete(ctx, gone.ID, "alice", nil); err != nil {
		t.Fatal(err)
	}
	res, _ = s.Search(ctx, SearchRequest{Text: "quick", RoomIDs: []string{"r"}, SenderIDs: []string{"alice"}})
	if len(res.Hits) != 1 || res.Hits[0].Message.ID != a.ID {
		t.Fatalf("filtered hits = %+v", res.Hits)
	}
	if want := "the " + HighlightPre + "quick" + HighlightPost + " brown fox"; res.Hits[0].Snippet != want {
		t.Fatalf("snippet = %q", res.Hits[0].Snippet)
	}
	eng.Release()
	if res, _ := s.Search(ctx, SearchRequest{Text: "quick"}); len(res.Hits) != 0 {
		t.Fatal("search without rooms must return nothing")
	}
}

func TestMentionCounts(t *testing.T) {
	s, _, _ := newTestService(t)
	ctx := context.Background()
	first := mustCreate(t, s, "r", "bob", "<@alice> old")
	mustCreate(t, s, "r", "bob", "<@alice> new")
	mustCreate(t, s, "r", "bob", "<@&mods> role")
	mustCreate(t, s, "r", "alice", "<@alice> self")
	gone := mustCreate(t, s, "r", "bob", "<@alice> deleted")
	if _, err := s.Delete(ctx, gone.ID, "bob", nil); err != nil {
		t.Fatal(err)
	}
	counts, err := s.MentionCounts(ctx, []MentionCountQuery{
		{RoomID: "r", AfterSeq: first.Seq, UserID: "alice", RoleIDs: []string{"mods"}},
		{RoomID: "r", UserID: "alice"},
	})
	if err != nil || fmt.Sprint(counts) != "[2 2]" {
		t.Fatalf("counts = %v %v", counts, err)
	}
}
