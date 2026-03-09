import { computed } from "vue"
import { createLocalVideoTrack, VideoPresets } from "livekit-client"
import type { LocalVideoTrack, RemoteVideoTrack } from "livekit-client"
import { debugLog } from "@/utils/debug"
import type { LiveKitState } from "./useLiveKitState"

export function useLiveKitCamera(state: LiveKitState) {
  const stopCamera = async (): Promise<void> => {
    if (!state.room.value || state.isStoppingCamera.value) {
      return
    }

    const trackToStop = state.localCameraTrack.value
    const publicationToUnpublish = state.localCameraPublication.value

    if (!trackToStop && !publicationToUnpublish) {
      return
    }

    state.isStoppingCamera.value = true

    try {
      debugLog(`[LiveKit][INFO]: 'Stopping camera...'`)

      if (trackToStop) {
        try {
          await state.room.value.localParticipant.unpublishTrack(trackToStop)
        } catch {
          if (publicationToUnpublish?.trackSid) {
            try {
              await state.room.value.localParticipant.unpublishTrack(
                publicationToUnpublish.trackSid,
              )
            } catch (sidError) {
              debugLog(
                `[LiveKit][WARN]: Failed to unpublish camera: ${(sidError as Error).message}`,
              )
            }
          }
        }
      } else if (publicationToUnpublish?.trackSid) {
        try {
          await state.room.value.localParticipant.unpublishTrack(publicationToUnpublish.trackSid)
        } catch (error) {
          debugLog(`[LiveKit][WARN]: Failed to unpublish camera: ${(error as Error).message}`)
        }
      }

      if (trackToStop) {
        const mediaStreamTrack = trackToStop.mediaStreamTrack
        if (mediaStreamTrack && mediaStreamTrack.readyState === "live") {
          mediaStreamTrack.stop()
        }
      }

      state.localCameraPublication.value = null
      state.localCameraTrack.value = null
      state.isCameraEnabled.value = false
      state.cameraVersion.value++
      state.userCameraStates.value.set(state.getCurrentUserId(), false)

      debugLog(`[LiveKit][INFO]: 'Camera stopped'`)
    } catch (error) {
      console.error("Error stopping camera:", error)
      console.error(`[LiveKit][ERROR]: Error stopping camera: ${(error as Error).message}`)
    } finally {
      state.isStoppingCamera.value = false
    }
  }

  const startCamera = async (): Promise<void> => {
    if (!state.room.value) {
      throw new Error("Not connected to room")
    }

    if (state.isStartingCamera.value) {
      return
    }

    if (state.localCameraTrack.value) {
      return
    }

    state.isStartingCamera.value = true

    try {
      const videoTrack = await createLocalVideoTrack({
        resolution: VideoPresets.h720,
      })

      const trackToPublish = videoTrack

      const publication = await state.room.value.localParticipant.publishTrack(trackToPublish)

      if (publication) {
        state.localCameraPublication.value = publication
        state.localCameraTrack.value = trackToPublish
        state.isCameraEnabled.value = true
        state.cameraVersion.value++
        state.userCameraStates.value.set(state.getCurrentUserId(), true)

        debugLog(`[LiveKit][INFO]: Local camera track published: ${publication.trackSid}`)

        trackToPublish.on("ended", () => {
          if (!state.isStoppingCamera.value) {
            debugLog(`[LiveKit][INFO]: 'Camera track ended (external)'`)
            void stopCamera()
          }
        })
      }

      debugLog(`[LiveKit][INFO]: 'Camera started successfully'`)
    } catch (error) {
      console.error("Failed to start camera:", error)
      console.error(`[LiveKit][ERROR]: Camera failed: ${(error as Error).message}`)
      throw error
    } finally {
      state.isStartingCamera.value = false
    }
  }

  const toggleCamera = async (): Promise<void> => {
    if (state.isCameraEnabled.value) {
      await stopCamera()
    } else {
      await startCamera()
    }
  }

  const cameraData = computed(() => {
    void state.cameraVersion.value
    const currentUserId = state.getCurrentUserId()

    const cameras: Array<{
      userId: string
      userNickname: string
      videoTrack: RemoteVideoTrack | LocalVideoTrack | null
      connectionState: string
      isSelfView?: boolean
    }> = []

    if (state.isCameraEnabled.value && state.localCameraTrack.value) {
      cameras.push({
        userId: currentUserId + "-self",
        userNickname: "Your Camera",
        videoTrack: state.localCameraTrack.value,
        connectionState: "self-view",
        isSelfView: true,
      })
    }

    state.userCameraStates.value.forEach((isEnabled, userId) => {
      if (isEnabled && userId !== currentUserId) {
        const participant = state.remoteParticipants.value.get(userId)
        const track = state.remoteCameraTracks.value.get(userId)

        cameras.push({
          userId,
          userNickname: participant?.name || userId,
          videoTrack: track || null,
          connectionState: "connected",
        })
      }
    })

    return cameras
  })

  return {
    startCamera,
    stopCamera,
    toggleCamera,
    cameraData,
  }
}
