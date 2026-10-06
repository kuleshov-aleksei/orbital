import type { SoundPackSprite } from "@/types/audio"

const defaultSprites: Record<string, SoundPackSprite> = {
  join_room: { name: "join_room", start: 0, duration: 100 },
  leave_room: { name: "leave_room", start: 300, duration: 100 },
  mute: { name: "mute", start: 600, duration: 100 },
  deafen: { name: "deafen", start: 600, duration: 100 },
  camera_start: { name: "camera_start", start: 600, duration: 100 },
  screenshare_start: { name: "screenshare_start", start: 600, duration: 100 },
  viewer_joined: { name: "viewer_joined", start: 600, duration: 100 },
  unmute: { name: "unmute", start: 900, duration: 100 },
  undeafen: { name: "undeafen", start: 900, duration: 100 },
  camera_stop: { name: "camera_stop", start: 900, duration: 100 },
  screenshare_stop: { name: "screenshare_stop", start: 900, duration: 100 },
  viewer_left: { name: "viewer_left", start: 900, duration: 100 },
  message: { name: "message", start: 1200, duration: 200 },
  reconnecting: { name: "reconnecting", start: 1600, duration: 659 },
  reconnected: { name: "reconnected", start: 2459, duration: 759 },
}

export { defaultSprites }
