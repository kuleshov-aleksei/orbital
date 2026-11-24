package mail

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"io"
	"math/big"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// testCert makes a self-signed certificate for 127.0.0.1 and writes its PEM
// to a file usable as SMTPConfig.CAFile.
func testCert(t *testing.T) (tls.Certificate, string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "orbital-test-smtp"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1")},
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	cert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(path, certPEM, 0o600); err != nil {
		t.Fatal(err)
	}
	return cert, path
}

// fakeSMTP is a minimal SMTP server for one or more sessions.
type fakeSMTP struct {
	t        *testing.T
	ln       net.Listener
	tlsConf  *tls.Config
	implicit bool   // TLS from the first byte (port 465 style)
	startTLS bool   // advertise STARTTLS
	mechs    string // AUTH mechanisms; advertised once encrypted, or always with authPlaintext
	// authPlaintext advertises AUTH before TLS too (to prove the client
	// doesn't use it).
	authPlaintext bool
	user, pass    string

	mu       sync.Mutex
	authMech string
	authOK   bool
	authSeen bool
	from     string
	rcpt     string
	data     string
}

func newFakeSMTP(t *testing.T, cert tls.Certificate) *fakeSMTP {
	t.Helper()
	s := &fakeSMTP{t: t, tlsConf: &tls.Config{Certificates: []tls.Certificate{cert}}, user: "orbital", pass: "p@ss word"}
	return s
}

func (s *fakeSMTP) start() int {
	s.t.Helper()
	var err error
	if s.implicit {
		s.ln, err = tls.Listen("tcp", "127.0.0.1:0", s.tlsConf)
	} else {
		s.ln, err = net.Listen("tcp", "127.0.0.1:0")
	}
	if err != nil {
		s.t.Fatal(err)
	}
	s.t.Cleanup(func() { _ = s.ln.Close() })
	go func() {
		for {
			conn, err := s.ln.Accept()
			if err != nil {
				return
			}
			go s.serve(conn)
		}
	}()
	return s.ln.Addr().(*net.TCPAddr).Port
}

func (s *fakeSMTP) serve(conn net.Conn) {
	defer func() { _ = conn.Close() }()
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
	encrypted := s.implicit
	tp := textproto.NewConn(conn)
	reply := func(lines ...string) {
		for _, l := range lines {
			_ = tp.PrintfLine("%s", l)
		}
	}
	reply("220 fake ESMTP")
	for {
		line, err := tp.ReadLine()
		if err != nil {
			return
		}
		verb := strings.ToUpper(strings.Fields(line + " ")[0])
		switch verb {
		case "EHLO", "HELO":
			lines := []string{"250-fake"}
			if s.startTLS && !encrypted {
				lines = append(lines, "250-STARTTLS")
			}
			if s.mechs != "" && (encrypted || s.authPlaintext) {
				lines = append(lines, "250-AUTH "+s.mechs)
			}
			lines = append(lines, "250 8BITMIME")
			reply(lines...)
		case "STARTTLS":
			reply("220 go ahead")
			tlsConn := tls.Server(conn, s.tlsConf)
			if err := tlsConn.Handshake(); err != nil {
				return
			}
			conn = tlsConn
			tp = textproto.NewConn(conn)
			encrypted = true
		case "AUTH":
			s.handleAuth(tp, line, reply)
		case "MAIL":
			s.mu.Lock()
			s.from = line
			s.mu.Unlock()
			reply("250 ok")
		case "RCPT":
			s.mu.Lock()
			s.rcpt = line
			s.mu.Unlock()
			reply("250 ok")
		case "DATA":
			reply("354 go")
			raw, err := tp.ReadDotBytes()
			if err != nil {
				return
			}
			s.mu.Lock()
			s.data = string(raw)
			s.mu.Unlock()
			reply("250 queued")
		case "QUIT":
			reply("221 bye")
			return
		default:
			reply("502 unknown")
		}
	}
}

