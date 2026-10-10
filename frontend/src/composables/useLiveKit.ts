import { onUnmounted } from "vue"
import type { User, ScreenShareQuality } from "@/types"
import { useCallStore } from "@/stores/call"
import { stopReconnectingLoop, playReconnected } from "@/services/sounds"
import { useLiveKitState } from "./useLiveKitState"
import { useLiveKitAudio } from "./useLiveKitAudio"
import { useLiveKitCamera } from "./useLiveKitCamera"
import { useLiveKitScreenShare } from "./useLiveKitScreenShare"
import { useLiveKitEvents } from "./useLiveKitEvents"
import { useLiveKitConnection } from "./useLiveKitConnection"
import { useLiveKitSupervisor } from "./useLiveKitSupervisor"

export interface UseLiveKitOptions {
  roomId: string
  roomName: string
  users: User[]
  remoteStreamVolumes: Map<string, number>
  onVolumeChange: (userId: string, volume: number) => void
}

export interface ScreenShareState {
  isSharing: boolean
  quality: ScreenShareQuality
}

export function useLiveKit(options: UseLiveKitOptions) {
  const state = useLiveKitState({
    remoteStreamVolumes: options.remoteStreamVolumes,
    onVolumeChange: options.onVolumeChange,
  })
  const callStore = useCallStore()
  const audio = useLiveKitAudio(state)
  const camera = useLiveKitCamera(state)
  const screenShare = useLiveKitScreenShare(state)
  const supervisor = useLiveKitSupervisor(state, { rejoin: () => rawJoin() })
  const events = useLiveKitEvents(state, {
    onRoomReconnected: () => audio.recoverLocalAudioAfterReconnect(),
    isManualLeave: () => connection.isManualLeave(),
    onReconnectStarted: () => supervisor.start(),
    onReconnectSettled: () => supervisor.reset(),
  })

  const connectionDeps = {
    setupRoomEventListeners: events.setupRoomEventListeners,
    publishAudioTrack: audio.publishAudioTrack,
  }
  const connection = useLiveKitConnection(state, connectionDeps)

  // Fresh join with a new Room + token. No supervisor reset here on purpose:
  // supervisor-forced rejoins go through this so the episode budget survives.
  async function rawJoin(): Promise<boolean> {
    await audio.initializeAudioTrack()
    return connection.initializeLiveKit(options.roomId)
  }

  const initializeLiveKit = async (): Promise<boolean> => {
    supervisor.reset()
    state.connectionFailed.value = false
    return rawJoin()
  }

  // Manual retry from the "connection lost" banner after the SDK gave up.
  const retryConnection = async (): Promise<boolean> => {
    state.connectionFailed.value = false
    const connected = await initializeLiveKit()
    if (connected) {
      stopReconnectingLoop()
      playReconnected()
      state.isReconnecting.value = false
      callStore.setReconnecting(false)
    }
    return connected
  }

  const cleanup = async () => {
    supervisor.reset()
    state.connectionFailed.value = false
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
    isReconnecting: state.isReconnecting,
    connectionError: state.connectionError,
    connectionFailed: state.connectionFailed,
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
    flipCamera: camera.flipCamera,
    applyMuteState: audio.applyMuteState,
    applyDeafenState: audio.applyDeafenState,
    reinitializeAudioStream: audio.reinitializeAudioStream,
    initializeLiveKit,
    retryConnection,
    cleanup,
    isRunningInElectron: screenShare.isRunningInElectron,
    screenShareAudioWarning: state.screenShareAudioWarning,
  }
}
