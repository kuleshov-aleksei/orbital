import { defineStore } from "pinia"
import { ref, computed, watch } from "vue"
import {
  Room,
  RoomEvent,
  type Participant,
  type RemoteParticipant,
  type LocalParticipant,
} from "livekit-client"
import { useRoomStore } from "./room"
import { useCallStore } from "./call"
import { useUserStore } from "./user"

// Debounce helper for batching updates
function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number,
  { leading = false, trailing = true }: { leading?: boolean; trailing?: boolean } = {},
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let lastArgs: Parameters<T> | null = null

  return (...args: Parameters<T>) => {
    lastArgs = args

    const shouldCallNow = leading && !timeoutId

    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    timeoutId = setTimeout(() => {
      if (trailing && lastArgs) {
        fn(...lastArgs)
      }
      timeoutId = null
      lastArgs = null
    }, delay)

    if (shouldCallNow) {
      fn(...args)
    }
  }
}

// Participant metadata stored in LiveKit attributes
interface ParticipantMetadata {
  user_id: string
  nickname: string
  avatar_url?: string
  is_muted: boolean
  is_deafened: boolean
}

// Presence state for a participant
interface PresenceState {
  userId: string
  nickname: string
  avatarUrl?: string
  isSpeaking: boolean
  isMuted: boolean
  isDeafened: boolean
  isScreenSharing: boolean
  isCameraEnabled: boolean
  audioLevel: number
}

