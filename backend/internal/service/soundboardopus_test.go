package service

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"math"
	"testing"

	"github.com/pion/webrtc/v4/pkg/media/oggreader"
	"gopkg.in/hraban/opus.v2"
)

// testWAV builds a PCM WAV with the given header fields, filled with a 1 kHz
// sine at half scale (silent for 8-bit, which only matters for rejection).
func testWAV(channels, rate, bits int, seconds float64) []byte {
	frames := int(seconds * float64(rate))
	bytesPerSample := bits / 8
	pcm := make([]byte, frames*channels*bytesPerSample)
	if bits == 16 {
		for i := 0; i < frames; i++ {
			v := int16(0.5 * 32767 * math.Sin(2*math.Pi*1000*float64(i)/float64(rate)))
			for c := 0; c < channels; c++ {
				binary.LittleEndian.PutUint16(pcm[(i*channels+c)*2:], uint16(v))
			}
		}
	}
	var b bytes.Buffer
	b.WriteString("RIFF")
	_ = binary.Write(&b, binary.LittleEndian, uint32(36+len(pcm)))
	b.WriteString("WAVEfmt ")
	_ = binary.Write(&b, binary.LittleEndian, uint32(16))
	_ = binary.Write(&b, binary.LittleEndian, uint16(1))
	_ = binary.Write(&b, binary.LittleEndian, uint16(channels))
	_ = binary.Write(&b, binary.LittleEndian, uint32(rate))
	_ = binary.Write(&b, binary.LittleEndian, uint32(rate*channels*bytesPerSample))
	_ = binary.Write(&b, binary.LittleEndian, uint16(channels*bytesPerSample))
	_ = binary.Write(&b, binary.LittleEndian, uint16(bits))
	b.WriteString("data")
	_ = binary.Write(&b, binary.LittleEndian, uint32(len(pcm)))
	b.Write(pcm)
	return b.Bytes()
}

func TestEncodeWAVToOpusProducesAlignedOggOpus(t *testing.T) {
	out, err := encodeWAVToOpus(testWAV(1, 48000, 16, 1))
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if !bytes.HasPrefix(out, []byte("OggS")) {
		t.Fatalf("output is not Ogg")
	}

	reader, header, err := oggreader.NewWith(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("read ogg: %v", err)
	}
	if header.Channels != 1 || header.SampleRate != 48000 || header.PreSkip != oggPreSkipSamples {
		t.Fatalf("unexpected OpusHead: %+v", header)
	}

	dec, err := opus.NewDecoder(48000, 1)
	if err != nil {
		t.Fatal(err)
	}
	var decoded []int16
	var lastGranule uint64
	buf := make([]int16, 5760)
	for {
		// pion's writer emits one Opus packet per page.
		payload, page, err := reader.ParseNextPage()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatalf("parse page: %v", err)
		}
		lastGranule = page.GranulePosition
		// Skip the OpusTags header and the empty EOS page.
		if len(payload) == 0 || bytes.HasPrefix(payload, []byte("OpusTags")) {
			continue
		}
		n, err := dec.Decode(payload, buf)
		if err != nil {
			t.Fatalf("decode: %v", err)
		}
		decoded = append(decoded, buf[:n]...)
	}

	// Granule covers padding + one second, rounded up to a 20 ms frame.
	if want := uint64(soundboardLeadingPad + 48000); lastGranule < want || lastGranule > want+soundboardFrameSamples {
		t.Fatalf("final granule = %d, want ~%d", lastGranule, want)
	}

	// After dropping pre-skip, the tone must start right away (the leading pad
	// compensates for the oggwriter's fixed 3840 pre-skip).
	if len(decoded) <= oggPreSkipSamples {
		t.Fatalf("decoded too few samples: %d", len(decoded))
	}
	audible := decoded[oggPreSkipSamples:]
	onset := -1
	for i, s := range audible {
		if s > 4000 || s < -4000 {
			onset = i
			break
		}
	}
	if onset < 0 || onset > 48 { // within 1 ms
		t.Fatalf("tone onset at sample %d after pre-skip, want ~0", onset)
	}
}

func TestEncodeWAVToOpusRejects(t *testing.T) {
	valid := testWAV(1, 48000, 16, 0.5)
	noData := valid[:36]
	cases := []struct {
		name string
		data []byte
		want error
	}{
		{"too long", testWAV(1, 48000, 16, 6), ErrSoundTooLong},
		{"stereo", testWAV(2, 48000, 16, 0.5), ErrSoundInvalidWAV},
		{"44.1 kHz", testWAV(1, 44100, 16, 0.5), ErrSoundInvalidWAV},
		{"8-bit", testWAV(1, 48000, 8, 0.5), ErrSoundInvalidWAV},
		{"truncated", valid[:len(valid)-100], ErrSoundInvalidWAV},
		{"no data chunk", noData, ErrSoundInvalidWAV},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := encodeWAVToOpus(tc.data); !errors.Is(err, tc.want) {
				t.Fatalf("got %v, want %v", err, tc.want)
			}
		})
	}
}
