import type { SoundPackSprite } from "@/types/audio"

const defaultSprites: Record<string, SoundPackSprite> = {
  join_room: { name: "transition_up", start: 46000, duration: 100 },
  leave_room: { name: "transition_down", start: 44000, duration: 100 },
  mute: { name: "toggle_off", start: 42000, duration: 100 },
  unmute: { name: "toggle_on", start: 40000, duration: 100 },
  deafen: { name: "toggle_off", start: 42000, duration: 100 },
  undeafen: { name: "toggle_on", start: 40000, duration: 100 },
  camera_start: { name: "toggle_off", start: 42000, duration: 100 },
  camera_stop: { name: "toggle_on", start: 40000, duration: 100 },
  screenshare_start: { name: "toggle_off", start: 42000, duration: 100 },
  screenshare_stop: { name: "toggle_on", start: 40000, duration: 100 },
}

export { defaultSprites }
