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
  message: { name: "notification", start: 8000, duration: 200 },
  viewer_joined: { name: "toggle_off", start: 42000, duration: 100 },
  viewer_left: { name: "toggle_on", start: 40000, duration: 100 },
  shooting: { name: "notification", start: 8000, duration: 120 },
  slug_destroyed: { name: "notification", start: 8000, duration: 200 },
  pumpkin_destroyed: { name: "transition_down", start: 44000, duration: 200 },
  item_used: { name: "toggle_on", start: 40000, duration: 120 },
  slug_movement: { name: "notification", start: 8000, duration: 80 },
  shield_break: { name: "notification", start: 8200, duration: 80 },
}

export { defaultSprites }
