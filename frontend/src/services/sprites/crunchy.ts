import type { SoundPackSprite } from "@/types/audio"

const crunchySprites: Record<string, SoundPackSprite> = {
  deafen: {
    name: "deafen",
    start: 0,
    duration: 743,
  },
  join_room: {
    name: "join_room",
    start: 2000,
    duration: 929,
  },
  leave_room: {
    name: "leave_room",
    start: 4000,
    duration: 688,
  },
  mute: {
    name: "mute",
    start: 6000,
    duration: 213,
  },
  undeafen: {
    name: "undeafen",
    start: 8000,
    duration: 890,
  },
  unmute: {
    name: "unmute",
    start: 10000,
    duration: 243,
  },
  camera_start: {
    name: "camera_start",
    start: 6000,
    duration: 213,
  },
  camera_stop: {
    name: "camera_stop",
    start: 10000,
    duration: 243,
  },
  screenshare_start: {
    name: "screenshare_start",
    start: 6000,
    duration: 213,
  },
  screenshare_stop: {
    name: "screenshare_stop",
    start: 10000,
    duration: 243,
  },
}

export { crunchySprites }
