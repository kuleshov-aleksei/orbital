import { useCallStore, useUserStore, useRoomStore } from "@/stores"
import { useSounds } from "@/services/sounds"

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

    // Server sync happens in usePresenceBroadcast (watches callStore and sends
    // one full snapshot). Update the local sidebar entry right away.
    roomStore.updateUserStatus(
      userStore.userId,
      { is_muted: callStore.isMuted, is_deafened: callStore.isDeafened },
      roomStore.activeRoomId ?? undefined,
    )
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

    // Server sync happens in usePresenceBroadcast. Use callStore.isMuted to
    // get the actual mute state after setDeafened (auto-mute / restore).
    roomStore.updateUserStatus(
      userStore.userId,
      { is_deafened: callStore.isDeafened, is_muted: callStore.isMuted },
      roomStore.activeRoomId ?? undefined,
    )
  }

  return {
    toggleMute,
    toggleDeafen,
  }
}
