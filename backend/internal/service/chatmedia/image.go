package chatmedia

import (
	"encoding/binary"
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
	// Compressed (default) uploads are stored as WebP whose long edge is at
	// most maxStoredEdge. Keep in sync with frontend/src/utils/compressImage.ts.
	maxStoredEdge     = 2560
	storedWebPQuality = 85
	// A WebP that already fits maxStoredEdge and has at most this many
	// bytes per pixel is kept (metadata stripped) instead of re-encoded,
	// so a client-compressed upload is not compressed twice.
	keepWebPBytesPerPixel = 1
)

var errBadImage = errors.New("invalid image")

// processedImage is an image ready to store.
type processedImage struct {
	original      []byte
	thumb         []byte
	width, height int
	// mime and ext of the stored original (WebP when compressed).
	mime, ext string
}

// processImage prepares an uploaded image for storage and renders a WebP
// thumbnail. Metadata (EXIF, GPS) is always stripped; JPEGs are rotated by
// their EXIF orientation first, so the stripped copy still displays upright.
// GIFs and animated WebPs are kept byte-for-byte (GIF has no EXIF;
// re-encoding would drop the animation); their thumbnail is the first frame.
//
// Other images are compressed: scaled down to fit maxStoredEdge and stored
// as WebP. original keeps the format and resolution instead.
func processImage(data []byte, ft fileType, original bool) (*processedImage, error) {
	bimg.Initialize() // idempotent
	meta, err := bimg.NewImage(data).Metadata()
	if err != nil {
		return nil, errBadImage
	}
	w, h := meta.Size.Width, meta.Size.Height
	if w <= 0 || h <= 0 || w > maxImageDimension || h > maxImageDimension || w*h > maxImagePixels {
		return nil, errBadImage
	}

	out := &processedImage{original: data, mime: ft.mime, ext: ft.ext}
	switch {
	case ft.mime == "image/gif", ft.mime == "image/webp" && animatedWebP(data):
		// keep as is
	case original:
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
	default:
		out.mime, out.ext = "image/webp", "webp"
		if ft.mime == "image/webp" && w <= maxStoredEdge && h <= maxStoredEdge &&
			len(data) <= w*h*keepWebPBytesPerPixel {
			if stripped, ok := stripWebPMetadata(data); ok {
				out.original = stripped
				break
			}
		}
		// bimg rotates by the EXIF orientation before resizing, so the
		// target box is in upright dimensions (orientations 5-8 turn 90°).
		if meta.Orientation >= 5 && meta.Orientation <= 8 {
			w, h = h, w
		}
		tw, th := fitBox(w, h, maxStoredEdge)
		compressed, err := bimg.NewImage(data).Process(bimg.Options{
			Width: tw, Height: th, Force: true,
			Type: bimg.WEBP, Quality: storedWebPQuality, StripMetadata: true,
		})
		if err != nil {
			return nil, errBadImage
		}
		out.original = compressed
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

// VP8X feature flags (first payload byte of the VP8X chunk).
const (
	vp8xFlagEXIF = 0x08
	vp8xFlagXMP  = 0x04
)

// stripWebPMetadata drops the EXIF and XMP chunks of a WebP without
// re-encoding it and clears their VP8X flags. ok is false for a malformed
// container (the caller re-encodes instead). Other chunks, the ICC profile
// included, are kept byte-for-byte.
func stripWebPMetadata(data []byte) ([]byte, bool) {
	if len(data) < 12 || string(data[0:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
		return nil, false
	}
	if int(binary.LittleEndian.Uint32(data[4:8])) != len(data)-8 {
		return nil, false
	}
	out := make([]byte, 12, len(data))
	copy(out, data[:12])
	vp8x := -1
	for pos := 12; pos < len(data); {
		if len(data)-pos < 8 {
			return nil, false
		}
		fourcc := string(data[pos : pos+4])
		size := int(binary.LittleEndian.Uint32(data[pos+4 : pos+8]))
		end := pos + 8 + size + size&1 // chunks are padded to an even size
		if size < 0 || end > len(data) || end < pos {
			return nil, false
		}
		switch fourcc {
		case "EXIF", "XMP ":
			// dropped
		default:
			if fourcc == "VP8X" {
				if size < 1 {
					return nil, false
				}
				vp8x = len(out) + 8
			}
			out = append(out, data[pos:end]...)
		}
		pos = end
	}
	if vp8x >= 0 {
		out[vp8x] &^= vp8xFlagEXIF | vp8xFlagXMP
	}
	binary.LittleEndian.PutUint32(out[4:8], uint32(len(out)-8))
	return out, true
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

// extractBox bounds the image sent to content extractors (OCR reads small
// text, so the 640 px thumbnail is too coarse; originals can be 20 MB).
const extractBox = 1440

// extractionImage renders a stored original as a JPEG that fits extractBox
// (first frame of animations). Smaller images are re-encoded, not scaled.
func extractionImage(data []byte) ([]byte, error) {
	bimg.Initialize()
	size, err := bimg.NewImage(data).Size()
	if err != nil || size.Width <= 0 || size.Height <= 0 {
		return nil, errBadImage
	}
	w, h := fitBox(size.Width, size.Height, extractBox)
	out, err := bimg.NewImage(data).Process(bimg.Options{
		Width: w, Height: h, Force: true, Type: bimg.JPEG, Quality: jpegQuality, StripMetadata: true,
		Background: bimg.Color{R: 255, G: 255, B: 255}, // transparent PNGs: dark text stays readable
	})
	if err != nil {
		return nil, errBadImage
	}
	return out, nil
}
