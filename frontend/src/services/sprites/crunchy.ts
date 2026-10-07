import type { SoundPackSprite } from "@/types/audio"

const crunchySprites: Record<string, SoundPackSprite> = {
  "camera_start": { "name": "camera_start", "start": 0, "duration": 461 },
  "camera_stop": { "name": "camera_stop", "start": 661, "duration": 648 },
  "deafen": { "name": "deafen", "start": 1509, "duration": 743 },
  "join_room": { "name": "join_room", "start": 2452, "duration": 929 },
  "leave_room": { "name": "leave_room", "start": 3581, "duration": 688 },
  "message": { "name": "message", "start": 4469, "duration": 1432 },
  "mute": { "name": "mute", "start": 6101, "duration": 213 },
  "screenshare_start": { "name": "screenshare_start", "start": 6514, "duration": 704 },
  "screenshare_stop": { "name": "screenshare_stop", "start": 7418, "duration": 795 },
  "undeafen": { "name": "undeafen", "start": 8413, "duration": 890 },
  "unmute": { "name": "unmute", "start": 9503, "duration": 243 },
  "viewer_joined": { "name": "viewer_joined", "start": 9946, "duration": 856 },
  "viewer_left": { "name": "viewer_left", "start": 11002, "duration": 598 },
  "reconnected": { "name": "reconnected", "start": 11800, "duration": 759 },
  "reconnecting": { "name": "reconnecting", "start": 12759, "duration": 659 },
}

export { crunchySprites }
