import { wsService } from "@/services/websocket"
import type { MessageCallback } from "@/services/websocket"
import { debugLog } from "@/utils/debug"

export function setupSoundPackHandlers(
  roomStore: { updateUserSoundPack: (userId: string, soundPack: string) => void },
  soundPackStore: { setUserPack: (userId: string, soundPack: string) => void },
  cleanupFns: Array<() => void>,
): void {
  const onSoundPackChange: MessageCallback = (message) => {
    const data = message.data as { user_id: string; sound_pack: string }
    debugLog("[WebSocket] User sound pack changed:", data.user_id, "sound_pack:", data.sound_pack)
    roomStore.updateUserSoundPack(data.user_id, data.sound_pack)
    soundPackStore.setUserPack(data.user_id, data.sound_pack)
  }
  wsService.onGlobal("sound_pack_change", onSoundPackChange)
  cleanupFns.push(() => wsService.offGlobal("sound_pack_change", onSoundPackChange))
}
