import type { SoundPackSprite } from "@/types/audio"

const crunchySprites: Record<string, SoundPackSprite> = {
  "camera_start": {
    "name": "camera_start",
    "start": 0,
    "duration": 461
  },
  "camera_stop": {
    "name": "camera_stop",
    "start": 2000,
    "duration": 648
  },
  "deafen": {
    "name": "deafen",
    "start": 4000,
    "duration": 743
  },
  "join_room": {
    "name": "join_room",
    "start": 6000,
    "duration": 929
  },
  "leave_room": {
    "name": "leave_room",
    "start": 8000,
    "duration": 688
  },
  "message": {
    "name": "message",
    "start": 10000,
    "duration": 1432
  },
  "mute": {
    "name": "mute",
    "start": 13000,
    "duration": 213
  },
  "screenshare_start": {
    "name": "screenshare_start",
    "start": 15000,
    "duration": 704
  },
  "screenshare_stop": {
    "name": "screenshare_stop",
    "start": 17000,
    "duration": 795
  },
  "undeafen": {
    "name": "undeafen",
    "start": 19000,
    "duration": 890
  },
  "unmute": {
    "name": "unmute",
    "start": 21000,
    "duration": 243
  },
  "viewer_joined": {
    "name": "viewer_joined",
    "start": 23000,
    "duration": 856
  },
  "viewer_left": {
    "name": "viewer_left",
    "start": 25000,
    "duration": 598
  }
}

export { crunchySprites }
