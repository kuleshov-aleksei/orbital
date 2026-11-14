package push

import (
	"context"
	"fmt"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/messaging"
	"google.golang.org/api/option"
)

// AndroidChannelID is the notification channel the app creates for
// mentions (frontend/src/services/push.ts).
const AndroidChannelID = "mentions"

// FCMSender sends through the FCM HTTP v1 API.
type FCMSender struct {
	client *messaging.Client
}

// NewFCMSender authenticates with a service account key: a file path
// (preferred) or the JSON itself.
func NewFCMSender(ctx context.Context, credentialsFile, credentialsJSON string) (*FCMSender, error) {
	var opt option.ClientOption
	switch {
	case credentialsFile != "":
		opt = option.WithAuthCredentialsFile(option.ServiceAccount, credentialsFile)
	case credentialsJSON != "":
		opt = option.WithAuthCredentialsJSON(option.ServiceAccount, []byte(credentialsJSON))
	default:
		return nil, fmt.Errorf("no FCM credentials")
	}
	app, err := firebase.NewApp(ctx, nil, opt)
	if err != nil {
		return nil, fmt.Errorf("init firebase: %w", err)
	}
	client, err := app.Messaging(ctx)
	if err != nil {
		return nil, fmt.Errorf("init messaging: %w", err)
	}
	return &FCMSender{client: client}, nil
}

// maxBatch is the FCM limit of tokens per multicast.
const maxBatch = 500

func (f *FCMSender) Send(ctx context.Context, tokens []string, n Notification) ([]string, error) {
	var invalid []string
	for start := 0; start < len(tokens); start += maxBatch {
		batch := tokens[start:min(start+maxBatch, len(tokens))]
		msg := &messaging.MulticastMessage{
			// Capacitor hands out FCM registration tokens, which go in Tokens.
			Tokens: batch, //nolint:staticcheck // registration tokens, not installation IDs
			Data:   n.Data,
			Android: &messaging.AndroidConfig{
				Priority: "high",
				Notification: &messaging.AndroidNotification{
					Title:     n.Title,
					Body:      n.Body,
					Tag:       n.Tag,
					ChannelID: AndroidChannelID,
				},
			},
		}
		resp, err := f.client.SendEachForMulticast(ctx, msg)
		if err != nil {
			return invalid, err
		}
		for i, r := range resp.Responses {
			if !r.Success && (messaging.IsUnregistered(r.Error) || messaging.IsSenderIDMismatch(r.Error)) {
				invalid = append(invalid, batch[i])
			}
		}
	}
	return invalid, nil
}
