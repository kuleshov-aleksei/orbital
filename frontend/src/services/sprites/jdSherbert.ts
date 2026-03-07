import type { SoundPackSprite } from "@/types/audio"

const jdSherbertSprites: Record<string, SoundPackSprite> = {
  join_room: { name: "transition_up", start: 4000, duration: 2000 },
  leave_room: { name: "transition_down", start: 8000, duration: 2000 },
  mute: { name: "toggle_off", start: 0, duration: 900 },
  unmute: { name: "toggle_on", start: 2000, duration: 800 },
  deafen: { name: "toggle_off", start: 0, duration: 900 },
  undeafen: { name: "toggle_on", start: 2000, duration: 800 },
  camera_start: { name: "toggle_off", start: 0, duration: 900 },
  camera_stop: { name: "toggle_on", start: 2000, duration: 800 },
  screenshare_start: { name: "toggle_off", start: 0, duration: 900 },
  screenshare_stop: { name: "toggle_on", start: 2000, duration: 800 },
}

export { jdSherbertSprites }
