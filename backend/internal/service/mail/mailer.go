package mail

import (
	"bytes"
	"context"
	"embed"
	"fmt"
	htmltemplate "html/template"
	"log"
	"strings"
	"sync"
	texttemplate "text/template"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
)

// Purposes of a message (email_log.purpose).
const (
	PurposeVerify = "verify"
	PurposeReset  = "reset"
	PurposeTest   = "test"
)

// Log statuses.
const (
	StatusSent   = "sent"
	StatusFailed = "failed"
)

// Redacted replaces a token in everything that is stored or logged.
const Redacted = "[redacted]"

//go:embed templates/*
var templateFS embed.FS

var (
	textTemplates = texttemplate.Must(texttemplate.ParseFS(templateFS, "templates/*.txt"))
	htmlTemplates = htmltemplate.Must(htmltemplate.ParseFS(templateFS, "templates/*.html"))
)

var subjects = map[string]string{
	PurposeVerify: "Confirm your email for %s",
	PurposeReset:  "Reset your %s password",
	PurposeTest:   "%s test email",
}

// Data fills the templates.
type Data struct {
	AppName   string
	Nickname  string
	Link      string
	ExpiresIn string
}

// Render builds the message for a purpose.
func Render(purpose, to string, data Data) (Message, error) {
	subject, ok := subjects[purpose]
	if !ok {
		return Message{}, fmt.Errorf("mail: unknown purpose %q", purpose)
	}
	msg := Message{To: to, Subject: fmt.Sprintf(subject, data.AppName)}

	var text bytes.Buffer
	if err := textTemplates.ExecuteTemplate(&text, purpose+".txt", data); err != nil {
		return Message{}, err
	}
	msg.Text = text.String()

	if htmlTemplates.Lookup(purpose+".html") != nil {
		var html bytes.Buffer
		if err := htmlTemplates.ExecuteTemplate(&html, purpose+".html", data); err != nil {
			return Message{}, err
		}
		msg.HTML = html.String()
	}
	return msg, nil
}

// LogStore records send attempts (repository.EmailLogRepository).
type LogStore interface {
	Add(e *models.EmailLogEntry) error
}

// Mailer renders, sends and logs account email. A nil Mailer, or one
// without a sender, is disabled.
type Mailer struct {
	sender  Sender
	log     LogStore
	appName string
	now     func() time.Time
	wg      sync.WaitGroup
}

// NewMailer creates a mailer. sender nil disables email; log may be nil.
func NewMailer(sender Sender, logStore LogStore, appName string) *Mailer {
	if appName == "" {
		appName = "Orbital"
	}
	return &Mailer{sender: sender, log: logStore, appName: appName, now: time.Now}
}

// Enabled reports whether email can be sent.
func (m *Mailer) Enabled() bool { return m != nil && m.sender != nil }

// Queue sends in the background so a request never waits on SMTP. secret
// (the token) is redacted from the log entry.
func (m *Mailer) Queue(userID, to, purpose string, data Data, secret string) {
	if !m.Enabled() {
		return
	}
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		_ = m.SendNow(context.Background(), userID, to, purpose, data, secret)
	}()
}

// SendNow sends and logs synchronously and returns the delivery error.
func (m *Mailer) SendNow(ctx context.Context, userID, to, purpose string, data Data, secret string) error {
	if !m.Enabled() {
		return fmt.Errorf("mail: email is not configured")
	}
	data.AppName = m.appName
	msg, err := Render(purpose, to, data)
	if err != nil {
		return err
	}
	sendErr := m.sender.Send(ctx, msg)

	entry := &models.EmailLogEntry{
		UserID:    userID,
		To:        to,
		Purpose:   purpose,
		Subject:   redact(msg.Subject, secret),
		Body:      redact(msg.Text, secret),
		Status:    StatusSent,
		CreatedAt: m.now(),
	}
	if sendErr != nil {
		entry.Status = StatusFailed
		entry.Error = redact(sendErr.Error(), secret)
		log.Printf("[Mail] %s mail to user %s failed: %v", purpose, userID, entry.Error)
	} else {
		log.Printf("[Mail] %s mail sent to user %s", purpose, userID)
	}
	if m.log != nil {
		if err := m.log.Add(entry); err != nil {
			log.Printf("[Mail] Failed to record %s mail: %v", purpose, err)
		}
	}
	return sendErr
}

// Wait blocks until queued mail is sent (tests, shutdown).
func (m *Mailer) Wait() {
	if m != nil {
		m.wg.Wait()
	}
}

func redact(s, secret string) string {
	if secret == "" {
		return s
	}
	return strings.ReplaceAll(s, secret, Redacted)
}
