package chatmedia

import "bytes"

// Attachment kinds.
const (
	KindImage = "image"
	KindVideo = "video"
	KindAudio = "audio"
)

// fileType is what content sniffing found.
type fileType struct {
	kind, mime, ext string
}

// sniff detects an allowed type from magic bytes (png, webp, gif, jpeg, mp3,
// wav, ogg, mp4). The filename and the client MIME type are never trusted.
func sniff(head []byte) (fileType, bool) {
	switch {
	case bytes.HasPrefix(head, []byte("\x89PNG\r\n\x1a\n")):
		return fileType{KindImage, "image/png", "png"}, true
	case bytes.HasPrefix(head, []byte{0xFF, 0xD8, 0xFF}):
		return fileType{KindImage, "image/jpeg", "jpg"}, true
	case bytes.HasPrefix(head, []byte("GIF87a")), bytes.HasPrefix(head, []byte("GIF89a")):
		return fileType{KindImage, "image/gif", "gif"}, true
	case riff(head, "WEBP"):
		return fileType{KindImage, "image/webp", "webp"}, true
	case riff(head, "WAVE"):
		return fileType{KindAudio, "audio/wav", "wav"}, true
	case bytes.HasPrefix(head, []byte("OggS")):
		return fileType{KindAudio, "audio/ogg", "ogg"}, true
	case bytes.HasPrefix(head, []byte("ID3")), mp3FrameSync(head):
		return fileType{KindAudio, "audio/mpeg", "mp3"}, true
	case len(head) >= 12 && bytes.Equal(head[4:8], []byte("ftyp")):
		// ISO base media is a container family: only video MP4 brands are
		// accepted. HEIC/AVIF images, 3GP, audio-only M4A and QuickTime are not.
		if mp4VideoBrands[string(head[8:12])] {
			return fileType{KindVideo, "video/mp4", "mp4"}, true
		}
	}
	return fileType{}, false
}

// mp4VideoBrands are the ftyp major brands of MP4 video files.
var mp4VideoBrands = map[string]bool{
	"isom": true, "iso2": true, "iso3": true, "iso4": true, "iso5": true,
	"iso6": true, "iso7": true, "iso8": true, "iso9": true,
	"mp41": true, "mp42": true, "mp71": true,
	"avc1": true, "hvc1": true, "hev1": true, "av01": true,
	"M4V ": true, "M4VH": true, "M4VP": true,
	"dash": true, "msdh": true, "mmp4": true, "MSNV": true, "f4v ": true,
}

func riff(head []byte, form string) bool {
	return len(head) >= 12 && bytes.HasPrefix(head, []byte("RIFF")) && string(head[8:12]) == form
}

// mp3FrameSync matches an MPEG audio frame header without an ID3 tag:
// 11 sync bits, a valid version/layer and a non-reserved bitrate.
func mp3FrameSync(head []byte) bool {
	if len(head) < 3 || head[0] != 0xFF || head[1]&0xE0 != 0xE0 {
		return false
	}
	version := (head[1] >> 3) & 0x03
	layer := (head[1] >> 1) & 0x03
	bitrate := head[2] >> 4
	return version != 1 && layer != 0 && bitrate != 0x0F
}

// animatedWebP reports whether a WebP has the VP8X animation flag.
func animatedWebP(data []byte) bool {
	return len(data) >= 21 && string(data[12:16]) == "VP8X" && data[20]&0x02 != 0
}
