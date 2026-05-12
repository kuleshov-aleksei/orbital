import { ref, type Ref } from "vue"
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
  room: Ref<Room | null>
  isConnected: Ref<boolean>
  isConnecting: Ref<boolean>
  connectionError: Ref<string | null>
  localParticipant: Ref<LocalParticipant | null>
  localAudioTrack: Ref<LocalAudioTrack | null>
  localAudioPublication: Ref<LocalTrackPublication | null>
  remoteParticipants: Ref<Map<string, RemoteParticipant>>
  remoteAudioTracks: Ref<Map<string, RemoteAudioTrack>>
  isScreenSharing: Ref<boolean>
  screenShareQuality: Ref<ScreenShareQuality>
  localScreenVideoTrack: Ref<LocalVideoTrack | null>
  localScreenAudioTrack: Ref<LocalAudioTrack | null>
  userScreenShareStates: Ref<Map<string, ScreenShareState>>
  remoteScreenTracks: Ref<Map<string, { video?: RemoteVideoTrack; audio?: RemoteAudioTrack }>>
  screenShareVersion: Ref<number>
  subscribedScreenShares: Ref<Set<string>>
  localScreenVideoPublication: Ref<LocalTrackPublication | null>
  localScreenAudioPublication: Ref<LocalTrackPublication | null>
  isCameraEnabled: Ref<boolean>
  localCameraTrack: Ref<LocalVideoTrack | null>
  userCameraStates: Ref<Map<string, boolean>>
  remoteCameraTracks: Ref<Map<string, RemoteVideoTrack>>
  cameraVersion: Ref<number>
  localCameraPublication: Ref<LocalTrackPublication | null>
  isStoppingCamera: Ref<boolean>
  isStartingCamera: Ref<boolean>
  isStoppingScreenShare: Ref<boolean>
  isStartingScreenShare: Ref<boolean>
  localStreamPromise: Ref<Promise<LocalAudioTrack | null> | null>
  currentPing: Ref<number>
  participantStats: Ref<Map<string, ConnectionStats>>
  previousStats: Ref<Map<string, Map<string, { bytesReceived: number; timestamp: number }>>>
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
    room: room as Ref<Room | null>,
    isConnected: isConnected as Ref<boolean>,
    isConnecting: isConnecting as Ref<boolean>,
    connectionError: connectionError as Ref<string | null>,
    localParticipant: localParticipant as Ref<LocalParticipant | null>,
    localAudioTrack: localAudioTrack as Ref<LocalAudioTrack | null>,
    localAudioPublication: localAudioPublication as Ref<LocalTrackPublication | null>,
    remoteParticipants: remoteParticipants as Ref<Map<string, RemoteParticipant>>,
    remoteAudioTracks: remoteAudioTracks as Ref<Map<string, RemoteAudioTrack>>,
    isScreenSharing: isScreenSharing as Ref<boolean>,
    screenShareQuality: screenShareQuality as Ref<ScreenShareQuality>,
    localScreenVideoTrack: localScreenVideoTrack as Ref<LocalVideoTrack | null>,
    localScreenAudioTrack: localScreenAudioTrack as Ref<LocalAudioTrack | null>,
    userScreenShareStates: userScreenShareStates as Ref<Map<string, ScreenShareState>>,
    remoteScreenTracks: remoteScreenTracks as Ref<
      Map<string, { video?: RemoteVideoTrack; audio?: RemoteAudioTrack }>
    >,
    screenShareVersion: screenShareVersion as Ref<number>,
    subscribedScreenShares: subscribedScreenShares as Ref<Set<string>>,
    localScreenVideoPublication: localScreenVideoPublication as Ref<LocalTrackPublication | null>,
    localScreenAudioPublication: localScreenAudioPublication as Ref<LocalTrackPublication | null>,
    isCameraEnabled: isCameraEnabled as Ref<boolean>,
    localCameraTrack: localCameraTrack as Ref<LocalVideoTrack | null>,
    userCameraStates: userCameraStates as Ref<Map<string, boolean>>,
    remoteCameraTracks: remoteCameraTracks as Ref<Map<string, RemoteVideoTrack>>,
    cameraVersion: cameraVersion as Ref<number>,
    localCameraPublication: localCameraPublication as Ref<LocalTrackPublication | null>,
    isStoppingCamera: isStoppingCamera as Ref<boolean>,
    isStartingCamera: isStartingCamera as Ref<boolean>,
    isStoppingScreenShare: isStoppingScreenShare as Ref<boolean>,
    isStartingScreenShare: isStartingScreenShare as Ref<boolean>,
    localStreamPromise: localStreamPromise as Ref<Promise<LocalAudioTrack | null> | null>,
    currentPing: currentPing as Ref<number>,
    participantStats: participantStats as Ref<Map<string, ConnectionStats>>,
    previousStats: previousStats as Ref<
      Map<string, Map<string, { bytesReceived: number; timestamp: number }>>
    >,
    remoteStreamVolumes: options.remoteStreamVolumes,
    onVolumeChange: options.onVolumeChange,
  }
}
