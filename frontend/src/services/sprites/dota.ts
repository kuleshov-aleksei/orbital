import type { SoundPackSprite } from "@/types/audio"

const dotaSprites: Record<string, SoundPackSprite> = {
  "camera_start": { "name": "camera_start", "start": 0, "duration": 2652 },
  "camera_stop": { "name": "camera_stop", "start": 2852, "duration": 2010 },
  "screenshare_stop": { "name": "screenshare_stop", "start": 2852, "duration": 2010 },
  "deafen": { "name": "deafen", "start": 5062, "duration": 1996 },
  "join_room": { "name": "join_room", "start": 7258, "duration": 2037 },
  "leave_room": { "name": "leave_room", "start": 9495, "duration": 1102 },
  "message": { "name": "message", "start": 10797, "duration": 537 },
  "mute": { "name": "mute", "start": 11534, "duration": 2000 },
  "screenshare_start": { "name": "screenshare_start", "start": 13734, "duration": 2647 },
  "undeafen": { "name": "undeafen", "start": 16581, "duration": 1745 },
  "unmute": { "name": "unmute", "start": 18526, "duration": 5489 },
  "viewer_joined": { "name": "viewer_joined", "start": 24215, "duration": 673 },
  "viewer_left": { "name": "viewer_left", "start": 25088, "duration": 972 },
  "reconnected": { "name": "reconnected", "start": 26260, "duration": 759 },
  "reconnecting": { "name": "reconnecting", "start": 27219, "duration": 659 },
}

export { dotaSprites }
