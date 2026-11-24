package mail

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"mime/quotedprintable"
	"net/mail"
	"strings"
	"time"
)

// buildMIME renders a multipart/alternative (text + HTML) message with CRLF
// line endings. Header values are checked for CR/LF so nothing can inject
// headers.
func buildMIME(from, to *mail.Address, msg Message, now time.Time) ([]byte, error) {
	if strings.ContainsAny(msg.Subject, "\r\n") {
		return nil, errors.New("mail: subject contains a line break")
	}
	boundary, err := randomHex(16)
	if err != nil {
		return nil, err
	}
	msgID, err := randomHex(16)
	if err != nil {
		return nil, err
	}
	domain := "localhost"
	if at := strings.LastIndex(from.Address, "@"); at >= 0 && at+1 < len(from.Address) {
		domain = from.Address[at+1:]
	}

	var b bytes.Buffer
	header := func(k, v string) { fmt.Fprintf(&b, "%s: %s\r\n", k, v) }
	header("From", from.String())
	header("To", to.String())
	header("Subject", mime.QEncoding.Encode("utf-8", msg.Subject))
	header("Date", now.Format(time.RFC1123Z))
	header("Message-ID", "<"+msgID+"@"+domain+">")
	header("MIME-Version", "1.0")
	header("Auto-Submitted", "auto-generated")

	if msg.HTML == "" {
		header("Content-Type", `text/plain; charset="utf-8"`)
		header("Content-Transfer-Encoding", "quoted-printable")
		b.WriteString("\r\n")
		if err := writeQP(&b, msg.Text); err != nil {
			return nil, err
		}
		return b.Bytes(), nil
	}

	header("Content-Type", `multipart/alternative; boundary="`+boundary+`"`)
	b.WriteString("\r\n")
	for _, part := range []struct{ ctype, body string }{
		{"text/plain", msg.Text},
		{"text/html", msg.HTML},
	} {
		fmt.Fprintf(&b, "--%s\r\n", boundary)
		fmt.Fprintf(&b, "Content-Type: %s; charset=\"utf-8\"\r\n", part.ctype)
		b.WriteString("Content-Transfer-Encoding: quoted-printable\r\n\r\n")
		if err := writeQP(&b, part.body); err != nil {
			return nil, err
		}
		b.WriteString("\r\n")
	}
	fmt.Fprintf(&b, "--%s--\r\n", boundary)
	return b.Bytes(), nil
}

func writeQP(b *bytes.Buffer, body string) error {
	// Normalise line endings; quotedprintable emits CRLF for "\n".
	body = strings.ReplaceAll(body, "\r\n", "\n")
	w := quotedprintable.NewWriter(b)
	if _, err := w.Write([]byte(body)); err != nil {
		return err
	}
	return w.Close()
}

func randomHex(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}
