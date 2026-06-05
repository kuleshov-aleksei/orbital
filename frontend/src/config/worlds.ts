export interface WorldConfig {
  id: string
  label: string
  allowedCharacters?: string[]
  movement?: "topdown" | "vehicle"
}

export const AVAILABLE_WORLDS: WorldConfig[] = [
  {
    id: "default",
    label: "Default",
    allowedCharacters: [
      "targ",
      "jeremy",
      "elisabeth",
      "robert",
      "kusya",
      "ricardo",
      "boltuhai",
      "bonk",
      "sid",
    ],
  },
  {
    id: "monaco",
    label: "Monaco",
    allowedCharacters: ["redbull"],
    movement: "vehicle",
  },
]

export function getWorldConfig(worldId: string): WorldConfig {
  return AVAILABLE_WORLDS.find((w) => w.id === worldId) ?? { id: worldId, label: worldId }
}
