import { ref } from "vue"
import type {
  Room,
  LocalParticipant,
  LocalAudioTrack,
  LocalVideoTrack,
  LocalTrackPublication,
  RemoteParticipant,
  RemoteAudioTrack,
  RemoteVideoTrack,
} from "livekit-client"
import type { ScreenShareQuality, ConnectionStats } from "@/types"

export interface ScreenShareState {
  isSharing: boolean
  quality: ScreenShareQuality
}

export interface LiveKitState {
  getCurrentUserId: () => string
  room: ReturnType<typeof ref<Room | null>>
  isConnected: ReturnType<typeof ref<boolean>>
  isConnecting: ReturnType<typeof ref<boolean>>
  connectionError: ReturnType<typeof ref<string | null>>
  localParticipant: ReturnType<typeof ref<LocalParticipant | null>>
  localAudioTrack: ReturnType<typeof ref<LocalAudioTrack | null>>
  localAudioPublication: ReturnType<typeof ref<LocalTrackPublication | null>>
  remoteParticipants: ReturnType<typeof ref<Map<string, RemoteParticipant>>>
  remoteAudioTracks: ReturnType<typeof ref<Map<string, RemoteAudioTrack>>>
  isScreenSharing: ReturnType<typeof ref<boolean>>
  screenShareQuality: ReturnType<typeof ref<ScreenShareQuality>>
  localScreenVideoTrack: ReturnType<typeof ref<LocalVideoTrack | null>>
  localScreenAudioTrack: ReturnType<typeof ref<LocalAudioTrack | null>>
  userScreenShareStates: ReturnType<typeof ref<Map<string, ScreenShareState>>>
  remoteScreenTracks: ReturnType<
    typeof ref<Map<string, { video?: RemoteVideoTrack; audio?: RemoteAudioTrack }>>
  >
  screenShareVersion: ReturnType<typeof ref<number>>
  subscribedScreenShares: ReturnType<typeof ref<Set<string>>>
  localScreenVideoPublication: ReturnType<typeof ref<LocalTrackPublication | null>>
  localScreenAudioPublication: ReturnType<typeof ref<LocalTrackPublication | null>>
  isCameraEnabled: ReturnType<typeof ref<boolean>>
  localCameraTrack: ReturnType<typeof ref<LocalVideoTrack | null>>
  userCameraStates: ReturnType<typeof ref<Map<string, boolean>>>
  remoteCameraTracks: ReturnType<typeof ref<Map<string, RemoteVideoTrack>>>
  cameraVersion: ReturnType<typeof ref<number>>
  localCameraPublication: ReturnType<typeof ref<LocalTrackPublication | null>>
  isStoppingCamera: ReturnType<typeof ref<boolean>>
  isStartingCamera: ReturnType<typeof ref<boolean>>
  isStoppingScreenShare: ReturnType<typeof ref<boolean>>
  isStartingScreenShare: ReturnType<typeof ref<boolean>>
  localStreamPromise: ReturnType<typeof ref<Promise<LocalAudioTrack | null> | null>>
  currentPing: ReturnType<typeof ref<number>>
  participantStats: ReturnType<typeof ref<Map<string, ConnectionStats>>>
  previousStats: ReturnType<
    typeof ref<Map<string, Map<string, { bytesReceived: number; timestamp: number }>>>
  >
  remoteStreamVolumes: Map<string, number>
  onVolumeChange: (userId: string, volume: number) => void
}

export interface UseLiveKitStateOptions {
  remoteStreamVolumes: Map<string, number>
  onVolumeChange: (userId: string, volume: number) => void
}

export function useLiveKitState(options: UseLiveKitStateOptions): LiveKitState {
  const getCurrentUserId = (): string => {
    let userId = localStorage.getItem("orbital_user_id")
    if (!userId) {
      userId = "user_" + Math.random().toString(36).substr(2, 12)
      localStorage.setItem("orbital_user_id", userId)
    }
    return userId
  }

  const room = ref<Room | null>(null)
  const isConnected = ref(false)
  const isConnecting = ref(false)
  const connectionError = ref<string | null>(null)

  const localParticipant = ref<LocalParticipant | null>(null)
  const localAudioTrack = ref<LocalAudioTrack | null>(null)
  const localAudioPublication = ref<LocalTrackPublication | null>(null)

  const remoteParticipants = ref<Map<string, RemoteParticipant>>(new Map())
  const remoteAudioTracks = ref<Map<string, RemoteAudioTrack>>(new Map())

  const isScreenSharing = ref(false)
  const screenShareQuality = ref<ScreenShareQuality>("fullhd60")
  const localScreenVideoTrack = ref<LocalVideoTrack | null>(null)
  const localScreenAudioTrack = ref<LocalAudioTrack | null>(null)
  const userScreenShareStates = ref<Map<string, ScreenShareState>>(new Map())
  const remoteScreenTracks = ref<
    Map<string, { video?: RemoteVideoTrack; audio?: RemoteAudioTrack }>
  >(new Map())
  const screenShareVersion = ref(0)
  const subscribedScreenShares = ref<Set<string>>(new Set())
  const localScreenVideoPublication = ref<LocalTrackPublication | null>(null)
  const localScreenAudioPublication = ref<LocalTrackPublication | null>(null)

  const isCameraEnabled = ref(false)
  const localCameraTrack = ref<LocalVideoTrack | null>(null)
  const userCameraStates = ref<Map<string, boolean>>(new Map())
  const remoteCameraTracks = ref<Map<string, RemoteVideoTrack>>(new Map())
  const cameraVersion = ref(0)
  const localCameraPublication = ref<LocalTrackPublication | null>(null)
  const isStoppingCamera = ref(false)
  const isStartingCamera = ref(false)
  const isStoppingScreenShare = ref(false)
  const isStartingScreenShare = ref(false)

  const localStreamPromise = ref<Promise<LocalAudioTrack | null> | null>(null)

  const currentPing = ref<number>(0)

  const participantStats = ref<Map<string, ConnectionStats>>(new Map())
  const previousStats = ref<Map<string, Map<string, { bytesReceived: number; timestamp: number }>>>(
    new Map(),
  )

  return {
    getCurrentUserId,
    room,
    isConnected,
    isConnecting,
    connectionError,
    localParticipant,
    localAudioTrack,
    localAudioPublication,
    remoteParticipants,
    remoteAudioTracks,
    isScreenSharing,
    screenShareQuality,
    localScreenVideoTrack,
    localScreenAudioTrack,
    userScreenShareStates,
    remoteScreenTracks,
    screenShareVersion,
    subscribedScreenShares,
    localScreenVideoPublication,
    localScreenAudioPublication,
    isCameraEnabled,
    localCameraTrack,
    userCameraStates,
    remoteCameraTracks,
    cameraVersion,
    localCameraPublication,
    isStoppingCamera,
    isStartingCamera,
    isStoppingScreenShare,
    isStartingScreenShare,
    localStreamPromise,
    currentPing,
    participantStats,
    previousStats,
    remoteStreamVolumes: options.remoteStreamVolumes,
    onVolumeChange: options.onVolumeChange,
  }
}
