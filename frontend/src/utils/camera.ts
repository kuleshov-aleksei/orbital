export function isRearCamera(
  track: { mediaStreamTrack: MediaStreamTrack } | MediaStreamTrack | null | undefined,
): boolean {
  try {
    const mediaTrack = track && "mediaStreamTrack" in track ? track.mediaStreamTrack : track
    const facing = mediaTrack?.getSettings().facingMode
    return facing === "environment" || facing === "left" || facing === "right"
  } catch {
    return false
  }
}