func (s *fakeSMTP) handleAuth(tp *textproto.Conn, line string, reply func(...string)) {
	parts := strings.Fields(line)
	s.mu.Lock()
	s.authSeen = true
	s.mu.Unlock()
	if len(parts) < 2 {
		reply("501 syntax")
		return
	}
	mech := strings.ToUpper(parts[1])
	var user, pass string
	switch mech {
	case "PLAIN":
		raw, _ := base64.StdEncoding.DecodeString(parts[2])
		fields := strings.Split(string(raw), "\x00")
		if len(fields) == 3 {
			user, pass = fields[1], fields[2]
		}
	case "LOGIN":
		reply("334 " + base64.StdEncoding.EncodeToString([]byte("Username:")))
		u, _ := tp.ReadLine()
		reply("334 " + base64.StdEncoding.EncodeToString([]byte("Password:")))
		p, _ := tp.ReadLine()
		ub, _ := base64.StdEncoding.DecodeString(u)
		pb, _ := base64.StdEncoding.DecodeString(p)
		user, pass = string(ub), string(pb)
	default:
		reply("504 unsupported")
		return
	}
	ok := user == s.user && pass == s.pass
	s.mu.Lock()
	s.authMech, s.authOK = mech, ok
	s.mu.Unlock()
	if ok {
		reply("235 ok")
	} else {
		reply("535 bad credentials")
	}
}

func (s *fakeSMTP) sender(t *testing.T, port int, caFile, tlsMode, authMode string) *SMTPSender {
	t.Helper()
	sender, err := NewSMTPSender(SMTPConfig{
		Host: "127.0.0.1", Port: port, Username: s.user, Password: s.pass,
		From: "Orbital <no-reply@orb.example.com>", TLS: tlsMode, Auth: authMode, CAFile: caFile,
		Timeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	return sender
}

var testMsg = Message{To: "Alice <alice@example.com>", Subject: "Привет, Orbital", Text: "hello\nworld", HTML: "<p>hello</p>"}

func TestSMTPStartTLSPlain(t *testing.T) {
	cert, ca := testCert(t)
	srv := newFakeSMTP(t, cert)
	srv.startTLS, srv.mechs = true, "PLAIN LOGIN"
	port := srv.start()

	if err := srv.sender(t, port, ca, TLSAuto, AuthAuto).Send(context.Background(), testMsg); err != nil {
		t.Fatalf("Send: %v", err)
	}
	srv.mu.Lock()
	defer srv.mu.Unlock()
	if srv.authMech != "PLAIN" || !srv.authOK {
		t.Fatalf("auth = %q ok=%v, want PLAIN ok", srv.authMech, srv.authOK)
	}
	if !strings.Contains(srv.rcpt, "<alice@example.com>") || !strings.Contains(srv.from, "<no-reply@orb.example.com>") {
		t.Fatalf("envelope from=%q rcpt=%q", srv.from, srv.rcpt)
	}
	if !strings.Contains(srv.data, "multipart/alternative") {
		t.Fatalf("data is not multipart: %q", srv.data)
	}
}

func TestSMTPStartTLSLogin(t *testing.T) {
	cert, ca := testCert(t)
	for _, tc := range []struct{ name, mechs, mode string }{
		{"auto picks LOGIN when PLAIN is missing", "LOGIN", AuthAuto},
		{"forced LOGIN", "PLAIN LOGIN", AuthLogin},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := newFakeSMTP(t, cert)
			srv.startTLS, srv.mechs = true, tc.mechs
			port := srv.start()
			if err := srv.sender(t, port, ca, TLSStartTLS, tc.mode).Send(context.Background(), testMsg); err != nil {
				t.Fatalf("Send: %v", err)
			}
			srv.mu.Lock()
			defer srv.mu.Unlock()
			if srv.authMech != "LOGIN" || !srv.authOK {
				t.Fatalf("auth = %q ok=%v, want LOGIN ok", srv.authMech, srv.authOK)
			}
		})
	}
}

