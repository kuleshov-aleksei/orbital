package service

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"time"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4/pkg/media/oggwriter"
	"gopkg.in/hraban/opus.v2"
)

const (
	// MaxSoundboardDuration is enforced server-side for WAV uploads (the
	// browser editor trims to this length before uploading).
	MaxSoundboardDuration = 5 * time.Second
	// soundboardDurationSlack absorbs rounding from the client-side trim.
	soundboardDurationSlack = 50 * time.Millisecond

	soundboardSampleRate   = 48000
	soundboardOpusBitrate  = 64000
	soundboardFrameSamples = soundboardSampleRate / 50 // 20 ms

	// pion's oggwriter always declares a pre-skip of 3840 samples, while
	// libopus only delays its output by its lookahead (Fs/400 + Fs/250 = 312
	// samples at 48 kHz). Prepending the difference as silence keeps decoded
	// audio aligned, so trimmed clips don't lose their first ~73 ms.
	oggPreSkipSamples      = 3840
	opusLookaheadSamples   = soundboardSampleRate/400 + soundboardSampleRate/250
	soundboardLeadingPad   = oggPreSkipSamples - opusLookaheadSamples
	soundboardMaxOpusFrame = 4000
)

var (
	ErrSoundInvalidWAV = errors.New("WAV must be 16-bit PCM, mono, 48 kHz")
	ErrSoundTooLong    = fmt.Errorf("sound must be at most %d seconds", int(MaxSoundboardDuration.Seconds()))
)

// isWAV reports whether data starts with a RIFF/WAVE header.
func isWAV(data []byte) bool {
	return len(data) >= 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WAVE"
}

// parseSoundboardWAV walks the RIFF chunks and returns the samples of a
// 16-bit PCM mono 48 kHz WAV.
func parseSoundboardWAV(data []byte) ([]int16, error) {
	if !isWAV(data) {
		return nil, ErrSoundInvalidWAV
	}
	var (
		haveFmt bool
		pcm     []byte
		found   bool
	)
	for off := 12; off+8 <= len(data); {
		id := string(data[off : off+4])
		size := int(binary.LittleEndian.Uint32(data[off+4 : off+8]))
		body := off + 8
		if size < 0 || body+size > len(data) {
			return nil, ErrSoundInvalidWAV
		}
		chunk := data[body : body+size]
		switch id {
		case "fmt ":
			if len(chunk) < 16 {
				return nil, ErrSoundInvalidWAV
			}
			format := binary.LittleEndian.Uint16(chunk[0:2])
			channels := binary.LittleEndian.Uint16(chunk[2:4])
			rate := binary.LittleEndian.Uint32(chunk[4:8])
			bits := binary.LittleEndian.Uint16(chunk[14:16])
			if format != 1 || channels != 1 || rate != soundboardSampleRate || bits != 16 {
				return nil, ErrSoundInvalidWAV
			}
			haveFmt = true
		case "data":
			pcm = chunk
			found = true
		}
		// Chunks are padded to an even size.
		off = body + size + size%2
	}
	if !haveFmt || !found || len(pcm) < 2 {
		return nil, ErrSoundInvalidWAV
	}
	samples := make([]int16, len(pcm)/2)
	for i := range samples {
		samples[i] = int16(binary.LittleEndian.Uint16(pcm[i*2:]))
	}
	return samples, nil
}

// encodeWAVToOpus converts a soundboard WAV upload to Ogg Opus.
func encodeWAVToOpus(data []byte) ([]byte, error) {
	samples, err := parseSoundboardWAV(data)
	if err != nil {
		return nil, err
	}
	duration := time.Duration(len(samples)) * time.Second / soundboardSampleRate
	if duration > MaxSoundboardDuration+soundboardDurationSlack {
		return nil, ErrSoundTooLong
	}

	enc, err := opus.NewEncoder(soundboardSampleRate, 1, opus.AppAudio)
	if err != nil {
		return nil, fmt.Errorf("failed to create opus encoder: %w", err)
	}
	if err := enc.SetBitrate(soundboardOpusBitrate); err != nil {
		return nil, fmt.Errorf("failed to set opus bitrate: %w", err)
	}

	padded := make([]int16, soundboardLeadingPad+len(samples))
	copy(padded[soundboardLeadingPad:], samples)

	var out bytes.Buffer
	writer, err := oggwriter.NewWriter(&out,
		oggwriter.WithSampleRate(soundboardSampleRate),
		oggwriter.WithChannelCount(1),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create ogg writer: %w", err)
	}
	const ssrc = 1
	track, err := writer.NewTrack(ssrc)
	if err != nil {
		return nil, fmt.Errorf("failed to create ogg track: %w", err)
	}

	frame := make([]int16, soundboardFrameSamples)
	packet := make([]byte, soundboardMaxOpusFrame)
	for i, seq := 0, uint16(0); i < len(padded); i, seq = i+soundboardFrameSamples, seq+1 {
		// The last frame is zero-padded to a full 20 ms.
		n := copy(frame, padded[i:])
		clear(frame[n:])
		size, err := enc.Encode(frame, packet)
		if err != nil {
			return nil, fmt.Errorf("failed to encode opus frame: %w", err)
		}
		if err := track.WriteRTP(&rtp.Packet{
			Header: rtp.Header{
				Version:        2,
				SSRC:           ssrc,
				SequenceNumber: seq,
				Timestamp:      uint32(i),
			},
			Payload: append([]byte(nil), packet[:size]...),
		}); err != nil {
			return nil, fmt.Errorf("failed to write ogg page: %w", err)
		}
	}
	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("failed to finalize ogg stream: %w", err)
	}
	return out.Bytes(), nil
}
