package immichml

import (
	"context"
	"errors"
	"strings"

	"github.com/kuleshov-aleksei/orbital/internal/service/chatmedia"
)

// Extractor adapts the client to chatmedia.Extractor.
type Extractor struct{ c *Client }

// NewExtractor wraps a client.
func NewExtractor(c *Client) *Extractor { return &Extractor{c: c} }

// Signature changes whenever a model does, so old files get re-extracted.
func (e *Extractor) Signature() string {
	return "immich;ocr=" + e.c.opts.OCRModel + ";clip=" + e.c.opts.CLIPModel
}

func (e *Extractor) Extract(ctx context.Context, image []byte) (chatmedia.Extraction, error) {
	res, err := e.c.Image(ctx, image)
	if err != nil {
		if errors.Is(err, ErrUnavailable) || ctx.Err() != nil {
			return chatmedia.Extraction{}, errors.Join(chatmedia.ErrExtractorUnavailable, err)
		}
		return chatmedia.Extraction{}, err
	}
	return chatmedia.Extraction{Text: strings.Join(res.Lines, "\n"), Vector: res.Vector}, nil
}
