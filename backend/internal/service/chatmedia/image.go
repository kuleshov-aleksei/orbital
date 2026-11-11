package chatmedia

import (
	"errors"

	"github.com/h2non/bimg"
)

const (
	// thumbBox bounds thumbnails (WebP, aspect ratio kept).
	thumbBox = 640
	// Decompression-bomb guards, checked from the header before decoding.
	maxImageDimension = 16384
	maxImagePixels    = 80_000_000
	jpegQuality       = 92
	webpQuality       = 90
	thumbQuality      = 80
)

var errBadImage = errors.New("invalid image")

// processedImage is an image ready to store.
type processedImage struct {
	original      []byte
	thumb         []byte
	width, height int
}

// processImage strips metadata (EXIF, GPS) from the original and renders a
// WebP thumbnail. JPEGs are rotated by their EXIF orientation first, so the
// stripped copy still displays upright. GIFs and animated WebPs are kept
// byte-for-byte (GIF has no EXIF; re-encoding would drop the animation);
// their thumbnail is the first frame.
func processImage(data []byte, ft fileType) (*processedImage, error) {
	bimg.Initialize() // idempotent
	size, err := bimg.NewImage(data).Size()
	if err != nil {
		return nil, errBadImage
	}
	if size.Width <= 0 || size.Height <= 0 || size.Width > maxImageDimension ||
		size.Height > maxImageDimension || size.Width*size.Height > maxImagePixels {
		return nil, errBadImage
	}

	out := &processedImage{original: data}
	switch {
	case ft.mime == "image/gif", ft.mime == "image/webp" && animatedWebP(data):
		// keep as is
	default:
		opts := bimg.Options{StripMetadata: true}
		switch ft.mime {
		case "image/jpeg":
			opts.Type, opts.Quality = bimg.JPEG, jpegQuality
		case "image/png":
			opts.Type = bimg.PNG
		case "image/webp":
			opts.Type, opts.Quality = bimg.WEBP, webpQuality
		}
		stripped, err := bimg.NewImage(data).Process(opts)
		if err != nil {
			return nil, errBadImage
		}
		out.original = stripped
	}

	final, err := bimg.NewImage(out.original).Size()
	if err != nil {
		return nil, errBadImage
	}
	out.width, out.height = final.Width, final.Height

	tw, th := fitBox(out.width, out.height, thumbBox)
	thumb, err := bimg.NewImage(out.original).Process(bimg.Options{
		Width: tw, Height: th, Force: true,
		Type: bimg.WEBP, Quality: thumbQuality, StripMetadata: true,
	})
	if err != nil {
		return nil, errBadImage
	}
	out.thumb = thumb
	return out, nil
}

// fitBox scales w×h down (never up) to fit a box×box square.
func fitBox(w, h, box int) (int, int) {
	if w <= box && h <= box {
		return w, h
	}
	if w >= h {
		return box, max(1, h*box/w)
	}
	return max(1, w*box/h), box
}