func TestSMTPImplicitTLS(t *testing.T) {
	cert, ca := testCert(t)
	srv := newFakeSMTP(t, cert)
	srv.implicit, srv.mechs = true, "PLAIN"
	port := srv.start()
	if err := srv.sender(t, port, ca, TLSImplicit, AuthAuto).Send(context.Background(), testMsg); err != nil {
		t.Fatalf("Send: %v", err)
	}
	srv.mu.Lock()
	defer srv.mu.Unlock()
	if !srv.authOK || srv.data == "" {
		t.Fatalf("auth ok=%v, data %d bytes", srv.authOK, len(srv.data))
	}
}

// Without STARTTLS the client must stop before AUTH or MAIL: no plaintext.
func TestSMTPRefusesWithoutSTARTTLS(t *testing.T) {
	cert, ca := testCert(t)
	srv := newFakeSMTP(t, cert)
	srv.startTLS, srv.mechs, srv.authPlaintext = false, "PLAIN LOGIN", true
	port := srv.start()

	err := srv.sender(t, port, ca, TLSStartTLS, AuthAuto).Send(context.Background(), testMsg)
	if !errors.Is(err, ErrNoSTARTTLS) {
		t.Fatalf("err = %v, want ErrNoSTARTTLS", err)
	}
	srv.mu.Lock()
	defer srv.mu.Unlock()
	if srv.authSeen || srv.from != "" || srv.data != "" {
		t.Fatalf("client continued in plaintext: auth=%v from=%q", srv.authSeen, srv.from)
	}
}

func TestSMTPRejectsUntrustedCertificate(t *testing.T) {
	cert, _ := testCert(t)
	srv := newFakeSMTP(t, cert)
	srv.startTLS, srv.mechs = true, "PLAIN"
	port := srv.start()
	// No CA file: the self-signed certificate must not be trusted.
	err := srv.sender(t, port, "", TLSStartTLS, AuthAuto).Send(context.Background(), testMsg)
	if err == nil || !strings.Contains(err.Error(), "starttls") {
		t.Fatalf("err = %v, want a starttls certificate error", err)
	}
	srv.mu.Lock()
	defer srv.mu.Unlock()
	if srv.authSeen {
		t.Fatal("credentials sent over an unverified connection")
	}
}

func TestSMTPWrongPassword(t *testing.T) {
	cert, ca := testCert(t)
	srv := newFakeSMTP(t, cert)
	srv.startTLS, srv.mechs = true, "PLAIN"
	port := srv.start()
	sender := srv.sender(t, port, ca, TLSStartTLS, AuthAuto)
	sender.cfg.Password = "wrong"
	if err := sender.Send(context.Background(), testMsg); err == nil || !strings.Contains(err.Error(), "auth") {
		t.Fatalf("err = %v, want auth failure", err)
	}
}

func TestImplicitTLSModePick(t *testing.T) {
	for _, tc := range []struct {
		mode string
		port int
		want bool
	}{
		{TLSAuto, 465, true}, {TLSAuto, 587, false}, {TLSAuto, 2525, false}, {TLSAuto, 25, false},
		{"", 465, true}, {TLSStartTLS, 465, false}, {TLSImplicit, 587, true},
	} {
		if got := implicitTLS(tc.mode, tc.port); got != tc.want {
			t.Errorf("implicitTLS(%q, %d) = %v, want %v", tc.mode, tc.port, got, tc.want)
		}
	}
}

func TestPickAuth(t *testing.T) {
	name := func(a smtp.Auth) string {
		if _, ok := a.(*loginAuth); ok {
			return "LOGIN"
		}
		return "PLAIN"
	}
	for _, tc := range []struct{ mode, mechs, want string }{
		{AuthAuto, "PLAIN LOGIN", "PLAIN"},
		{AuthAuto, "login cram-md5", "LOGIN"},
		{AuthPlain, "LOGIN", "PLAIN"},
		{AuthLogin, "PLAIN", "LOGIN"},
	} {
		a, err := pickAuth(tc.mode, tc.mechs, "u", "p", "h")
		if err != nil || name(a) != tc.want {
			t.Errorf("pickAuth(%q, %q) = %v, %v; want %s", tc.mode, tc.mechs, a, err, tc.want)
		}
	}
	if _, err := pickAuth(AuthAuto, "CRAM-MD5", "u", "p", "h"); err == nil {
		t.Error("pickAuth with no PLAIN/LOGIN should fail")
	}
	if _, err := pickAuth(AuthAuto, "", "u", "p", "h"); err == nil {
		t.Error("pickAuth with no AUTH extension should fail")
	}
}

