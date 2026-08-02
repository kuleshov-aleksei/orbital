import type { SoundPackSprite } from "@/types/audio"

const dotaSprites: Record<string, SoundPackSprite> = {
  "camera_start": {
    "name": "camera_start",
    "start": 0,
    "duration": 2652
  },
  "camera_stop": {
    "name": "camera_stop",
    "start": 4000,
    "duration": 2010
  },
  "deafen": {
    "name": "deafen",
    "start": 8000,
    "duration": 1996
  },
  "join_room": {
    "name": "join_room",
    "start": 11000,
    "duration": 2037
  },
  "leave_room": {
    "name": "leave_room",
    "start": 15000,
    "duration": 1102
  },
  "mute": {
    "name": "mute",
    "start": 18000,
    "duration": 2000
  },
  "screenshare_start": {
    "name": "screenshare_start",
    "start": 21000,
    "duration": 2647
  },
  "screenshare_stop": {
    "name": "screenshare_stop",
    "start": 4000,
    "duration": 2010
  },
  "undeafen": {
    "name": "undeafen",
    "start": 25000,
    "duration": 1745
  },
  "unmute": {
    "name": "unmute",
    "start": 28000,
    "duration": 5489
  }
}

export { dotaSprites }
