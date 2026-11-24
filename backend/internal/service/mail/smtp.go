// Package mail sends account email (verification, password reset) over
// SMTP. TLS is always required: STARTTLS (ports 587, 2525, 25) or implicit
// TLS (465); the client never authenticates or sends in plaintext.
package mail

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"net/mail"
	"net/smtp"
	"os"
	"strconv"
	"strings"
	"time"
)

// Message is one email to one recipient.
type Message struct {
	To      string
	Subject string
	Text    string
	HTML    string
}

// Sender delivers a message.
type Sender interface {
	Send(ctx context.Context, msg Message) error
}

// TLS modes.
const (
	TLSAuto     = "auto"
	TLSStartTLS = "starttls"
	TLSImplicit = "implicit"
)

// Auth mechanisms.
const (
	AuthAuto  = "auto"
	AuthPlain = "plain"
	AuthLogin = "login"
)

// ErrNoSTARTTLS means the server does not offer STARTTLS. Plaintext is
// never used as a fallback.
var ErrNoSTARTTLS = errors.New("smtp: server does not support STARTTLS")

// SMTPConfig is what SMTPSender needs (mirrors config.SMTPConfig).
type SMTPConfig struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string
	TLS      string
	Auth     string
	CAFile   string
	// Timeout for the whole delivery; 0 means 15 s.
	Timeout time.Duration
}

// SMTPSender delivers mail through one SMTP relay.
type SMTPSender struct {
	cfg     SMTPConfig
	from    *mail.Address
	tlsConf *tls.Config
}

// NewSMTPSender validates the config and loads the optional CA file.
func NewSMTPSender(cfg SMTPConfig) (*SMTPSender, error) {
	if cfg.Host == "" {
		return nil, errors.New("smtp: host is required")
	}
	from, err := mail.ParseAddress(cfg.From)
	if err != nil {
		return nil, fmt.Errorf("smtp: invalid from address: %w", err)
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 15 * time.Second
	}
	tlsConf := &tls.Config{ServerName: cfg.Host, MinVersion: tls.VersionTLS12}
	if cfg.CAFile != "" {
		pem, err := os.ReadFile(cfg.CAFile)
		if err != nil {
			return nil, fmt.Errorf("smtp: read CA file: %w", err)
		}
		pool, err := x509.SystemCertPool()
		if err != nil || pool == nil {
			pool = x509.NewCertPool()
		}
		if !pool.AppendCertsFromPEM(pem) {
			return nil, errors.New("smtp: CA file has no PEM certificates")
		}
		tlsConf.RootCAs = pool
	}
	return &SMTPSender{cfg: cfg, from: from, tlsConf: tlsConf}, nil
}

// From is the sender address used in the From header.
func (s *SMTPSender) From() *mail.Address { return s.from }

// implicitTLS picks the TLS mode: implicit on 465 in auto mode.
func implicitTLS(mode string, port int) bool {
	switch mode {
	case TLSImplicit:
		return true
	case TLSStartTLS:
		return false
	default:
		return port == 465
	}
}

// Send delivers msg. It fails rather than continue without TLS.
func (s *SMTPSender) Send(ctx context.Context, msg Message) error {
	to, err := mail.ParseAddress(msg.To)
	if err != nil {
		return fmt.Errorf("smtp: invalid recipient: %w", err)
	}
	raw, err := buildMIME(s.from, to, msg, time.Now())
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(ctx, s.cfg.Timeout)
	defer cancel()

	addr := net.JoinHostPort(s.cfg.Host, strconv.Itoa(s.cfg.Port))
	implicit := implicitTLS(s.cfg.TLS, s.cfg.Port)

	var conn net.Conn
	dialer := &net.Dialer{}
	if implicit {
		conn, err = (&tls.Dialer{NetDialer: dialer, Config: s.tlsConf}).DialContext(ctx, "tcp", addr)
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return fmt.Errorf("smtp: dial %s: %w", addr, err)
	}
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}

	c, err := smtp.NewClient(conn, s.cfg.Host)
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("smtp: greeting: %w", err)
	}
	defer func() { _ = c.Close() }()

	if !implicit {
		if ok, _ := c.Extension("STARTTLS"); !ok {
			return ErrNoSTARTTLS
		}
		if err := c.StartTLS(s.tlsConf); err != nil {
			return fmt.Errorf("smtp: starttls: %w", err)
		}
	}

	if s.cfg.Username != "" {
		_, mechs := c.Extension("AUTH")
		auth, err := pickAuth(s.cfg.Auth, mechs, s.cfg.Username, s.cfg.Password, s.cfg.Host)
		if err != nil {
			return err
		}
		if err := c.Auth(auth); err != nil {
			return fmt.Errorf("smtp: auth: %w", err)
		}
	}

	if err := c.Mail(s.from.Address); err != nil {
		return fmt.Errorf("smtp: MAIL FROM: %w", err)
	}
	if err := c.Rcpt(to.Address); err != nil {
		return fmt.Errorf("smtp: RCPT TO: %w", err)
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp: DATA: %w", err)
	}
	if _, err := w.Write(raw); err != nil {
		_ = w.Close()
		return fmt.Errorf("smtp: write body: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp: end of data: %w", err)
	}
	return c.Quit()
}

// pickAuth chooses PLAIN or LOGIN. mechs is the server's AUTH parameter
// list (e.g. "PLAIN LOGIN").
func pickAuth(mode, mechs, username, password, host string) (smtp.Auth, error) {
	offered := map[string]bool{}
	for _, m := range strings.Fields(strings.ToUpper(mechs)) {
		offered[m] = true
	}
	plain := smtp.PlainAuth("", username, password, host)
	login := &loginAuth{username: username, password: password, host: host}
	switch mode {
	case AuthPlain:
		return plain, nil
	case AuthLogin:
		return login, nil
	}
	switch {
	case offered["PLAIN"]:
		return plain, nil
	case offered["LOGIN"]:
		return login, nil
	case len(offered) == 0:
		return nil, errors.New("smtp: server offers no AUTH mechanism but credentials are set")
	default:
		return nil, fmt.Errorf("smtp: server offers neither PLAIN nor LOGIN (offers %q)", mechs)
	}
}

// loginAuth implements the LOGIN mechanism, which net/smtp lacks. Like
// smtp.PlainAuth it refuses unencrypted connections.
type loginAuth struct {
	username, password, host string
	step                     int
}

func (a *loginAuth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	if !server.TLS {
		return "", nil, errors.New("smtp: refusing LOGIN auth over an unencrypted connection")
	}
	if server.Name != a.host {
		return "", nil, errors.New("smtp: wrong host name")
	}
	a.step = 0
	return "LOGIN", nil, nil
}

// Next answers the "Username:" then "Password:" challenges (net/smtp has
// already base64-decoded them and encodes the reply).
func (a *loginAuth) Next(fromServer []byte, more bool) ([]byte, error) {
	if !more {
		return nil, nil
	}
	prompt := strings.ToLower(strings.TrimSpace(string(fromServer)))
	a.step++
	switch {
	case strings.HasPrefix(prompt, "username"), strings.HasPrefix(prompt, "user name"):
		return []byte(a.username), nil
	case strings.HasPrefix(prompt, "password"):
		return []byte(a.password), nil
	case a.step == 1:
		return []byte(a.username), nil
	case a.step == 2:
		return []byte(a.password), nil
	default:
		return nil, fmt.Errorf("smtp: unexpected LOGIN challenge %q", prompt)
	}
}
