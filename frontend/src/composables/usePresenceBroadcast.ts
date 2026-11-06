import { watch, type Ref } from "vue"
import { useCallStore } from "@/stores/call"
import { useRoomStore } from "@/stores/room"
import { useUserStore } from "@/stores/user"
import { wsService, type LocalMediaState } from "@/services/websocket"

export interface PresenceBroadcastSources {
  roomId: string
  // Actual LiveKit track state (set by LocalTrackPublished/Unpublished),
  // not the button intent stored in callStore.
  isScreenSharing: Ref<boolean>
  isCameraEnabled: Ref<boolean>
}

/**
 * Sends the local user's full media state (mute/deafen/screen share/camera)
 * to the backend as one snapshot whenever any part of it changes. The backend
 * room member is the single source of truth for the sidebar presence icons.
 */
export function usePresenceBroadcast(sources: PresenceBroadcastSources) {
  const callStore = useCallStore()
  const roomStore = useRoomStore()
  const userStore = useUserStore()

  const snapshot = (): LocalMediaState => ({
    isMuted: callStore.isMuted,
    isDeafened: callStore.isDeafened,
    isScreenSharing: sources.isScreenSharing.value,
    isCameraEnabled: sources.isCameraEnabled.value,
  })

  // flush: "post" batches synchronous changes (e.g. deafen auto-mutes) into a
  // single snapshot instead of two half-updated ones.
  return watch(
    snapshot,
    (state) => {
      wsService.sendMediaState(sources.roomId, state)
      roomStore.updateUserStatus(
        userStore.userId,
        {
          is_muted: state.isMuted,
          is_deafened: state.isDeafened,
          is_screen_sharing: state.isScreenSharing,
          is_camera_enabled: state.isCameraEnabled,
        },
        sources.roomId,
      )
    },
    { immediate: true, flush: "post" },
  )
}
