import { useCallStore, useUserStore, useRoomStore } from "@/stores"
import { useSounds } from "@/services/sounds"
import { wsService } from "@/services/websocket"

export function useMuteDeafenToggle() {
  const callStore = useCallStore()
  const userStore = useUserStore()
  const roomStore = useRoomStore()
  const { playMute, playUnmute, playDeafen, playUndeafen } = useSounds()

  function toggleMute(forcedValue?: boolean) {
    const newValue = forcedValue ?? !callStore.isMuted
    const wasDeafened = callStore.isDeafened

    // Play sound locally (remote users hear it via presence.ts)
    if (newValue) {
      playMute()
    } else if (wasDeafened) {
      // Unmuting while deafened also undeafens: only the undeafen sound plays,
      // matching the single event remote participants hear via presence.ts
      playUndeafen()
    } else {
      playUnmute()
    }

    // Update call store (auto-undeafens when unmuting while deafened)
    callStore.setMuted(newValue)

    // Send to server for global state sync (users outside the call will see the state)
    const roomId = roomStore.activeRoomId
    if (roomId) {
      wsService.sendMuteState(roomId, newValue)
      if (wasDeafened && !newValue) {
        wsService.sendDeafenState(roomId, false)
      }
    }

    // Immediately update room store for local user so UI updates right away
    roomStore.updateUserStatus(userStore.userId, {
      is_muted: newValue,
      is_deafened: callStore.isDeafened,
    })
  }

  function toggleDeafen() {
    const newValue = !callStore.isDeafened

    // Play sound locally (remote users hear it via presence.ts)
    if (newValue) {
      playDeafen()
    } else {
      playUndeafen()
    }

    // Update call store (presence store watches this and syncs with LiveKit)
    // This also handles auto-mute on deafen and restore-mute on undeafen
    callStore.setDeafened(newValue)

    // Send to server for global state sync (users outside the call will see the state)
    const roomId = roomStore.activeRoomId
    if (roomId) {
      wsService.sendDeafenState(roomId, newValue)
    }

    // Immediately update room store for local user so UI updates right away
    // Use callStore.isMuted to get the actual current mute state after setDeafened
    roomStore.updateUserStatus(userStore.userId, {
      is_deafened: newValue,
      is_muted: callStore.isMuted,
    })
  }

  return {
    toggleMute,
    toggleDeafen,
  }
}
