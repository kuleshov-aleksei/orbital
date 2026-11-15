package chatmedia

import (
	"bytes"
	"context"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"

	"github.com/h2non/bimg"
)

// noisyJPEG is a w×h JPEG with enough detail that compression matters.
func noisyJPEG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{uint8(x * 7), uint8(y * 13), uint8((x ^ y) * 3), 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// withOrientation inserts an EXIF APP1 segment with the given orientation
// right after the JPEG SOI marker.
func withOrientation(data []byte, orientation uint16) []byte {
	tiff := []byte("II*\x00\x08\x00\x00\x00") // little endian, IFD at 8
	ifd := make([]byte, 2+12+4)
	binary.LittleEndian.PutUint16(ifd[0:], 1)      // one entry
	binary.LittleEndian.PutUint16(ifd[2:], 0x0112) // Orientation
	binary.LittleEndian.PutUint16(ifd[4:], 3)      // SHORT
	binary.LittleEndian.PutUint32(ifd[6:], 1)      // count
	binary.LittleEndian.PutUint16(ifd[10:], orientation)
	payload := append(append([]byte("Exif\x00\x00"), tiff...), ifd...)
	seg := []byte{0xFF, 0xE1, 0, 0}
	binary.BigEndian.PutUint16(seg[2:], uint16(len(payload)+2))
	seg = append(seg, payload...)
	out := append([]byte{}, data[:2]...)
	out = append(out, seg...)
	return append(out, data[2:]...)
}

func sizeOf(t *testing.T, data []byte) bimg.ImageSize {
	t.Helper()
	s, err := bimg.NewImage(data).Size()
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestCompressesLargeJPEGToWebP(t *testing.T) {
	data := noisyJPEG(t, 3000, 2000)
	img, err := processImage(data, fileType{KindImage, "image/jpeg", "jpg"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if img.mime != "image/webp" || img.ext != "webp" || bimg.DetermineImageType(img.original) != bimg.WEBP {
		t.Fatalf("stored as %s/%s", img.mime, img.ext)
	}
	if img.width != 2560 || img.height != 1706 {
		t.Fatalf("size = %dx%d", img.width, img.height)
	}
	if len(img.original) >= len(data) {
		t.Fatalf("not smaller: %d >= %d", len(img.original), len(data))
	}
}

func TestOriginalKeepsFormatAndSize(t *testing.T) {
	data := noisyJPEG(t, 3000, 2000)
	img, err := processImage(data, fileType{KindImage, "image/jpeg", "jpg"}, true)
	if err != nil {
		t.Fatal(err)
	}
	if img.mime != "image/jpeg" || bimg.DetermineImageType(img.original) != bimg.JPEG ||
		img.width != 3000 || img.height != 2000 {
		t.Fatalf("got %s %dx%d", img.mime, img.width, img.height)
	}
}

func TestCompressionFollowsEXIFRotation(t *testing.T) {
	// Orientation 6: stored landscape, displayed portrait.
	data := withOrientation(noisyJPEG(t, 3000, 2000), 6)
	img, err := processImage(data, fileType{KindImage, "image/jpeg", "jpg"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if img.width != 1706 || img.height != 2560 {
		t.Fatalf("size = %dx%d, want upright 1706x2560", img.width, img.height)
	}
	if meta, _ := bimg.NewImage(img.original).Metadata(); meta.EXIF.Orientation > 1 {
		t.Fatalf("orientation kept: %d", meta.EXIF.Orientation)
	}
}

func TestCompressedPNGKeepsAlpha(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 400, 300))
	img.Set(10, 10, color.NRGBA{255, 0, 0, 255}) // the rest is transparent
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	out, err := processImage(buf.Bytes(), fileType{KindImage, "image/png", "png"}, false)
	if err != nil {
		t.Fatal(err)
	}
	meta, err := bimg.NewImage(out.original).Metadata()
	if err != nil {
		t.Fatal(err)
	}
	if out.mime != "image/webp" || !meta.Alpha {
		t.Fatalf("mime %s alpha %v", out.mime, meta.Alpha)
	}
}

func TestGIFKeptAsIs(t *testing.T) {
	gif := []byte("GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;")
	out, err := processImage(gif, fileType{KindImage, "image/gif", "gif"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if out.mime != "image/gif" || !bytes.Equal(out.original, gif) {
		t.Fatalf("gif changed: %s", out.mime)
	}
}

// riffChunk encodes one RIFF chunk (padded to an even size).
func riffChunk(fourcc string, payload []byte) []byte {
	c := append([]byte(fourcc), 0, 0, 0, 0)
	binary.LittleEndian.PutUint32(c[4:], uint32(len(payload)))
	c = append(c, payload...)
	if len(payload)%2 == 1 {
		c = append(c, 0)
	}
	return c
}

func riffFile(chunks ...[]byte) []byte {
	body := []byte("WEBP")
	for _, c := range chunks {
		body = append(body, c...)
	}
	out := append([]byte("RIFF"), 0, 0, 0, 0)
	binary.LittleEndian.PutUint32(out[4:], uint32(len(body)))
	return append(out, body...)
}

// extendedWebP wraps a simple (VP8) WebP of w×h in a VP8X container with
// EXIF and XMP chunks.
func extendedWebP(t *testing.T, w, h int) (withMeta, withoutMeta []byte) {
	t.Helper()
	simple, err := bimg.NewImage(noisyJPEG(t, w, h)).Process(bimg.Options{Type: bimg.WEBP, Quality: 80})
	if err != nil {
		t.Fatal(err)
	}
	var vp8 []byte // the image data chunk; bimg may wrap it in VP8X + EXIF
	for pos := 12; pos+8 <= len(simple); {
		size := int(binary.LittleEndian.Uint32(simple[pos+4:]))
		end := pos + 8 + size + size&1
		if string(simple[pos:pos+4]) == "VP8 " {
			vp8 = simple[pos:end]
		}
		pos = end
	}
	if vp8 == nil {
		t.Fatal("no VP8 chunk")
	}
	header := func(flags byte) []byte {
		p := make([]byte, 10)
		p[0] = flags
		p[4], p[5], p[6] = byte(w-1), byte((w-1)>>8), byte((w-1)>>16)
		p[7], p[8], p[9] = byte(h-1), byte((h-1)>>8), byte((h-1)>>16)
		return riffChunk("VP8X", p)
	}
	exif := riffChunk("EXIF", []byte("Exif\x00\x00GPS-secret"))
	xmp := riffChunk("XMP ", []byte("<x:xmpmeta/>"))
	withMeta = riffFile(header(vp8xFlagEXIF|vp8xFlagXMP), vp8, exif, xmp)
	withoutMeta = riffFile(header(0), vp8)
	return withMeta, withoutMeta
}

func TestSmallWebPStrippedWithoutReencode(t *testing.T) {
	in, want := extendedWebP(t, 800, 600)
	out, err := processImage(in, fileType{KindImage, "image/webp", "webp"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out.original, want) {
		t.Fatalf("expected only the metadata chunks removed (%d bytes, want %d)", len(out.original), len(want))
	}
	if bytes.Contains(out.original, []byte("GPS-secret")) {
		t.Fatal("EXIF kept")
	}
	if s := sizeOf(t, out.original); s.Width != 800 || s.Height != 600 {
		t.Fatalf("size = %+v", s)
	}
}

func TestStripWebPMetadataRejectsMalformed(t *testing.T) {
	in, _ := extendedWebP(t, 64, 64)
	if _, ok := stripWebPMetadata(in[:len(in)-3]); ok {
		t.Fatal("truncated file accepted")
	}
	bad := append([]byte{}, in...)
	binary.LittleEndian.PutUint32(bad[16:], 1<<30) // VP8X chunk size past the end
	binary.LittleEndian.PutUint32(bad[4:], uint32(len(bad)-8))
	if _, ok := stripWebPMetadata(bad); ok {
		t.Fatal("oversized chunk accepted")
	}
}

func TestLargeWebPIsResized(t *testing.T) {
	in, _ := extendedWebP(t, 3000, 1000)
	out, err := processImage(in, fileType{KindImage, "image/webp", "webp"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if out.width != 2560 || bytes.Contains(out.original, []byte("GPS-secret")) {
		t.Fatalf("width %d", out.width)
	}
}

func TestUploadOriginalFlag(t *testing.T) {
	f := newFixture(t, 10<<20)
	data := noisyJPEG(t, 300, 200)
	res, err := f.svc.Upload(context.Background(), UploadInput{
		RoomID: testRoom, UploaderID: testUser, Filename: "photo.jpg",
		File: bytes.NewReader(data), Size: int64(len(data)), Original: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if r := res.Record; r.Mime != "image/jpeg" || r.Filename != "photo.jpg" || r.Ext != "jpg" {
		t.Fatalf("record = %+v", r)
	}
	res, err = f.svc.Upload(context.Background(), UploadInput{
		RoomID: testRoom, UploaderID: testUser, Filename: "photo.jpg",
		File: bytes.NewReader(data), Size: int64(len(data)),
	})
	if err != nil {
		t.Fatal(err)
	}
	r := res.Record
	if r.Mime != "image/webp" || r.Filename != "photo.webp" || r.Ext != "webp" {
		t.Fatalf("record = %+v", r)
	}
	if ct := f.media.types[r.originalKey()]; ct != "image/webp" {
		t.Fatalf("stored content type = %q", ct)
	}
}

func TestWithExt(t *testing.T) {
	for in, want := range map[string]string{"photo.jpg": "photo.webp", "a.b.png": "a.b.webp", "noext": "noext.webp", ".png": "file.webp"} {
		if got := withExt(in, "webp"); got != want {
			t.Errorf("withExt(%q) = %q, want %q", in, got, want)
		}
	}
}
