import type { SoundPackSprite } from "@/types/audio"

const minecraftSprites: Record<string, SoundPackSprite> = {
  "camera_start": { "name": "camera_start", "start": 0, "duration": 670 },
  "camera_stop": { "name": "camera_stop", "start": 870, "duration": 694 },
  "deafen": { "name": "deafen", "start": 1764, "duration": 592 },
  "join_room": { "name": "join_room", "start": 2556, "duration": 588 },
  "leave_room": { "name": "leave_room", "start": 3344, "duration": 920 },
  "message": { "name": "message", "start": 4464, "duration": 346 },
  "mute": { "name": "mute", "start": 5010, "duration": 809 },
  "screenshare_start": { "name": "screenshare_start", "start": 6019, "duration": 987 },
  "screenshare_stop": { "name": "screenshare_stop", "start": 7206, "duration": 1299 },
  "undeafen": { "name": "undeafen", "start": 8705, "duration": 549 },
  "unmute": { "name": "unmute", "start": 9454, "duration": 659 },
  "viewer_joined": { "name": "viewer_joined", "start": 10313, "duration": 813 },
  "viewer_left": { "name": "viewer_left", "start": 11326, "duration": 490 },
  "reconnected": { "name": "reconnected", "start": 12016, "duration": 759 },
  "reconnecting": { "name": "reconnecting", "start": 12975, "duration": 659 },
}

export { minecraftSprites }
