import type { SoundPackSprite } from "@/types/audio"

const kawkawSprites: Record<string, SoundPackSprite> = {
  "camera_start": {
    "name": "camera_start",
    "start": 0,
    "duration": 764
  },
  "camera_stop": {
    "name": "camera_stop",
    "start": 2000,
    "duration": 1073
  },
  "screenshare_start": {
    "name": "screenshare_start",
    "start": 0,
    "duration": 764
  },
  "screenshare_stop": {
    "name": "screenshare_stop",
    "start": 2000,
    "duration": 1073
  },
  "join_room": {
    "name": "join_room",
    "start": 5000,
    "duration": 655
  },
  "leave_room": {
    "name": "leave_room",
    "start": 7000,
    "duration": 1073
  },
  "mute": {
    "name": "mute",
    "start": 10000,
    "duration": 529
  },
  "unmute": {
    "name": "unmute",
    "start": 12000,
    "duration": 903
  },
  "deafen": {
    "name": "deafen",
    "start": 10000,
    "duration": 529
  },
  "undeafen": {
    "name": "undeafen",
    "start": 12000,
    "duration": 903
  }
}

export { kawkawSprites }