func TestLoginAuth(t *testing.T) {
	a := &loginAuth{username: "orbital", password: "secret", host: "smtp.example.com"}
	if _, _, err := a.Start(&smtp.ServerInfo{Name: "smtp.example.com", TLS: false}); err == nil {
		t.Fatal("LOGIN must refuse an unencrypted connection")
	}
	if _, _, err := a.Start(&smtp.ServerInfo{Name: "evil.example.com", TLS: true}); err == nil {
		t.Fatal("LOGIN must refuse another host")
	}
	mech, _, err := a.Start(&smtp.ServerInfo{Name: "smtp.example.com", TLS: true})
	if err != nil || mech != "LOGIN" {
		t.Fatalf("Start = %q, %v", mech, err)
	}
	if got, _ := a.Next([]byte("Username:"), true); string(got) != "orbital" {
		t.Fatalf("username reply = %q", got)
	}
	if got, _ := a.Next([]byte("Password:"), true); string(got) != "secret" {
		t.Fatalf("password reply = %q", got)
	}
	if got, err := a.Next(nil, false); got != nil || err != nil {
		t.Fatalf("final Next = %q, %v", got, err)
	}
}

func TestBuildMIME(t *testing.T) {
	from := &mail.Address{Name: "Orbital", Address: "no-reply@orb.example.com"}
	to := &mail.Address{Address: "alice@example.com"}
	raw, err := buildMIME(from, to, testMsg, time.Date(2026, 11, 24, 10, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "\r\n\r\n") {
		t.Fatal("headers must end with CRLF CRLF")
	}
	m, err := mail.ReadMessage(strings.NewReader(string(raw)))
	if err != nil {
		t.Fatalf("ReadMessage: %v", err)
	}
	subject, err := new(mime.WordDecoder).DecodeHeader(m.Header.Get("Subject"))
	if err != nil || subject != testMsg.Subject {
		t.Fatalf("subject = %q, %v", subject, err)
	}
	if !strings.HasSuffix(m.Header.Get("Message-ID"), "@orb.example.com>") {
		t.Fatalf("Message-ID = %q", m.Header.Get("Message-ID"))
	}
	body, _ := io.ReadAll(bufio.NewReader(m.Body))
	if !strings.Contains(string(body), "text/plain") || !strings.Contains(string(body), "text/html") {
		t.Fatalf("missing parts: %s", body)
	}

	bad := testMsg
	bad.Subject = "hi\r\nBcc: victim@example.com"
	if _, err := buildMIME(from, to, bad, time.Now()); err == nil {
		t.Fatal("a subject with CRLF must be rejected")
	}
}

func TestNewSMTPSenderValidates(t *testing.T) {
	if _, err := NewSMTPSender(SMTPConfig{Host: "smtp.example.com", Port: 587, From: "not an address"}); err == nil {
		t.Fatal("invalid From accepted")
	}
	bad := filepath.Join(t.TempDir(), "empty.pem")
	_ = os.WriteFile(bad, []byte("nope"), 0o600)
	if _, err := NewSMTPSender(SMTPConfig{Host: "smtp.example.com", Port: 587, From: "a@example.com", CAFile: bad}); err == nil {
		t.Fatal("CA file without PEM accepted")
	}
	s, err := NewSMTPSender(SMTPConfig{Host: "smtp.example.com", Port: 587, From: "a@example.com"})
	if err != nil || s.tlsConf.MinVersion != tls.VersionTLS12 || s.tlsConf.InsecureSkipVerify {
		t.Fatalf("tls config = %+v, %v", s.tlsConf, err)
	}
}
