import { ref, computed, onMounted, onUnmounted } from "vue"
import {
  Room,
  RoomEvent,
  type LocalTrackPublication,
  type RemoteAudioTrack,
  type RemoteVideoTrack,
  type RemoteParticipant,
  type LocalParticipant,
  createLocalAudioTrack,
  createLocalVideoTrack,
  LocalVideoTrack,
  LocalAudioTrack,
  Track,
  VideoPresets,
} from "livekit-client"
import { apiService } from "@/services/api"
import { usePresenceStore } from "@/stores/presence"
import { useAudioSettingsStore } from "@/stores/audioSettings"
import { useCallStore } from "@/stores/call"
import { getLiveKitAudioConstraints } from "@/services/livekit-audio-processors"
import { debugLog, debugWarn } from "@/utils/debug"
import type { User, ScreenShareQuality, ConnectionStats, TrackStats } from "@/types"

export interface UseLiveKitOptions {
  roomId: string
  roomName: string
  users: User[]
  remoteStreamVolumes: Map<string, number>
  onVolumeChange: (userId: string, volume: number) => void
  onPingUpdate: (ping: number, quality: "excellent" | "good" | "fair" | "poor") => void
}

export interface ScreenShareState {
  isSharing: boolean
  quality: ScreenShareQuality
}

