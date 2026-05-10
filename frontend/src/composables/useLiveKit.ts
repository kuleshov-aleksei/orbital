import { onUnmounted } from "vue"
import type { User, ScreenShareQuality } from "@/types"
import { useLiveKitState, type LiveKitState } from "./useLiveKitState"
import { useLiveKitAudio } from "./useLiveKitAudio"
import { useLiveKitCamera } from "./useLiveKitCamera"
import { useLiveKitScreenShare } from "./useLiveKitScreenShare"
import { useLiveKitEvents } from "./useLiveKitEvents"
import { useLiveKitConnection } from "./useLiveKitConnection"
import { useLiveKitStats } from "./useLiveKitStats"

export interface UseLiveKitOptions {
  roomId: string
  roomName: string
  users: User[]
  remoteStreamVolumes: Map<string, number>
  onVolumeChange: (userId: string, volume: number) => void
  onPingUpdate: (ping: number, quality: "sub-wave" | "excellent" | "good" | "fair" | "poor") => void
}

export interface ScreenShareState {
  isSharing: boolean
  quality: ScreenShareQuality
}

export function useLiveKit(options: UseLiveKitOptions) {
  const state: LiveKitState = useLiveKitState({
    remoteStreamVolumes: options.remoteStreamVolumes,
    onVolumeChange: options.onVolumeChange,
  })

  const audio = useLiveKitAudio(state)
  const camera = useLiveKitCamera(state)
  const screenShare = useLiveKitScreenShare(state)
  const events = useLiveKitEvents(state)

  const {
    startPingInterval,
    stopPingInterval,
    startStatsPolling,
    stopStatsPolling,
    getParticipantStats,
  } = useLiveKitStats(state, options.onPingUpdate)

  const connectionDeps = {
    setupRoomEventListeners: events.setupRoomEventListeners,
    publishAudioTrack: audio.publishAudioTrack,
  }
  const connection = useLiveKitConnection(state, connectionDeps)

  const initializeLiveKit = async (): Promise<boolean> => {
    await audio.initializeAudioTrack()
    const connected = await connection.initializeLiveKit(options.roomId)
    if (connected) {
      startPingInterval()
      startStatsPolling()
    }
    return connected
  }

  const cleanup = async () => {
    stopPingInterval()
    stopStatsPolling()

    if (state.isScreenSharing.value) {
      await screenShare.stopScreenShare()
    }

    connection.cleanup()
  }

  const localStream = audio.ensureLocalStream

  onUnmounted(async () => {
    await cleanup()
  })

  return {
    localStream,
    room: state.room,
    isConnected: state.isConnected,
    isConnecting: state.isConnecting,
    connectionError: state.connectionError,
    localParticipant: state.localParticipant,
    isScreenSharing: state.isScreenSharing,
    isCameraEnabled: state.isCameraEnabled,
    userScreenShareStates: state.userScreenShareStates,
    userCameraStates: state.userCameraStates,
    screenShareData: screenShare.screenShareData,
    availableScreenShares: screenShare.availableScreenShares,
    cameraData: camera.cameraData,
    remoteAudioTracks: state.remoteAudioTracks,
    remoteParticipants: state.remoteParticipants,
    remoteScreenTracks: state.remoteScreenTracks,
    remoteCameraTracks: state.remoteCameraTracks,
    screenShareVersion: state.screenShareVersion,
    subscribedScreenShares: screenShare.subscribedScreenShares,
    cameraVersion: state.cameraVersion,
    handleMuteToggle: audio.handleMuteToggle,
    startScreenShare: screenShare.startScreenShare,
    startElectronScreenShare: screenShare.startElectronScreenShare,
    stopScreenShare: screenShare.stopScreenShare,
    subscribeToScreenShare: screenShare.subscribeToScreenShare,
    unsubscribeFromScreenShare: screenShare.unsubscribeFromScreenShare,
    startCamera: camera.startCamera,
    stopCamera: camera.stopCamera,
    toggleCamera: camera.toggleCamera,
    getParticipantStats,
    applyMuteState: audio.applyMuteState,
    applyDeafenState: audio.applyDeafenState,
    reinitializeAudioStream: audio.reinitializeAudioStream,
    initializeLiveKit,
    cleanup,
    isRunningInElectron: screenShare.isRunningInElectron,
  }
}
