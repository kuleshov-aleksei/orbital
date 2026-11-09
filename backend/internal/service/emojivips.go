package service

/*
#cgo pkg-config: vips
#include <stdlib.h>
#include <string.h>
#include <vips/vips.h>

// cgo cannot call variadic C functions, so the vips calls are wrapped here.

static void orbital_emoji_free_blob(void *data, void *user) {
	g_free(data);
}

// Loads every frame (n=-1, multipage loaders only) from a private copy of buf. libvips does not copy
// buffers and its operation cache can keep an image alive after we unref it,
// so the copy is owned by a blob and freed only when the last reference
// drops. Loading is lazy: only the header is read until pixels are needed,
// so dimensions can be checked before decoding. fail_on=error rejects
// truncated or corrupt files instead of padding them.
static VipsImage *orbital_emoji_load(const void *buf, size_t len, int multipage) {
	void *copy = g_malloc(len);
	memcpy(copy, buf, len);
	VipsBlob *blob = vips_blob_new((VipsCallbackFn) orbital_emoji_free_blob, copy, len);
	VipsSource *source = vips_source_new_from_blob(blob);
	vips_area_unref(VIPS_AREA(blob));
	if (!source) return NULL;
	VipsImage *img = vips_image_new_from_source(source,
		multipage ? "n=-1,fail_on=error" : "fail_on=error", NULL);
	g_object_unref(source);
	return img;
}

static int orbital_emoji_page_height(VipsImage *in) {
	return vips_image_get_page_height(in);
}

static int orbital_emoji_n_pages(VipsImage *in) {
	return vips_image_get_n_pages(in);
}

// thumbnail keeps page-height for animated images and premultiplies alpha.
static int orbital_emoji_thumbnail(VipsImage *in, VipsImage **out, int width, int height) {
	return vips_thumbnail_image(in, out, width,
		"height", height,
		"size", VIPS_SIZE_DOWN,
		NULL);
}

static int orbital_emoji_webpsave(VipsImage *in, void **buf, size_t *len, int lossless, int quality) {
	return vips_webpsave_buffer(in, buf, len,
		"keep", VIPS_FOREIGN_KEEP_NONE,
		"lossless", lossless,
		"Q", quality,
		NULL);
}
*/
import "C"

import (
	"bytes"
	"unsafe"

	"github.com/h2non/bimg"
)

// animatedEmojiQuality is the lossy WebP quality tried for animated emojis.
// Static emojis are stored lossless.
const animatedEmojiQuality = 85

func isWebP(data []byte) bool {
	return len(data) >= 12 && bytes.HasPrefix(data, []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP"))
}

// emojiImageInfo is the frame size and frame count read from the header.
type emojiImageInfo struct {
	width, pageHeight, pages int
}

// vipsLoadEmoji loads all frames lazily. The caller must unref the image.
func vipsLoadEmoji(data []byte) (*C.VipsImage, emojiImageInfo, error) {
	if len(data) == 0 {
		return nil, emojiImageInfo{}, ErrEmojiInvalidImage
	}
	bimg.Initialize() // idempotent; starts libvips
	// The PNG loader has no "n" option; GIF and WebP do.
	multipage := C.int(0)
	if !bytes.HasPrefix(data, pngMagic) {
		multipage = 1
	}
	in := C.orbital_emoji_load(unsafe.Pointer(&data[0]), C.size_t(len(data)), multipage)
	if in == nil {
		C.vips_error_clear()
		return nil, emojiImageInfo{}, ErrEmojiInvalidImage
	}
	info := emojiImageInfo{
		width:      int(C.vips_image_get_width(in)),
		pageHeight: int(C.orbital_emoji_page_height(in)),
		pages:      int(C.orbital_emoji_n_pages(in)),
	}
	return in, info, nil
}

// checkEmojiSource rejects decompression bombs before any pixel is decoded.
// Every frame of an animation is decoded in memory, so animated sources get a
// smaller frame-size limit.
func checkEmojiSource(info emojiImageInfo) error {
	limit := maxEmojiSourceDimension
	if info.pages > 1 {
		limit = maxAnimatedSourceDimension
	}
	if info.width <= 0 || info.pageHeight <= 0 || info.pages <= 0 ||
		info.width > limit || info.pageHeight > limit || info.pages > maxEmojiFrames {
		return ErrEmojiInvalidImage
	}
	return nil
}

// encodeEmojiWebP decodes a PNG, GIF or WebP (all frames) with libvips, scales
// it to fit MaxEmojiDimension and re-encodes it as WebP: lossless for static
// images, the smaller of lossy and lossless for animated ones. Metadata is dropped, and so is anything
// appended to or embedded in the upload. Callers must check the magic bytes
// first, since libvips would otherwise accept any format it knows.
func encodeEmojiWebP(data []byte) (out []byte, animated bool, err error) {
	in, info, err := vipsLoadEmoji(data)
	if err != nil {
		return nil, false, err
	}
	defer C.g_object_unref(C.gpointer(in))
	if err := checkEmojiSource(info); err != nil {
		return nil, false, err
	}
	animated = info.pages > 1

	var thumb *C.VipsImage
	if C.orbital_emoji_thumbnail(in, &thumb, C.int(MaxEmojiDimension), C.int(MaxEmojiDimension)) != 0 {
		C.vips_error_clear()
		return nil, false, ErrEmojiInvalidImage
	}
	defer C.g_object_unref(C.gpointer(thumb))

	if !animated {
		out, err = saveEmojiWebP(thumb, true)
		return out, false, err
	}

	// Animations: neither mode always wins. Lossy is usually far smaller, but
	// flat palette-style GIFs come out smaller lossless (and lossy can even be
	// larger than the source GIF), so encode both and keep the smaller. The
	// thumbnail is rendered to memory once so it is not decoded twice.
	mem := C.vips_image_copy_memory(thumb)
	if mem == nil {
		C.vips_error_clear()
		return nil, false, ErrEmojiInvalidImage
	}
	defer C.g_object_unref(C.gpointer(mem))
	lossy, err := saveEmojiWebP(mem, false)
	if err != nil {
		return nil, false, err
	}
	lossless, err := saveEmojiWebP(mem, true)
	if err != nil || len(lossy) <= len(lossless) {
		return lossy, true, nil
	}
	return lossless, true, nil
}

func saveEmojiWebP(img *C.VipsImage, lossless bool) ([]byte, error) {
	mode, quality := C.int(0), C.int(animatedEmojiQuality)
	if lossless {
		mode, quality = 1, 100
	}
	var buf unsafe.Pointer
	var length C.size_t
	if C.orbital_emoji_webpsave(img, &buf, &length, mode, quality) != 0 {
		C.vips_error_clear()
		return nil, ErrEmojiInvalidImage
	}
	defer C.g_free(C.gpointer(buf))
	return C.GoBytes(buf, C.int(length)), nil
}

// emojiStillPNG returns the first frame of an image as a PNG (bimg only loads
// the first page).
func emojiStillPNG(data []byte) ([]byte, error) {
	return bimg.NewImage(data).Process(bimg.Options{Type: bimg.PNG, StripMetadata: true})
}
