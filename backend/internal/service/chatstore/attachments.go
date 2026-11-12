package chatstore

import "context"

// MaxAttachmentsPerMessage caps upload_ids per message.
const MaxAttachmentsPerMessage = 10

// Attachment is the display copy of a file stored in a message document. The
// source of truth (owner, size, lifecycle) is the chat_attachments table
// (service/chatmedia); this copy only changes through SetAttachmentState.
type Attachment struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"` // image | video | audio
	Mime       string `json:"mime"`
	Size       int64  `json:"size"`
	Filename   string `json:"filename"`
	Width      int    `json:"width,omitempty"`
	Height     int    `json:"height,omitempty"`
	DurationMS int64  `json:"duration_ms,omitempty"`
	HasThumb   bool   `json:"has_thumb"`
	// Peaks is the audio waveform: ≤200 values in 0..255 (ints, so JSON
	// does not turn it into base64).
	Peaks     []int `json:"peaks,omitempty"`
	Protected bool  `json:"protected"`
	// Removed is the removal reason once the file is gone (quota, owner,
	// moderator); clients render a tombstone.
	Removed string `json:"removed,omitempty"`
}

func (a Attachment) clone() Attachment {
	a.Peaks = append([]int(nil), a.Peaks...)
	return a
}

// attachmentIndexFields derives the search fields from the live attachments.
func attachmentIndexFields(atts []Attachment) (kinds, names []string) {
	kinds, names = []string{}, []string{}
	seen := map[string]bool{}
	for _, a := range atts {
		if a.Removed != "" {
			continue
		}
		if !seen[a.Kind] {
			seen[a.Kind] = true
			kinds = append(kinds, a.Kind)
		}
		names = append(names, a.Filename)
	}
	return kinds, names
}

// SetAttachmentState changes one attachment of a message (protection,
// removal) and refreshes the derived search fields. fn returns false when
// nothing changed. Deleted or missing messages return ErrNotFound.
func (s *Service) SetAttachmentState(ctx context.Context, messageID, attachmentID string, fn func(a *Attachment) bool) (*Message, error) {
	return s.mutate(ctx, messageID, func(m *Message) (map[string]any, error) {
		changed := false
		for i := range m.Attachments {
			if m.Attachments[i].ID == attachmentID {
				changed = fn(&m.Attachments[i])
				break
			}
		}
		if !changed {
			return nil, nil
		}
		m.AttachmentKinds, m.AttachmentNames = attachmentIndexFields(m.Attachments)
		fields := map[string]any{
			"attachments":      m.Attachments,
			"attachment_kinds": m.AttachmentKinds,
			"attachment_names": m.AttachmentNames,
		}
		if len(m.AttachmentNames) == 0 && m.AttachmentText != "" {
			m.AttachmentText = ""
			fields["attachment_text"] = ""
		}
		return fields, nil
	})
}
