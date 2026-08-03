import type { SoundPackSprite } from "@/types/audio"

const jdSherbertSprites: Record<string, SoundPackSprite> = {
  "join_room": {
    "name": "join_room",
    "start": 0,
    "duration": 2040
  },
  "leave_room": {
    "name": "leave_room",
    "start": 4000,
    "duration": 2040
  },
  "message": {
    "name": "message",
    "start": 8000,
    "duration": 470
  },
  "mute": {
    "name": "mute",
    "start": 10000,
    "duration": 744
  },
  "unmute": {
    "name": "unmute",
    "start": 12000,
    "duration": 816
  },
  "deafen": {
    "name": "deafen",
    "start": 10000,
    "duration": 744
  },
  "endeafen": {
    "name": "endeafen",
    "start": 12000,
    "duration": 816
  },
  "camera_start": {
    "name": "camera_start",
    "start": 10000,
    "duration": 744
  },
  "camera_stop": {
    "name": "camera_stop",
    "start": 12000,
    "duration": 816
  },
  "screenshare_start": {
    "name": "screenshare_start",
    "start": 10000,
    "duration": 744
  },
  "screenshare_stop": {
    "name": "screenshare_stop",
    "start": 12000,
    "duration": 816
  },
  "viewer_joined": {
    "name": "viewer_joined",
    "start": 14000,
    "duration": 1316
  },
  "viewer_left": {
    "name": "viewer_left",
    "start": 17000,
    "duration": 460
  }
}

export { jdSherbertSprites }
