import type { SoundPackSprite } from "@/types/audio"

const destinySprites: Record<string, SoundPackSprite> = {
  message: { name: "message", start: 0, duration: 525 },
  mute: { name: "mute", start: 725, duration: 590 },
  unmute: { name: "unmute", start: 1515, duration: 881 },
  deafen: { name: "deafen", start: 2595, duration: 427 },
  undeafen: { name: "undeafen", start: 3222, duration: 524 },
  screenshare_stop: { name: "screenshare_stop", start: 3945, duration: 549 },
  camera_start: { name: "camera_start", start: 4694, duration: 1453 },
  leave_room: { name: "leave_room", start: 6347, duration: 5024 },
  viewer_joined: { name: "viewer_joined", start: 11570, duration: 1773 },
  screenshare_start: { name: "screenshare_start", start: 13543, duration: 2623 },
  camera_stop: { name: "camera_stop", start: 16366, duration: 870 },
  viewer_left: { name: "viewer_left", start: 17436, duration: 1509 },
  join_room: { name: "join_room", start: 19145, duration: 2300 },
}

export { destinySprites }
