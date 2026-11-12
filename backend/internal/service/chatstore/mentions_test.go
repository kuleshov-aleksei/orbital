package chatstore

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

func TestParseMentions(t *testing.T) {
	users, roles := ParseMentions("hi <@alice> and <@&mods>, <@alice> again <@bob> <@&mods> <@ bad>")
	if fmt.Sprint(users) != "[alice bob]" || fmt.Sprint(roles) != "[mods]" {
		t.Fatalf("users=%v roles=%v", users, roles)
	}
}

func TestParseMentionsWithRealIDs(t *testing.T) {
	// User ids are padded URL-safe base64 (authservice generateUserID).
	users, roles := ParseMentions("<@qkUrdzLDoqslx8EEy2cM7Q==> <@v8iilBQdJ2L0Y_FqOS45Wg==> <@&a1b2-c3>")
	if fmt.Sprint(users) != "[qkUrdzLDoqslx8EEy2cM7Q== v8iilBQdJ2L0Y_FqOS45Wg==]" || fmt.Sprint(roles) != "[a1b2-c3]" {
		t.Fatalf("users=%v roles=%v", users, roles)
	}
	if got := SearchText("hi <@qkUrdzLDoqslx8EEy2cM7Q==>!"); got != "hi  !" {
		t.Fatalf("SearchText = %q", got)
	}
}

func TestMentionsAreResolvedAndCapped(t *testing.T) {
	s, _, _ := newTestService(t)
	s.SetMentionResolver(func(room string, users, roles []string) ([]string, []string) {
		var u, r []string
		for _, id := range users {
			if id != "ghost" {
				u = append(u, id)
			}
		}
		for _, id := range roles {
			if id != "everyone" && id != "guest" {
				r = append(r, id)
			}
		}
		return u, r
	})
	m := mustCreate(t, s, "r", "alice", "<@bob> <@ghost> <@&everyone> <@&guest> <@&mods>")
	if fmt.Sprint(m.MentionUserIDs) != "[bob]" || fmt.Sprint(m.MentionRoleIDs) != "[mods]" {
		t.Fatalf("mentions = %v %v", m.MentionUserIDs, m.MentionRoleIDs)
	}

	var b strings.Builder
	for i := 0; i < 30; i++ {
		fmt.Fprintf(&b, "<@u%d> ", i)
	}
	b.WriteString("<@&mods>")
	m = mustCreate(t, s, "r", "alice", b.String())
	if len(m.MentionUserIDs)+len(m.MentionRoleIDs) != MaxMentions || len(m.MentionRoleIDs) != 0 {
		t.Fatalf("cap: %d users %d roles", len(m.MentionUserIDs), len(m.MentionRoleIDs))
	}
}

func TestEditRecomputesMentionsAndKeepsReplyPing(t *testing.T) {
	s, _, _ := newTestService(t)
	ctx := context.Background()
	parent := mustCreate(t, s, "r", "alice", "question")
	reply, err := s.Create(ctx, CreateInput{RoomID: "r", SenderID: "bob", Content: "cc <@carol>", ReplyToID: parent.ID, ReplyPing: true})
	if err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(reply.MentionUserIDs) != "[alice carol]" {
		t.Fatalf("create mentions = %v", reply.MentionUserIDs)
	}
	edited, err := s.Edit(ctx, reply.ID, "bob", "cc <@dave> <@&mods>")
	if err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(edited.MentionUserIDs) != "[alice dave]" || fmt.Sprint(edited.MentionRoleIDs) != "[mods]" {
		t.Fatalf("edit mentions = %v %v", edited.MentionUserIDs, edited.MentionRoleIDs)
	}
}
