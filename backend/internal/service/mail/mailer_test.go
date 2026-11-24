package mail

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/models"
)

type recordingSender struct {
	mu   sync.Mutex
	sent []Message
	err  error
}

func (s *recordingSender) Send(_ context.Context, msg Message) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sent = append(s.sent, msg)
	return s.err
}

type memLog struct {
	mu      sync.Mutex
	entries []models.EmailLogEntry
}

func (l *memLog) Add(e *models.EmailLogEntry) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.entries = append(l.entries, *e)
	return nil
}

const testToken = "Zm9vYmFyYmF6cXV4LXJlYWxseS1sb25nLXRva2VuLTEyMzQ"

func TestMailerRedactsTokenFromLog(t *testing.T) {
	sender := &recordingSender{}
	logs := &memLog{}
	m := NewMailer(sender, logs, "Orbital")
	link := "https://orb.example.com/reset-password?token=" + testToken

	m.Queue("qkUrdzLDoqslx8EEy2cM7Q==", "alice@example.com", PurposeReset, Data{Nickname: "Alice", Link: link, ExpiresIn: "1 hour"}, testToken)
	m.Wait()

	if len(sender.sent) != 1 || !strings.Contains(sender.sent[0].Text, link) || !strings.Contains(sender.sent[0].HTML, testToken) {
		t.Fatalf("the delivered mail must carry the real link: %+v", sender.sent)
	}
	if len(logs.entries) != 1 {
		t.Fatalf("log entries = %d", len(logs.entries))
	}
	e := logs.entries[0]
	if strings.Contains(e.Body, testToken) || strings.Contains(e.Subject, testToken) {
		t.Fatalf("token leaked into the log: %q", e.Body)
	}
	if !strings.Contains(e.Body, "token="+Redacted) || e.Status != StatusSent || e.UserID != "qkUrdzLDoqslx8EEy2cM7Q==" {
		t.Fatalf("entry = %+v", e)
	}
}

func TestMailerLogsFailure(t *testing.T) {
	sender := &recordingSender{err: errors.New("smtp: 550 rejected " + testToken)}
	logs := &memLog{}
	m := NewMailer(sender, logs, "Orbital")
	err := m.SendNow(context.Background(), "", "bob@example.com", PurposeVerify, Data{Link: "x?token=" + testToken}, testToken)
	if err == nil {
		t.Fatal("SendNow should return the delivery error")
	}
	e := logs.entries[0]
	if e.Status != StatusFailed || strings.Contains(e.Error, testToken) {
		t.Fatalf("entry = %+v", e)
	}
}

func TestDisabledMailer(t *testing.T) {
	var nilMailer *Mailer
	if nilMailer.Enabled() || NewMailer(nil, nil, "").Enabled() {
		t.Fatal("mailer without sender must be disabled")
	}
	NewMailer(nil, nil, "").Queue("", "a@example.com", PurposeVerify, Data{}, "") // no panic
}

func TestRenderAllPurposes(t *testing.T) {
	for _, p := range []string{PurposeVerify, PurposeReset, PurposeTest} {
		msg, err := Render(p, "a@example.com", Data{AppName: "Orbital", Nickname: "<b>Eve</b>", Link: "https://orb.example.com/x?token=abc"})
		if err != nil || msg.Subject == "" || msg.Text == "" {
			t.Fatalf("Render(%s) = %+v, %v", p, msg, err)
		}
		if strings.Contains(msg.HTML, "<b>Eve</b>") {
			t.Fatalf("Render(%s): nickname not escaped in HTML", p)
		}
	}
	if _, err := Render("nope", "a@example.com", Data{}); err == nil {
		t.Fatal("unknown purpose accepted")
	}
}