export function useLiveKit(options: UseLiveKitOptions) {
  // Stores
  const presenceStore = usePresenceStore()
  const audioSettingsStore = useAudioSettingsStore()
  const callStore = useCallStore()

  // LiveKit Room instance
  const room = ref<Room | null>(null)
  const isConnected = ref(false)
  const isConnecting = ref(false)
  const connectionError = ref<string | null>(null)

  // Local participant
  const localParticipant = ref<LocalParticipant | null>(null)
  const localAudioTrack = ref<LocalAudioTrack | null>(null)
  const localAudioPublication = ref<LocalTrackPublication | null>(null)

  // Remote participants and tracks
  const remoteParticipants = ref<Map<string, RemoteParticipant>>(new Map())
  const remoteAudioTracks = ref<Map<string, RemoteAudioTrack>>(new Map())

  // Screen sharing state
  const isScreenSharing = ref(false)
  const screenShareQuality = ref<ScreenShareQuality>("1080p30")
  const localScreenVideoTrack = ref<LocalVideoTrack | null>(null)
  const localScreenAudioTrack = ref<LocalAudioTrack | null>(null)
  const userScreenShareStates = ref<Map<string, ScreenShareState>>(new Map())
  const remoteScreenTracks = ref<
    Map<string, { video?: RemoteVideoTrack; audio?: RemoteAudioTrack }>
  >(new Map())
  const screenShareVersion = ref(0)
  // Track publication references for cleanup
  const localScreenVideoPublication = ref<LocalTrackPublication | null>(null)
  const localScreenAudioPublication = ref<LocalTrackPublication | null>(null)

  // Camera state
  const isCameraEnabled = ref(false)
  const localCameraTrack = ref<LocalVideoTrack | null>(null)
  const userCameraStates = ref<Map<string, boolean>>(new Map())
  const remoteCameraTracks = ref<Map<string, RemoteVideoTrack>>(new Map())
  const cameraVersion = ref(0)
  // Track publication reference for cleanup
  const localCameraPublication = ref<LocalTrackPublication | null>(null)
  // Guard to prevent track "ended" event from triggering during manual stop
  const isStoppingCamera = ref(false)
  // Guard to prevent multiple concurrent camera starts
  let isStartingCamera = false
  // Guard to prevent track "ended" event from triggering during manual stop for screen share
  const isStoppingScreenShare = ref(false)
  // Guard to prevent multiple concurrent screen share starts
  let isStartingScreenShare = false

  // Audio processing
  let localStreamPromise: Promise<LocalAudioTrack | null> | null = null

  // Ping tracking
  const currentPing = ref<number>(0)
  let pingInterval: ReturnType<typeof setInterval> | null = null
  const PING_INTERVAL = 3000

  // Stats tracking
  const participantStats = ref<Map<string, ConnectionStats>>(new Map())
  let statsInterval: ReturnType<typeof setInterval> | null = null
  const STATS_INTERVAL = 2000 // Update every 2 seconds
  const previousStats = ref<Map<string, Map<string, { bytesReceived: number; timestamp: number }>>>(
    new Map(),
  )

  // Get current user ID
  const getCurrentUserId = (): string => {
    let userId = localStorage.getItem("orbital_user_id")
    if (!userId) {
      userId = "user_" + Math.random().toString(36).substr(2, 12)
      localStorage.setItem("orbital_user_id", userId)
    }
    return userId
  }

  // Calculate bitrate from byte deltas
  const calculateBitrate = (
    userId: string,
    trackId: string,
    currentBytes: number,
    currentTime: number,
  ): number => {
    const userPreviousStats = previousStats.value.get(userId)
    if (!userPreviousStats) {
      // First measurement, store and return 0
      previousStats.value.set(
        userId,
        new Map([[trackId, { bytesReceived: currentBytes, timestamp: currentTime }]]),
      )
      return 0
    }

    const trackPreviousStats = userPreviousStats.get(trackId)
    if (!trackPreviousStats) {
      // First measurement for this track
      userPreviousStats.set(trackId, {
        bytesReceived: currentBytes,
        timestamp: currentTime,
      })
      return 0
    }

    const deltaBytes = currentBytes - trackPreviousStats.bytesReceived
    const deltaTimeMs = currentTime - trackPreviousStats.timestamp

    // Update stored stats
    userPreviousStats.set(trackId, {
      bytesReceived: currentBytes,
      timestamp: currentTime,
    })

    if (deltaTimeMs <= 0 || deltaBytes < 0) {
      return 0
    }

    // Convert to bits per second: bytes * 8 * 1000 / ms
    return (deltaBytes * 8 * 1000) / deltaTimeMs
  }

  // Extract video-specific stats from RTCInboundRtpStreamStats
  const extractVideoStats = (
    stat: RTCInboundRtpStreamStats,
    trackStats: TrackStats,
  ): TrackStats => {
    const videoStats = { ...trackStats }

    // Resolution
    if (stat.frameWidth && stat.frameHeight) {
      videoStats.frameWidth = stat.frameWidth
      videoStats.frameHeight = stat.frameHeight
      videoStats.resolution = `${stat.frameWidth}x${stat.frameHeight}`
    }

    // Frame rate
    if (stat.framesPerSecond) {
      videoStats.fps = stat.framesPerSecond
    }

    // Frame counts
    if (stat.framesDecoded !== undefined) {
      videoStats.framesDecoded = stat.framesDecoded
    }
    if (stat.framesDropped !== undefined) {
      videoStats.framesDropped = stat.framesDropped
    }
    if (stat.framesReceived !== undefined) {
      videoStats.framesReceived = stat.framesReceived
    }

    // Codec info (from codecId reference)
    if (stat.codecId) {
      videoStats.codec = stat.codecId
    }

    // Recovery mechanism counts
    if (stat.pliCount !== undefined) {
      videoStats.pliCount = stat.pliCount
    }
    if (stat.firCount !== undefined) {
      videoStats.firCount = stat.firCount
    }
    if (stat.nackCount !== undefined) {
      videoStats.nackCount = stat.nackCount
    }

    // Quality limitation
    if (stat.qualityLimitationReason) {
      videoStats.qualityLimitationReason = stat.qualityLimitationReason
    }

    // Decoder info
    if (stat.decoderImplementation) {
      videoStats.decoderImplementation = stat.decoderImplementation
    }

    return videoStats
  }

  // Update stats for all participants
  const updateStats = async () => {
    const stats = new Map<string, ConnectionStats>()
    const currentUserId = getCurrentUserId()
    const currentTime = Date.now()

    // Get local stats
    if (localAudioPublication.value?.track) {
      try {
        const trackStats = await localAudioPublication.value.track.getRTCStatsReport()
        if (trackStats) {
          const senderStats = Array.from(trackStats.values()).find(
            (s: { type: string }) => s.type === "outbound-rtp",
          ) as RTCOutboundRtpStreamStats

          if (senderStats && senderStats.kind === "audio") {
            const bitrate = calculateBitrate(
              currentUserId,
              "local-audio",
              senderStats.bytesSent || 0,
              currentTime,
            )

            const existing = stats.get(currentUserId) || {
              ping: currentPing.value || 0,
            }
            stats.set(currentUserId, {
              ...existing,
              audio: {
                jitter: 0,
                packetLoss: 0,
                bitrate,
                bytesReceived: senderStats.bytesSent || 0,
                timestamp: currentTime,
              },
              timestamp: new Date(),
            })
          }
        }
      } catch (error) {
        console.warn("Error getting local stats:", error)
      }
    }

    // Get remote stats for all tracks (not just audio)
    for (const [userId, track] of remoteAudioTracks.value) {
      try {
        const trackStats = await track.getRTCStatsReport()
        if (trackStats) {
          // Find all inbound-rtp stats (could be audio or video)
          const receiverStats = Array.from(trackStats.values()).filter(
            (s: { type: string }) => s.type === "inbound-rtp",
          ) as RTCInboundRtpStreamStats[]

          for (const stat of receiverStats) {
            const kind = stat.kind as "audio" | "video"
            const bitrate = calculateBitrate(
              userId,
              `${kind}-${stat.ssrc || track.sid}`,
              stat.bytesReceived || 0,
              currentTime,
            )

            const existing = stats.get(userId) || { ping: 0 }
            const trackStatsData: TrackStats = {
              jitter: (stat.jitter || 0) * 1000,
              packetLoss: stat.packetsLost
                ? (stat.packetsLost / (stat.packetsReceived || 1)) * 100
                : 0,
              bitrate,
              bytesReceived: stat.bytesReceived || 0,
              timestamp: currentTime,
            }

            if (kind === "audio") {
              stats.set(userId, {
                ...existing,
                audio: trackStatsData,
                timestamp: new Date(),
              })
            } else if (kind === "video") {
              // Don't store regular video tracks in the video field anymore
              // We'll handle them separately or leave this for camera video
              stats.set(userId, {
                ...existing,
                video: trackStatsData,
                timestamp: new Date(),
              })
            }
          }
        }
      } catch (error) {
        console.warn(`Error getting stats for ${userId}:`, error)
      }
    }

    // Get screen share stats from remoteScreenTracks
    for (const [userId, tracks] of remoteScreenTracks.value) {
      if (tracks.video) {
        try {
          const trackStats = await tracks.video.getRTCStatsReport()
          if (trackStats) {
            const receiverStats = Array.from(trackStats.values()).filter(
              (s: { type: string }) => s.type === "inbound-rtp",
            ) as RTCInboundRtpStreamStats[]

            for (const stat of receiverStats) {
              if (stat.kind === "video") {
                const bitrate = calculateBitrate(
                  userId,
                  `screenshare-${stat.ssrc || tracks.video!.sid}`,
                  stat.bytesReceived || 0,
                  currentTime,
                )

                const existing = stats.get(userId) || { ping: 0 }
                const trackStatsData: TrackStats = {
                  jitter: (stat.jitter || 0) * 1000,
                  packetLoss: stat.packetsLost
                    ? (stat.packetsLost / (stat.packetsReceived || 1)) * 100
                    : 0,
                  bitrate,
                  bytesReceived: stat.bytesReceived || 0,
                  timestamp: currentTime,
                }

                // Extract video-specific stats
                const videoStats = extractVideoStats(stat, trackStatsData)

                // Resolve codec name from codecId if present
                if (stat.codecId) {
                  const codecStats = Array.from(trackStats.values()).find(
                    (s: { type: string; id?: string }) =>
                      s.type === "codec" && s.id === stat.codecId,
                  ) as { mimeType?: string } | undefined

                  if (codecStats?.mimeType) {
                    // Extract codec from mimeType like "video/VP8" -> "VP8"
                    const codecMatch = codecStats.mimeType.match(/\/(\w+)$/)
                    if (codecMatch) {
                      videoStats.codec = codecMatch[1]
                    }
                  }
                }

                stats.set(userId, {
                  ...existing,
                  screenShare: videoStats,
                  timestamp: new Date(),
                })
              }
            }
          }
        } catch (error) {
          console.warn(`Error getting screen share stats for ${userId}:`, error)
        }
      }
    }

    participantStats.value = stats
  }

  // Start stats polling
  const startStatsPolling = () => {
    if (statsInterval) clearInterval(statsInterval)
    void updateStats() // Initial update
    statsInterval = setInterval(() => {
      void updateStats()
    }, STATS_INTERVAL)
  }

  // Stop stats polling
  const stopStatsPolling = () => {
    if (statsInterval) {
      clearInterval(statsInterval)
      statsInterval = null
    }
    previousStats.value.clear()
  }

  // Get stats for a specific participant
  const getParticipantStats = (userId: string): ConnectionStats => {
    return (
      participantStats.value.get(userId) || {
        ping: 0,
      }
    )
  }

  // Ensure local media stream is available
  const ensureLocalStream = async (): Promise<MediaStream | null> => {
    if (!localAudioTrack.value) {
      await initializeAudioTrack()
    }

    if (localAudioTrack.value) {
      return new MediaStream([localAudioTrack.value.mediaStreamTrack])
    }
    return null
  }

  // Initialize audio track with selected processor
  const initializeAudioTrack = async (): Promise<LocalAudioTrack | null> => {
    // Check if existing track is still valid (not ended)
    if (localAudioTrack.value) {
      const mediaStreamTrack = localAudioTrack.value.mediaStreamTrack
      if (mediaStreamTrack && mediaStreamTrack.readyState === "live") {
        return localAudioTrack.value
      }
      // Track has ended, clean it up and reset promise
      debugLog(`[LiveKit][INFO]: Existing audio track ended, creating new track`)
      localAudioTrack.value.stop()
      localAudioTrack.value = null
      localStreamPromise = null // Reset promise so we create a new track
    }

    if (!localStreamPromise) {
      localStreamPromise = (async () => {
        try {
          // Load audio settings
          if (!audioSettingsStore.isLoaded) {
            audioSettingsStore.loadSettings()
          }

          const algorithm = audioSettingsStore.noiseSuppressionAlgorithm
          const deviceId = audioSettingsStore.inputDeviceId

          debugLog(`[LiveKit][INFO]: Initializing audio track with algorithm: ${algorithm}, device: ${deviceId || "default"}`)

          // Get audio constraints based on algorithm and device
          const audioConstraints = getLiveKitAudioConstraints(algorithm, deviceId)

          // Create LiveKit audio track
          const track = await createLocalAudioTrack({
            audio: audioConstraints,
          })

          localAudioTrack.value = track
          debugLog(`[LiveKit][INFO]: 'Audio track initialized successfully'}`)
          return track
        } catch (error) {
          console.error("Failed to initialize audio track:", error)
          console.error(`[LiveKit][ERROR]: Failed to initialize audio: ${(error as Error).message}`)
          return null
        }
      })()
    }

    return await localStreamPromise
  }

  // Connect to LiveKit room
  const connectToRoom = async (token: string, url: string): Promise<boolean> => {
    try {
      isConnecting.value = true
      connectionError.value = null

      debugLog(`[LiveKit][INFO]: Connecting to LiveKit room at ${url}`)

      // Create room with optimized options
      const lkRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: {
          simulcast: true,
        },
      })

      // Set up event listeners before connecting
      setupRoomEventListeners(lkRoom)

      // Connect to room
      await lkRoom.connect(url, token)

      room.value = lkRoom
      localParticipant.value = lkRoom.localParticipant
      isConnected.value = true
      isConnecting.value = false

      debugLog(`[LiveKit][INFO]: 'Connected to LiveKit room successfully'}`)

      // Initialize presence tracking
      await presenceStore.initializePresence(lkRoom)

      // Publish audio track
      await publishAudioTrack()

      // Set initial mute state
      if (callStore.isMuted) {
        await lkRoom.localParticipant.setMicrophoneEnabled(false)
      }

      return true
    } catch (error) {
      console.error("Failed to connect to LiveKit room:", error)
      connectionError.value = (error as Error).message
      console.error(`[LiveKit][ERROR]: Connection failed: ${(error as Error).message}`)
      isConnecting.value = false
      return false
    }
  }

  // Setup LiveKit room event listeners
  const setupRoomEventListeners = (lkRoom: Room) => {
    // Remote participant events
    lkRoom.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      debugLog(`[LiveKit][INFO]: Participant connected: ${participant.identity}`)
      remoteParticipants.value.set(participant.identity, participant)

      // Subscribe to participant's tracks
      participant.trackPublications.forEach((publication) => {
        if (publication.track) {
          handleRemoteTrack(publication.track, participant)
        }
      })
    })

    lkRoom.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      debugLog(`[LiveKit][INFO]: Participant disconnected: ${participant.identity}`)
      remoteParticipants.value.delete(participant.identity)
      remoteAudioTracks.value.delete(participant.identity)
      remoteScreenTracks.value.delete(participant.identity)
      userScreenShareStates.value.delete(participant.identity)
      screenShareVersion.value++
    })

    // Track events
    lkRoom.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      debugLog(`[LiveKit][INFO]: Track subscribed: ${track.kind} from ${participant.identity}`)
      handleRemoteTrack(track, participant)
    })

    lkRoom.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      debugLog(`[LiveKit][INFO]: Track unsubscribed: ${track.kind} from ${participant.identity}`)
      handleTrackUnsubscribed(track, participant)
    })

    lkRoom.on(RoomEvent.TrackMuted, (publication, participant) => {
      debugLog(`[LiveKit][INFO]: Track muted: ${publication.trackSid} from ${participant.identity}`)
    })

    lkRoom.on(RoomEvent.TrackUnmuted, (publication, participant) => {
      debugLog(
        `[LiveKit][INFO]: Track unmuted: ${publication.trackSid} from ${participant.identity}`,
      )
    })

    // Local track events for screen sharing
    lkRoom.on(RoomEvent.LocalTrackPublished, (publication) => {
      const track = publication.track
      if (!track) return

      if (track.source === Track.Source.ScreenShare) {
        debugLog(`[LiveKit][INFO]: Local screen share track published: ${publication.trackSid}`)
        localScreenVideoPublication.value = publication
        localScreenVideoTrack.value = track as LocalVideoTrack
        isScreenSharing.value = true
        screenShareVersion.value++

        // Update local state for self-view
        userScreenShareStates.value.set(getCurrentUserId(), {
          isSharing: true,
          quality: screenShareQuality.value,
        })

        // Listen for browser-native stop sharing (via the "Stop sharing" button)
        track.on("ended", () => {
          // Only handle if not already being stopped manually
          if (!isStoppingScreenShare.value) {
            debugLog(`[LiveKit][INFO]: 'Screen share track ended (browser UI)'`)
            void stopScreenShare()
          }
        })
      } else if (track.source === Track.Source.ScreenShareAudio) {
        debugLog(
          `[LiveKit][INFO]: Local screen share audio track published: ${publication.trackSid}`,
        )
        localScreenAudioPublication.value = publication
        localScreenAudioTrack.value = track as LocalAudioTrack
      } else if (track.source === Track.Source.Camera) {
        debugLog(`[LiveKit][INFO]: Local camera track published: ${publication.trackSid}`)
        localCameraPublication.value = publication
        localCameraTrack.value = track as LocalVideoTrack
        isCameraEnabled.value = true
        cameraVersion.value++

        // Update local state
        userCameraStates.value.set(getCurrentUserId(), true)

        // Listen for track ended event (e.g., user revoked camera permission in browser)
        track.on("ended", () => {
          // Only handle if not already being stopped manually
          if (!isStoppingCamera.value) {
            debugLog(`[LiveKit][INFO]: 'Camera track ended (external)'`)
            void stopCamera()
          }
        })
      }
    })

    lkRoom.on(RoomEvent.LocalTrackUnpublished, (publication) => {
      if (publication.source === Track.Source.ScreenShare) {
        debugLog(`[LiveKit][INFO]: Local screen share track unpublished: ${publication.trackSid}`)
        localScreenVideoPublication.value = null
        localScreenVideoTrack.value = null
        isScreenSharing.value = false
        screenShareQuality.value = "1080p30"
        screenShareVersion.value++

        // Update local state
        userScreenShareStates.value.set(getCurrentUserId(), {
          isSharing: false,
          quality: "1080p30",
        })

        // Reset guard flag in case track was unpublished externally
        isStoppingScreenShare.value = false
      } else if (publication.source === Track.Source.ScreenShareAudio) {
        debugLog(
          `[LiveKit][INFO]: Local screen share audio track unpublished: ${publication.trackSid}`,
        )
        localScreenAudioPublication.value = null
        localScreenAudioTrack.value = null
      } else if (publication.source === Track.Source.Camera) {
        debugLog(`[LiveKit][INFO]: Local camera track unpublished: ${publication.trackSid}`)
        localCameraPublication.value = null
        localCameraTrack.value = null
        isCameraEnabled.value = false
        cameraVersion.value++

        // Update local state
        userCameraStates.value.set(getCurrentUserId(), false)

        // Reset guard flag in case track was unpublished externally
        isStoppingCamera.value = false
      }
    })

    // Connection state events
    lkRoom.on(RoomEvent.Disconnected, (reason) => {
      debugWarn(`[LiveKit][WARN]: Disconnected from room: ${reason || "unknown reason"}`)
      isConnected.value = false
      // Note: Don't call cleanup() here - it can cause race conditions
      // when switching rooms. Cleanup should only be called from onUnmounted
      // or when explicitly disconnecting. Just stop the intervals here.
      stopPingInterval()
      stopStatsPolling()
    })

    lkRoom.on(RoomEvent.Reconnecting, () => {
      debugWarn(`[LiveKit][WARN]: 'Reconnecting to room...'`)
    })

    lkRoom.on(RoomEvent.Reconnected, () => {
      debugLog(`[LiveKit][INFO]: 'Reconnected to room'`)
    })
  }

  // Handle remote track subscription
  const handleRemoteTrack = (
    track: RemoteAudioTrack | RemoteVideoTrack,
    participant: RemoteParticipant,
  ) => {
    const participantId = participant.identity

    if (track.kind === Track.Kind.Audio) {
      const audioTrack = track
      remoteAudioTracks.value.set(participantId, audioTrack)

      // Set initial volume if specified
      const volume = options.remoteStreamVolumes.get(participantId) ?? 80
      audioTrack.setVolume(volume / 100)

      debugLog(`[LiveKit][INFO]: Audio track received from ${participantId}`)
    } else if (track.kind === Track.Kind.Video) {
      // Check if it's a screen share (source === 'screen_share')
      const videoTrack = track
      if (videoTrack.source === Track.Source.ScreenShare) {
        const currentTracks = remoteScreenTracks.value.get(participantId) || {}
        remoteScreenTracks.value.set(participantId, {
          ...currentTracks,
          video: videoTrack,
        })

        userScreenShareStates.value.set(participantId, {
          isSharing: true,
          quality: "1080p30", // Default, will be updated from attributes if available
        })
        screenShareVersion.value++

        debugLog(`[LiveKit][INFO]: Screen share track received from ${participantId}`)
      } else if (videoTrack.source === Track.Source.Camera) {
        // Handle camera video track
        remoteCameraTracks.value.set(participantId, videoTrack)
        userCameraStates.value.set(participantId, true)
        cameraVersion.value++

        debugLog(`[LiveKit][INFO]: Camera track received from ${participantId}`)
      }
    }
  }

  // Handle track unsubscription
  const handleTrackUnsubscribed = (
    track: RemoteAudioTrack | RemoteVideoTrack,
    participant: RemoteParticipant,
  ) => {
    const participantId = participant.identity

    if (track.kind === Track.Kind.Audio) {
      remoteAudioTracks.value.delete(participantId)
    } else if (track.kind === Track.Kind.Video) {
      const videoTrack = track
      if (videoTrack.source === Track.Source.ScreenShare) {
        const currentTracks = remoteScreenTracks.value.get(participantId)
        if (currentTracks) {
          delete currentTracks.video
          if (!currentTracks.audio) {
            remoteScreenTracks.value.delete(participantId)
          }
        }

        userScreenShareStates.value.set(participantId, {
          isSharing: false,
          quality: "1080p30",
        })
        screenShareVersion.value++
      } else if (videoTrack.source === Track.Source.Camera) {
        // Handle camera track unsubscription
        remoteCameraTracks.value.delete(participantId)
        userCameraStates.value.set(participantId, false)
        cameraVersion.value++
      }
    }
  }

  // Publish local audio track
  const publishAudioTrack = async (): Promise<void> => {
    if (!room.value || !localAudioTrack.value) {
      debugWarn(`[LiveKit][WARN]: 'Cannot publish audio: room or track not ready'`)
      return
    }

    try {
      debugLog(`[LiveKit][INFO]: 'Publishing audio track...'`)
      const publication = await room.value.localParticipant.publishTrack(localAudioTrack.value)
      localAudioPublication.value = publication
      debugLog(`[LiveKit][INFO]: 'Audio track published successfully'`)
    } catch (error) {
      console.error("Failed to publish audio track:", error)
      console.error(`[LiveKit][ERROR]: Failed to publish audio: ${(error as Error).message}`)
    }
  }

  // Unpublish local audio track
  const unpublishAudioTrack = async (): Promise<void> => {
    if (!room.value || !localAudioPublication.value) {
      return
    }

    try {
      await room.value.localParticipant.unpublishTrack(localAudioPublication.value.trackSid)
      localAudioPublication.value = null
      debugLog(`[LiveKit][INFO]: 'Audio track unpublished'`)
    } catch (error) {
      console.error("Failed to unpublish audio track:", error)
    }
  }

  // Initialize LiveKit connection (fetch token and connect)
  const initializeLiveKit = async (): Promise<boolean> => {
    try {
      debugLog(`[LiveKit][INFO]: 'Initializing LiveKit...'`)

      // Fetch token from backend
      const response = await apiService.getLiveKitToken(options.roomId)
      debugLog(`[LiveKit][INFO]: Token received, connecting to ${response.room_url}`)

      // Initialize audio track first
      await initializeAudioTrack()

      // Connect to room
      const connected = await connectToRoom(response.token, response.room_url)

      if (connected) {
        // Start ping interval
        startPingInterval()
        // Start stats polling
        startStatsPolling()
      }

      return connected
    } catch (error) {
      console.error("Failed to initialize LiveKit:", error)
      console.error(`[LiveKit][ERROR]: Initialization failed: ${(error as Error).message}`)
      return false
    }
  }

  // Apply mute state
  const applyMuteState = async (muted: boolean): Promise<void> => {
    // Check if room is properly connected and ready
    if (!room.value || !isConnected.value) {
      debugLog(`[LiveKit][INFO]: Cannot apply mute state - room not ready`)
      return
    }

    // Check if we have an audio track published
    if (!localAudioPublication.value) {
      debugLog(`[LiveKit][INFO]: Cannot apply mute state - no audio track published yet`)
      return
    }

    try {
      await room.value.localParticipant.setMicrophoneEnabled(!muted)
      debugLog(`[LiveKit][INFO]: Microphone ${muted ? "muted" : "unmuted"}`)
    } catch (error) {
      console.error("Failed to apply mute state:", error)
    }
  }

  // Apply deafen state
  const applyDeafenState = (deafened: boolean): void => {
    // In LiveKit, deafening is handled by muting all remote audio elements
    remoteAudioTracks.value.forEach((track) => {
      track.setMuted(deafened)
    })
    debugLog(`[LiveKit][INFO]: Deafen ${deafened ? "enabled" : "disabled"}`)
  }

  // Handle remote user mute toggle (from UI)
  const handleMuteToggle = (userId: string, isMuted: boolean): void => {
    const track = remoteAudioTracks.value.get(userId)
    if (track) {
      track.setMuted(isMuted)
    }
  }

  // Start screen sharing using LiveKit's setScreenShareEnabled API
  const startScreenShare = async (quality: ScreenShareQuality, audio: boolean): Promise<void> => {
    if (!room.value) {
      throw new Error("Not connected to room")
    }

    // Prevent multiple concurrent screen share starts
    if (isStartingScreenShare) {
      debugLog(`[LiveKit][INFO]: Screen share already starting, ignoring duplicate request`)
      return
    }

    isStartingScreenShare = true

    try {
      debugLog(`[LiveKit][INFO]: Starting screen share: ${quality}${audio ? " with audio" : ""}`)

      // Use LiveKit's recommended API instead of manual getDisplayMedia
      // This properly handles track management without interfering with existing audio
      await room.value.localParticipant.setScreenShareEnabled(true, {
        audio: audio,
        resolution: getScreenShareVideoConstraints(quality),
      })

      // The actual track handling is done in the LocalTrackPublished event listener
      // We update state optimistically, but the real state is managed by events
      screenShareQuality.value = quality

      debugLog(`[LiveKit][INFO]: 'Screen sharing started successfully'`)
    } catch (error) {
      console.error("Failed to start screen share:", error)
      console.error(`[LiveKit][ERROR]: Screen share failed: ${(error as Error).message}`)
      throw error
    } finally {
      isStartingScreenShare = false
    }
  }

  // Stop screen sharing using LiveKit's setScreenShareEnabled API
  const stopScreenShare = async (): Promise<void> => {
    if (!room.value || isStoppingScreenShare.value) {
      return
    }

    // Store track references locally before any async operations
    const videoTrackToStop = localScreenVideoTrack.value
    const audioTrackToStop = localScreenAudioTrack.value
    const videoPublicationToUnpublish = localScreenVideoPublication.value

    // Early exit if already being stopped (no tracks or publication)
    // Check actual track/publication existence instead of reactive state
    // because state may already be false when called from watcher
    if (!videoTrackToStop && !videoPublicationToUnpublish) {
      return
    }

    // Set guard flag to prevent track "ended" event from triggering this function
    isStoppingScreenShare.value = true

    try {
      debugLog(`[LiveKit][INFO]: 'Stopping screen share...'`)

      // Use LiveKit API to unpublish FIRST
      // This ensures the server is notified before we stop the tracks
      await room.value.localParticipant.setScreenShareEnabled(false)

      // CRITICAL: After unpublishing, stop the underlying MediaStreamTracks
      // This ensures the browser UI "Stop sharing" indicator is cleared
      // and system resources are released
      if (videoTrackToStop) {
        const mediaStreamTrack = videoTrackToStop.mediaStreamTrack
        if (mediaStreamTrack && mediaStreamTrack.readyState === "live") {
          mediaStreamTrack.stop()
          debugLog(`[LiveKit][INFO]: Stopped screen share video MediaStreamTrack`)
        }
      }

      if (audioTrackToStop) {
        const mediaStreamTrack = audioTrackToStop.mediaStreamTrack
        if (mediaStreamTrack && mediaStreamTrack.readyState === "live") {
          mediaStreamTrack.stop()
          debugLog(`[LiveKit][INFO]: Stopped screen share audio MediaStreamTrack`)
        }
      }

      // Reset state (event handler may have already done this, but ensure it's done)
      localScreenVideoPublication.value = null
      localScreenAudioPublication.value = null
      localScreenVideoTrack.value = null
      localScreenAudioTrack.value = null
      isScreenSharing.value = false
      screenShareVersion.value++

      // Update local state
      userScreenShareStates.value.set(getCurrentUserId(), {
        isSharing: false,
        quality: "1080p30",
      })

      debugLog(`[LiveKit][INFO]: 'Screen sharing stopped'`)
    } catch (error) {
      console.error("Error stopping screen share:", error)
      console.error(`[LiveKit][ERROR]: Error stopping screen share: ${(error as Error).message}`)
    } finally {
      // Always reset the guard flag
      isStoppingScreenShare.value = false
    }
  }

  // Start camera using createLocalVideoTrack API
  const startCamera = async (): Promise<void> => {
    if (!room.value) {
      throw new Error("Not connected to room")
    }

    // Prevent multiple concurrent camera starts
    if (isStartingCamera) {
      return
    }

    // Check if camera is already enabled
    if (localCameraTrack.value) {
      return
    }

    isStartingCamera = true

    try {
      // Create camera track directly - use plain object to avoid proxy issues
      const videoTrack = await createLocalVideoTrack({
        resolution: VideoPresets.h720,
      })

      // Store track reference in non-reactive variable to avoid proxy issues
      const trackToPublish = videoTrack

      // Publish the track
      const publication = await room.value.localParticipant.publishTrack(trackToPublish)

      // Store references immediately
      if (publication) {
        localCameraPublication.value = publication
        localCameraTrack.value = trackToPublish
        isCameraEnabled.value = true
        cameraVersion.value++
        userCameraStates.value.set(getCurrentUserId(), true)

        debugLog(`[LiveKit][INFO]: Local camera track published: ${publication.trackSid}`)

        // Listen for track ended event
        trackToPublish.on("ended", () => {
          if (!isStoppingCamera.value) {
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
      isStartingCamera = false
    }
  }

  // Stop camera by unpublishing and stopping the track
  const stopCamera = async (): Promise<void> => {
    if (!room.value || isStoppingCamera.value) {
      return
    }

    // Store references in non-reactive variables before any operations
    const trackToStop = localCameraTrack.value
    const publicationToUnpublish = localCameraPublication.value

    if (!trackToStop && !publicationToUnpublish) {
      return
    }

    // Set guard flag to prevent track "ended" event from triggering this function
    isStoppingCamera.value = true

    try {
      debugLog(`[LiveKit][INFO]: 'Stopping camera...'`)

      // Try to unpublish using track object first (more reliable)
      if (trackToStop) {
        try {
          await room.value.localParticipant.unpublishTrack(trackToStop)
        } catch {
          // Fallback: try unpublishing by sid
          if (publicationToUnpublish?.trackSid) {
            try {
              await room.value.localParticipant.unpublishTrack(publicationToUnpublish.trackSid)
            } catch (sidError) {
              debugLog(`[LiveKit][WARN]: Failed to unpublish camera: ${(sidError as Error).message}`)
            }
          }
        }
      } else if (publicationToUnpublish?.trackSid) {
        // No track object, try by sid
        try {
          await room.value.localParticipant.unpublishTrack(publicationToUnpublish.trackSid)
        } catch (error) {
          debugLog(`[LiveKit][WARN]: Failed to unpublish camera: ${(error as Error).message}`)
        }
      }

      // Stop the underlying MediaStreamTrack to turn off the privacy light
      if (trackToStop) {
        const mediaStreamTrack = trackToStop.mediaStreamTrack
        if (mediaStreamTrack && mediaStreamTrack.readyState === "live") {
          mediaStreamTrack.stop()
        }
      }

      // Reset state
      localCameraPublication.value = null
      localCameraTrack.value = null
      isCameraEnabled.value = false
      cameraVersion.value++
      userCameraStates.value.set(getCurrentUserId(), false)

      debugLog(`[LiveKit][INFO]: 'Camera stopped'`)
    } catch (error) {
      console.error("Error stopping camera:", error)
      console.error(`[LiveKit][ERROR]: Error stopping camera: ${(error as Error).message}`)
    } finally {
      // Always reset the guard flag
      isStoppingCamera.value = false
    }
  }

  // Toggle camera on/off
  const toggleCamera = async (): Promise<void> => {
    if (isCameraEnabled.value) {
      await stopCamera()
    } else {
      await startCamera()
    }
  }

  // Get screen share video constraints
  // Returns VideoPreset string for LiveKit's setScreenShareEnabled API
  const getScreenShareVideoConstraints = (quality: ScreenShareQuality): string => {
    // Map quality to LiveKit VideoPreset names
    // These are standard LiveKit presets: https://docs.livekit.io/client-sdk-js/enums/VideoPreset.html
    const presetMap: Record<ScreenShareQuality, string> = {
      source: "screen_share", // Use LiveKit's default screen share preset
      "1080p60": "screenShareH1080FPS60",
      "1080p30": "screenShareH1080FPS30",
      "720p30": "screenShareH720FPS30",
      "360p30": "screenShareH360FPS30",
      text: "screenShareH1080FPS5",
    }

    return presetMap[quality] || "screenShareH1080FPS30"
  }

  // Reinitialize audio stream (when algorithm changes)
  const reinitializeAudioStream = async (): Promise<void> => {
    debugLog(`[LiveKit][INFO]: 'Reinitializing audio stream...'`)

    // Unpublish current track
    await unpublishAudioTrack()

    // Stop and clear current track
    if (localAudioTrack.value) {
      localAudioTrack.value.stop()
      localAudioTrack.value = null
    }

    // Reset promise so we create a new track
    localStreamPromise = null

    // Create and publish new track
    await initializeAudioTrack()
    await publishAudioTrack()

    debugLog(`[LiveKit][INFO]: 'Audio stream reinitialized'`)
  }

  // Start ping interval
  const startPingInterval = () => {
    if (pingInterval) {
      clearInterval(pingInterval)
    }

    pingInterval = setInterval(() => {
      currentPing.value = room.value?.localParticipant.engine.client.rtt ?? 0

      let quality: "excellent" | "good" | "fair" | "poor" = "excellent"
      if (currentPing.value < 30) {
        quality = "excellent"
      } else if (currentPing.value < 60) {
        quality = "good"
      } else if (currentPing.value < 100) {
        quality = "fair"
      } else {
        quality = "poor"
      }

      options.onPingUpdate(currentPing.value, quality)
    }, PING_INTERVAL)
  }

  // Stop ping interval
  const stopPingInterval = () => {
    if (pingInterval) {
      clearInterval(pingInterval)
      pingInterval = null
    }
  }

  // Computed screen share data for display
  const screenShareData = computed(() => {
    void screenShareVersion.value // Trigger reactivity
    const currentUserId = getCurrentUserId()

    const shares: Array<{
      userId: string
      userNickname: string
      videoTrack: RemoteVideoTrack | LocalVideoTrack | null
      audioTrack: RemoteAudioTrack | LocalAudioTrack | null
      quality: ScreenShareQuality
      connectionState: string
      isSelfView?: boolean
    }> = []

    // Add self-view if local user is sharing
    if (isScreenSharing.value && localScreenVideoTrack.value) {
      shares.push({
        userId: currentUserId + "-self",
        userNickname: "Your Screen",
        videoTrack: localScreenVideoTrack.value,
        audioTrack: localScreenAudioTrack.value,
        quality: screenShareQuality.value,
        connectionState: "self-view",
        isSelfView: true,
      })
    }

    // Add remote shares - iterate over userScreenShareStates to catch all shares
    // This ensures we don't miss shares even if remoteParticipants hasn't updated yet
    userScreenShareStates.value.forEach((shareState, userId) => {
      if (shareState?.isSharing && userId !== currentUserId) {
        const participant = remoteParticipants.value.get(userId)
        const tracks = remoteScreenTracks.value.get(userId)

        shares.push({
          userId,
          userNickname: participant?.name || userId,
          videoTrack: tracks?.video || null,
          audioTrack: tracks?.audio || null,
          quality: shareState.quality,
          connectionState: "connected",
        })
      }
    })

    return shares
  })

  // Computed camera data for display
  const cameraData = computed(() => {
    void cameraVersion.value // Trigger reactivity
    const currentUserId = getCurrentUserId()

    const cameras: Array<{
      userId: string
      userNickname: string
      videoTrack: RemoteVideoTrack | LocalVideoTrack | null
      connectionState: string
      isSelfView?: boolean
    }> = []

    // Add self-view if local camera is enabled
    if (isCameraEnabled.value && localCameraTrack.value) {
      cameras.push({
        userId: currentUserId + "-self",
        userNickname: "Your Camera",
        videoTrack: localCameraTrack.value,
        connectionState: "self-view",
        isSelfView: true,
      })
    }

    // Add remote cameras - iterate over userCameraStates to catch all cameras
    userCameraStates.value.forEach((isEnabled, userId) => {
      if (isEnabled && userId !== currentUserId) {
        const participant = remoteParticipants.value.get(userId)
        const track = remoteCameraTracks.value.get(userId)

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

  // Cleanup function
  const cleanup = () => {
    debugLog(`[LiveKit][INFO]: 'Cleaning up LiveKit...'`)

    stopPingInterval()
    stopStatsPolling()

    // Store reference to current room before clearing it
    const currentRoom = room.value

    // Clear room reference first to prevent disconnect event handler
    // from calling cleanup again (which would race with new connections)
    room.value = null
    isConnected.value = false
    localParticipant.value = null

    // Stop screen share if active (using LiveKit API)
    if (isScreenSharing.value && currentRoom) {
      try {
        void currentRoom.localParticipant.setScreenShareEnabled(false)
      } catch {
        // Ignore errors during cleanup
      }
    }

    // Reset screen sharing state
    localScreenVideoTrack.value = null
    localScreenAudioTrack.value = null
    localScreenVideoPublication.value = null
    localScreenAudioPublication.value = null
    isScreenSharing.value = false
    screenShareQuality.value = "1080p30"
    isStoppingScreenShare.value = false

    // Stop camera if active - manually stop the MediaStreamTrack to turn off privacy light
    if (isCameraEnabled.value) {
      try {
        const track = localCameraTrack.value
        if (track) {
          const mediaStreamTrack = track.mediaStreamTrack
          if (mediaStreamTrack && mediaStreamTrack.readyState === "live") {
            mediaStreamTrack.stop()
          }
        }
      } catch {
        // Ignore errors during cleanup
      }
    }

    // Reset camera state
    localCameraTrack.value = null
    localCameraPublication.value = null
    isCameraEnabled.value = false
    isStoppingCamera.value = false
    userCameraStates.value.clear()
    remoteCameraTracks.value.clear()

    // Unpublish audio track
    void unpublishAudioTrack()

    // Stop local audio track
    if (localAudioTrack.value) {
      localAudioTrack.value.stop()
      localAudioTrack.value = null
    }

    // Disconnect from room (now safe since room.value is already null)
    if (currentRoom) {
      try {
        void currentRoom.disconnect()
      } catch {
        // Ignore errors during cleanup
      }
    }

    // Clear stores
    remoteParticipants.value.clear()
    remoteAudioTracks.value.clear()
    remoteScreenTracks.value.clear()
    userScreenShareStates.value.clear()

    // Clear presence store
    presenceStore.cleanup()

    localStreamPromise = null

    debugLog(`[LiveKit][INFO]: 'LiveKit cleanup complete'`)
  }

  // Lifecycle hooks
  onMounted(async () => {
    // Don't auto-connect - let the component call initializeLiveKit when ready
  })

  onUnmounted(() => {
    cleanup()
  })

  return {
    // State
    room,
    isConnected,
    isConnecting,
    connectionError,
    localParticipant,
    localAudioTrack,
    remoteParticipants,
    remoteAudioTracks,

    // Screen sharing state
    isScreenSharing,
    screenShareQuality,
    userScreenShareStates,
    screenShareData,

    // Camera state
    isCameraEnabled,
    userCameraStates,
    cameraData,

    // Audio-only legacy compatibility (voice chat participants)
    localStream: computed(() =>
      localAudioTrack.value ? new MediaStream([localAudioTrack.value.mediaStreamTrack]) : null,
    ),
    remoteStreams: computed(() => {
      const streams = new Map<string, MediaStream>()
      remoteAudioTracks.value.forEach((track, userId) => {
        streams.set(userId, new MediaStream([track.mediaStreamTrack]))
      })
      return streams
    }),
    peerConnections: ref(new Map()),
    peerConnectionStates: ref(new Map()),
    peerConnectionRetries: ref(new Map()),
    currentPing,
    participantStats,

    // Methods
    initializeLiveKit,
    ensureLocalStream,
    applyMuteState,
    applyDeafenState,
    handleMuteToggle,
    startScreenShare,
    stopScreenShare,
    startCamera,
    stopCamera,
    toggleCamera,
    getParticipantStats,
    reinitializeAudioStream,
    cleanup,
  }
}
