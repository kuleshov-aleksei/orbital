import type { SoundPackSprite } from "@/types/audio"

const whooshSprites: Record<string, SoundPackSprite> = {
  "reconnected": { "name": "reconnected", "start": 0, "duration": 759 },
  "join_room": { "name": "join_room", "start": 959, "duration": 2040 },
  "leave_room": { "name": "leave_room", "start": 3199, "duration": 2040 },
  "message": { "name": "message", "start": 5439, "duration": 470 },
  "mute": { "name": "mute", "start": 6109, "duration": 744 },
  "deafen": { "name": "deafen", "start": 6109, "duration": 744 },
  "camera_start": { "name": "camera_start", "start": 6109, "duration": 744 },
  "screenshare_start": { "name": "screenshare_start", "start": 6109, "duration": 744 },
  "reconnecting": { "name": "reconnecting", "start": 7053, "duration": 659 },
  "unmute": { "name": "unmute", "start": 7911, "duration": 816 },
  "camera_stop": { "name": "camera_stop", "start": 7911, "duration": 816 },
  "screenshare_stop": { "name": "screenshare_stop", "start": 7911, "duration": 816 },
  "undeafen": { "name": "undeafen", "start": 7911, "duration": 816 },
  "viewer_joined": { "name": "viewer_joined", "start": 8927, "duration": 1316 },
  "viewer_left": { "name": "viewer_left", "start": 10443, "duration": 460 },
}

export { whooshSprites }