export const usePresenceStore = defineStore("presence", () => {
  // State
  const room = ref<Room | null>(null)
  const participants = ref<Map<string, PresenceState>>(new Map())
  const localParticipant = ref<LocalParticipant | null>(null)
  const isConnected = ref(false)

  // Getters
  const participantList = computed(() => Array.from(participants.value.values()))

  const speakingParticipants = computed(() =>
    participantList.value.filter((p) => p.isSpeaking && !p.isMuted),
  )

  const getParticipant = computed(() => (userId: string) => participants.value.get(userId))

  // Helper to extract metadata from LiveKit participant attributes
  const extractMetadata = (participant: Participant): ParticipantMetadata => {
    const attributes = participant.attributes || {}
    return {
      user_id: attributes.user_id || participant.identity,
      nickname: attributes.nickname || participant.name || participant.identity,
      avatar_url: attributes.avatar_url,
      is_muted: attributes.is_muted === "true",
      is_deafened: attributes.is_deafened === "true",
    }
  }

  // Update participant state from LiveKit participant
  const updateParticipantFromLiveKit = (lkParticipant: Participant) => {
    const metadata = extractMetadata(lkParticipant)

    // Check if camera is enabled by looking for camera tracks
    const hasCameraTrack = Array.from(lkParticipant.trackPublications.values()).some(
      (pub) => pub.track && pub.source === "camera",
    )

    const presenceState: PresenceState = {
      userId: metadata.user_id,
      nickname: metadata.nickname,
      avatarUrl: metadata.avatar_url,
      isSpeaking: lkParticipant.isSpeaking || false,
      isMuted: metadata.is_muted,
      isDeafened: metadata.is_deafened,
      isScreenSharing: lkParticipant.isScreenShareEnabled || false,
      isCameraEnabled: hasCameraTrack,
      audioLevel: lkParticipant.audioLevel || 0,
    }

    participants.value.set(metadata.user_id, presenceState)

    // Also update room store for UI consistency
    const roomStore = useRoomStore()
    roomStore.updateUserStatus(metadata.user_id, {
      is_speaking: presenceState.isSpeaking,
      is_muted: presenceState.isMuted,
      is_deafened: presenceState.isDeafened,
      is_screen_sharing: presenceState.isScreenSharing,
    })
  }

  // Initialize presence tracking with a LiveKit room
  const initializePresence = async (lkRoom: Room) => {
    room.value = lkRoom
    localParticipant.value = lkRoom.localParticipant
    isConnected.value = true

    // Set up local participant attributes
    const userStore = useUserStore()
    const callStore = useCallStore()

    // Initialize local attributes
    const currentUser = userStore.currentUser
    await updateLocalAttributes({
      user_id: userStore.userId,
      nickname: currentUser?.nickname ?? userStore.userId,
      avatar_url: currentUser?.avatarUrl,
      is_muted: callStore.isMuted.toString(),
      is_deafened: callStore.isDeafened.toString(),
    })

    // Subscribe to participant events
    lkRoom.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      console.log("[Presence] Participant connected:", participant.identity)
      updateParticipantFromLiveKit(participant)
    })

    lkRoom.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      console.log("[Presence] Participant disconnected:", participant.identity)
      const metadata = extractMetadata(participant)
      participants.value.delete(metadata.user_id)
    })

    lkRoom.on(
      RoomEvent.ParticipantAttributesChanged,
      (changedAttributes: Record<string, string | undefined>, participant: Participant) => {
        console.log("[Presence] Participant attributes changed:", {
          identity: participant?.identity,
          name: participant?.name,
          attributes: participant?.attributes,
          changedAttributes,
          isLocal: participant === lkRoom.localParticipant,
        })
        if (participant) {
          updateParticipantFromLiveKit(participant)
        }
      },
    )

    // Track current active speakers to detect when someone stops speaking
    let activeSpeakers: Set<string> = new Set()

    // Debounced batch update for ActiveSpeakersChanged to reduce reactive churn
    const debouncedBatchUpdate = debounce(
      (speakers: Participant[]) => {
        const newActiveSpeakers = new Set(speakers.map((s) => s.identity))

        // Update speakers who are no longer active (stopped speaking)
        activeSpeakers.forEach((identity) => {
          if (!newActiveSpeakers.has(identity)) {
            const participant =
              lkRoom.getParticipantByIdentity(identity) ||
              (identity === lkRoom.localParticipant.identity ? lkRoom.localParticipant : null)
            if (participant) {
              updateParticipantFromLiveKit(participant)
            }
          }
        })

        // Update current active speakers
        speakers.forEach((speaker) => {
          updateParticipantFromLiveKit(speaker)
        })

        activeSpeakers = newActiveSpeakers
      },
      50,
      { leading: true, trailing: false },
    )

    lkRoom.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
      debouncedBatchUpdate(speakers)
    })

    lkRoom.on(RoomEvent.TrackMuted, (track, participant: Participant) => {
      console.log("[Presence] Track muted:", participant.identity, track.source)
      updateParticipantFromLiveKit(participant)
    })

    lkRoom.on(RoomEvent.TrackUnmuted, (track, participant: Participant) => {
      console.log("[Presence] Track unmuted:", participant.identity, track.source)
      updateParticipantFromLiveKit(participant)
    })

    // Load existing participants
    lkRoom.remoteParticipants.forEach((participant) => {
      updateParticipantFromLiveKit(participant)
    })

    // Load local participant
    updateParticipantFromLiveKit(lkRoom.localParticipant)

    // Watch for local mute/deafen changes and sync to LiveKit
    watch(
      () => callStore.isMuted,
      (newValue) => {
        void updateLocalAttributes({ is_muted: newValue.toString() })
        // Also update microphone enabled state in LiveKit
        void lkRoom.localParticipant.setMicrophoneEnabled(!newValue)
      },
    )

    watch(
      () => callStore.isDeafened,
      (newValue) => {
        void updateLocalAttributes({ is_deafened: newValue.toString() })
      },
    )
  }

  // Update local participant attributes
  const updateLocalAttributes = async (attributes: Partial<ParticipantMetadata>) => {
    if (!localParticipant.value) return

    const currentAttributes = localParticipant.value.attributes || {}
    const newAttributes: Record<string, string> = {}

    // Convert all values to strings for LiveKit attributes
    Object.entries(attributes).forEach(([key, value]) => {
      if (value !== undefined) {
        newAttributes[key] = String(value)
      }
    })

    await localParticipant.value.setAttributes({
      ...currentAttributes,
      ...newAttributes,
    })

    // Check if camera is enabled for local participant
    const hasCameraTrack = Array.from(localParticipant.value.trackPublications.values()).some(
      (pub) => pub.track && pub.source === "camera",
    )

    // Update local state
    const metadata = extractMetadata(localParticipant.value)
    const presenceState: PresenceState = {
      userId: metadata.user_id,
      nickname: metadata.nickname,
      avatarUrl: metadata.avatar_url,
      isSpeaking: localParticipant.value.isSpeaking || false,
      isMuted: metadata.is_muted,
      isDeafened: metadata.is_deafened,
      isScreenSharing: localParticipant.value.isScreenShareEnabled || false,
      isCameraEnabled: hasCameraTrack,
      audioLevel: localParticipant.value.audioLevel || 0,
    }
    participants.value.set(metadata.user_id, presenceState)
  }

  // Set microphone enabled (mute/unmute)
  const setMicrophoneEnabled = async (enabled: boolean) => {
    if (!localParticipant.value) return

    await localParticipant.value.setMicrophoneEnabled(enabled)
    await updateLocalAttributes({ is_muted: (!enabled).toString() })
  }

  // Set deafened state
  const setDeafened = async (deafened: boolean) => {
    if (!localParticipant.value) return

    await updateLocalAttributes({ is_deafened: deafened.toString() })
  }

  // Cleanup
  const cleanup = () => {
    room.value = null
    localParticipant.value = null
    participants.value.clear()
    isConnected.value = false
  }

  return {
    // State
    room,
    participants,
    localParticipant,
    isConnected,
    // Getters
    participantList,
    speakingParticipants,
    getParticipant,
    // Actions
    initializePresence,
    updateLocalAttributes,
    setMicrophoneEnabled,
    setDeafened,
    cleanup,
  }
})
