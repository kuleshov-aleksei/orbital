import type { SoundPackSprite } from "@/types/audio"

const minecraftSprites: Record<string, SoundPackSprite> = {
  camera_start: {
    name: "camera_start",
    start: 0,
    duration: 670,
  },
  camera_stop: {
    name: "camera_stop",
    start: 2000,
    duration: 694,
  },
  deafen: {
    name: "deafen",
    start: 4000,
    duration: 592,
  },
  join_room: {
    name: "join_room",
    start: 6000,
    duration: 588,
  },
  leave_room: {
    name: "leave_room",
    start: 8000,
    duration: 920,
  },
  mute: {
    name: "mute",
    start: 10000,
    duration: 809,
  },
  screenshare_start: {
    name: "screenshare_start",
    start: 12000,
    duration: 987,
  },
  screenshare_stop: {
    name: "screenshare_stop",
    start: 14000,
    duration: 1299,
  },
  undeafen: {
    name: "undeafen",
    start: 17000,
    duration: 549,
  },
  unmute: {
    name: "unmute",
    start: 19000,
    duration: 659,
  },
}

export { minecraftSprites }
