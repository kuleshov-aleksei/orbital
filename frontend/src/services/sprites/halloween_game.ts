import type { SoundPackSprite } from "@/types/audio"

const halloweenGameSprites: Record<string, SoundPackSprite> = {
  "card_pick": { "name": "card_pick", "start": 0, "duration": 600 },
  "freeze": { "name": "freeze", "start": 800, "duration": 3792 },
  "holy_grenade": { "name": "holy_grenade", "start": 4792, "duration": 6196 },
  "item_used": { "name": "item_used", "start": 11188, "duration": 1710 },
  "pumpkin_leveled": { "name": "pumpkin_leveled", "start": 13098, "duration": 344 },
  "pumpkin_destroyed": { "name": "pumpkin_destroyed", "start": 13642, "duration": 251 },
  "purchase": { "name": "purchase", "start": 14093, "duration": 1485 },
  "shooting": { "name": "shooting", "start": 15778, "duration": 468 },
  "seed_rain": { "name": "seed_rain", "start": 16445, "duration": 631 },
  "sell": { "name": "sell", "start": 17276, "duration": 1668 },
  "shield_break": { "name": "shield_break", "start": 19144, "duration": 1046 },
  "slug_destroyed": { "name": "slug_destroyed", "start": 20390, "duration": 612 },
  "pumkin_place": { "name": "pumkin_place", "start": 21202, "duration": 225 },
}

export { halloweenGameSprites }
