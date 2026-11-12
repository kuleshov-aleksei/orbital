//go:build integration

package immichml

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"math"
	"os"
	"testing"
	"time"
)

// Contract test against a real Immich ML (`make ml-up`, then
// ML_TEST_URL=http://127.0.0.1:3003). Run it before bumping the Immich tag:
// /predict is Immich-internal. The first run downloads the models.
func TestImmichMLIntegration(t *testing.T) {
	url := os.Getenv("ML_TEST_URL")
	if url == "" {
		t.Skip("ML_TEST_URL not set")
	}
	c := New(Options{
		URL: url, OCRModel: "ESLAV__PP-OCRv5_mobile", CLIPModel: "XLM-Roberta-Large-Vit-B-16Plus",
		Timeout: 10 * time.Minute,
	})
	ctx := context.Background()
	if err := c.Ping(ctx); err != nil {
		t.Fatal(err)
	}

	res, err := c.Image(ctx, testImage(t))
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Vector) < 256 {
		t.Fatalf("image vector has %d dimensions", len(res.Vector))
	}
	t.Logf("OCR lines: %q, vector dims %d", res.Lines, len(res.Vector))

	red, err := c.EmbedText(ctx, "красный квадрат")
	if err != nil {
		t.Fatal(err)
	}
	if len(red) != len(res.Vector) {
		t.Fatalf("text vector has %d dimensions, image %d", len(red), len(res.Vector))
	}
	other, err := c.EmbedText(ctx, "a dog playing in the snow")
	if err != nil {
		t.Fatal(err)
	}
	simRed, simOther := cosine(res.Vector, red), cosine(res.Vector, other)
	t.Logf("cosine(image, red square) = %.3f, cosine(image, dog in snow) = %.3f", simRed, simOther)
	if simRed <= simOther {
		t.Fatalf("a red square should be closer to \"красный квадрат\" (%.3f) than to a dog (%.3f)", simRed, simOther)
	}
}

// testImage is a red square on white; OCR is checked by hand (t.Logf), since
// rendering text needs a font.
func testImage(t *testing.T) []byte {
	img := image.NewRGBA(image.Rect(0, 0, 512, 512))
	for x := 0; x < 512; x++ {
		for y := 0; y < 512; y++ {
			c := color.RGBA{255, 255, 255, 255}
			if x > 128 && x < 384 && y > 128 && y < 384 {
				c = color.RGBA{220, 20, 20, 255}
			}
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func cosine(a, b []float32) float64 {
	var dot, na, nb float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
		na += float64(a[i]) * float64(a[i])
		nb += float64(b[i]) * float64(b[i])
	}
	return dot / (math.Sqrt(na) * math.Sqrt(nb))
}
