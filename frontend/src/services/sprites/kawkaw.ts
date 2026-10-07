import type { SoundPackSprite } from "@/types/audio"

const kawkawSprites: Record<string, SoundPackSprite> = {
  "camera_start": { "name": "camera_start", "start": 0, "duration": 764 },
  "screenshare_start": { "name": "screenshare_start", "start": 0, "duration": 764 },
  "viewer_joined": { "name": "viewer_joined", "start": 0, "duration": 764 },
  "camera_stop": { "name": "camera_stop", "start": 964, "duration": 1073 },
  "screenshare_stop": { "name": "screenshare_stop", "start": 964, "duration": 1073 },
  "viewer_left": { "name": "viewer_left", "start": 964, "duration": 1073 },
  "join_room": { "name": "join_room", "start": 2237, "duration": 655 },
  "leave_room": { "name": "leave_room", "start": 3092, "duration": 1073 },
  "message": { "name": "message", "start": 4365, "duration": 450 },
  "mute": { "name": "mute", "start": 5015, "duration": 529 },
  "deafen": { "name": "deafen", "start": 5015, "duration": 529 },
  "unmute": { "name": "unmute", "start": 5744, "duration": 903 },
  "undeafen": { "name": "undeafen", "start": 5744, "duration": 903 },
  "reconnected": { "name": "reconnected", "start": 6847, "duration": 759 },
  "reconnecting": { "name": "reconnecting", "start": 7806, "duration": 659 },
}

export { kawkawSprites }
