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
  LocalVideoTrack,
  LocalAudioTrack,
  Track,
} from "livekit-client"
import { apiService } from "@/services/api"
import { usePresenceStore } from "@/stores/presence"
import { useAudioSettingsStore } from "@/stores/audioSettings"
import { useCallStore } from "@/stores/call"
import { getLiveKitAudioConstraints } from "@/services/livekit-audio-processors"
import { getAudioWorkletProcessor } from "@/services/audio"
import type {
  User,
  ScreenShareQuality,
  ConnectionStats,
  TrackStats,
} from "@/types"
import type { AudioWorkletProcessor } from "@/types/audio"

export interface UseLiveKitOptions {
  roomId: string
  roomName: string
  users: User[]
  remoteStreamVolumes: Map<string, number>
  onVolumeChange: (userId: string, volume: number) => void
  onPingUpdate: (
    ping: number,
    quality: "excellent" | "good" | "fair" | "poor",
  ) => void
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

  // Audio processing
  let audioWorkletProcessor: AudioWorkletProcessor | null = null
  let localStreamPromise: Promise<MediaStream | null> | null = null

  // Ping tracking
  const currentPing = ref<number>(0)
  let pingInterval: ReturnType<typeof setInterval> | null = null
  const PING_INTERVAL = 3000

  // Stats tracking
  const participantStats = ref<Map<string, ConnectionStats>>(new Map())
  let statsInterval: ReturnType<typeof setInterval> | null = null
  const STATS_INTERVAL = 2000 // Update every 2 seconds
  const previousStats = ref<
    Map<string, Map<string, { bytesReceived: number; timestamp: number }>>
  >(new Map())

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
        new Map([
          [trackId, { bytesReceived: currentBytes, timestamp: currentTime }],
        ]),
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

  // Update stats for all participants
  const updateStats = async () => {
    const stats = new Map<string, ConnectionStats>()
    const currentUserId = getCurrentUserId()
    const currentTime = Date.now()

    // Get local stats
    if (localAudioPublication.value?.track) {
      try {
        const trackStats =
          await localAudioPublication.value.track.getRTCStatsReport()
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

  // Dispose AudioWorklet processor
  const disposeAudioWorkletProcessor = () => {
    if (audioWorkletProcessor) {
      try {
        audioWorkletProcessor.dispose()
      } catch (error) {
        console.warn("Error disposing AudioWorklet processor:", error)
      }
      audioWorkletProcessor = null
    }
  }

  // Ensure local media stream is available (for AudioWorklet processing)
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
      console.log(`[LiveKit][INFO]: Existing audio track ended, creating new track`)
      localAudioTrack.value.stop()
      localAudioTrack.value = null
      localStreamPromise = null  // Reset promise so we create a new track
    }

    if (!localStreamPromise) {
      localStreamPromise = (async () => {
        try {
          // Load audio settings
          if (!audioSettingsStore.isLoaded) {
            audioSettingsStore.loadSettings()
          }

          const algorithm = audioSettingsStore.noiseSuppressionAlgorithm
          const requiresWorklet = audioSettingsStore.requiresAudioWorklet

          console.log(
            `[LiveKit][INFO]: Initializing audio track with algorithm: ${algorithm}`,
          )

          // Get audio constraints based on algorithm
          const audioConstraints = getLiveKitAudioConstraints(algorithm)

          // Apply AudioWorklet processing BEFORE creating LiveKit track to avoid Proxy cloning issues
          if (
            requiresWorklet &&
            (algorithm === "rnnoise" || algorithm === "speex")
          ) {
            console.log(
              `[LiveKit][INFO]: Applying AudioWorklet processor for ${algorithm} before track creation`,
            )

            disposeAudioWorkletProcessor()
            audioWorkletProcessor = getAudioWorkletProcessor(algorithm)

            if (audioWorkletProcessor) {
              try {
                // Get raw media stream first
                const rawStream = await navigator.mediaDevices.getUserMedia({
                  audio: audioConstraints,
                })

                // Process through AudioWorklet
                const processedStream =
                  await audioWorkletProcessor.processStream(rawStream)
                console.log(
                  `[LiveKit][INFO]: AudioWorklet processor applied successfully`,
                )

                // Create LiveKit track from processed stream (no setProcessor needed)
                const processedTrack = processedStream.getAudioTracks()[0]
                if (processedTrack) {
                  const track = new LocalAudioTrack(processedTrack)
                  localAudioTrack.value = track
                  console.log(
                    `[LiveKit][INFO]: 'Audio track initialized successfully with AudioWorklet processing'}`,
                  )
                  return track
                }
              } catch (error) {
                console.error(
                  `Failed to apply ${algorithm} AudioWorklet:`,
                  error,
                )
                console.error(
                  `[LiveKit][ERROR]: Failed to apply ${algorithm} processing: ${(error as Error).message}`,
                )

                // Fallback to browser-native
                audioSettingsStore.setWASMError(
                  `Failed to load ${algorithm}: ${(error as Error).message}. Falling back to browser-native.`,
                )
                disposeAudioWorkletProcessor()
                audioSettingsStore.setNoiseSuppressionAlgorithm(
                  "browser-native",
                )

                const fallbackTrack = await createLocalAudioTrack({
                  audio: getLiveKitAudioConstraints("browser-native"),
                })
                localAudioTrack.value = fallbackTrack
                return fallbackTrack
              }
            }
          }

          // Create LiveKit audio track (for non-AudioWorklet algorithms)
          const track = await createLocalAudioTrack({
            audio: audioConstraints,
          })

          localAudioTrack.value = track
          console.log(
            `[LiveKit][INFO]: 'Audio track initialized successfully'}`,
          )
          return track
        } catch (error) {
          console.error("Failed to initialize audio track:", error)
          console.error(
            `[LiveKit][ERROR]: Failed to initialize audio: ${(error as Error).message}`,
          )
          return null
        }
      })()
    }

    return await localStreamPromise
  }

  // Connect to LiveKit room
  const connectToRoom = async (
    token: string,
    url: string,
  ): Promise<boolean> => {
    try {
      isConnecting.value = true
      connectionError.value = null

      console.log(`[LiveKit][INFO]: Connecting to LiveKit room at ${url}`)

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

      console.log(`[LiveKit][INFO]: 'Connected to LiveKit room successfully'}`)

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
      console.error(
        `[LiveKit][ERROR]: Connection failed: ${(error as Error).message}`,
      )
      isConnecting.value = false
      return false
    }
  }

  // Setup LiveKit room event listeners
  const setupRoomEventListeners = (lkRoom: Room) => {
    // Remote participant events
    lkRoom.on(
      RoomEvent.ParticipantConnected,
      (participant: RemoteParticipant) => {
        console.log(
          `[LiveKit][INFO]: Participant connected: ${participant.identity}`,
        )
        remoteParticipants.value.set(participant.identity, participant)

        // Subscribe to participant's tracks
        participant.trackPublications.forEach((publication) => {
          if (publication.track) {
            handleRemoteTrack(publication.track, participant)
          }
        })
      },
    )

    lkRoom.on(
      RoomEvent.ParticipantDisconnected,
      (participant: RemoteParticipant) => {
        console.log(
          `[LiveKit][INFO]: Participant disconnected: ${participant.identity}`,
        )
        remoteParticipants.value.delete(participant.identity)
        remoteAudioTracks.value.delete(participant.identity)
        remoteScreenTracks.value.delete(participant.identity)
        userScreenShareStates.value.delete(participant.identity)
        screenShareVersion.value++
      },
    )

    // Track events
    lkRoom.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      console.log(
        `[LiveKit][INFO]: Track subscribed: ${track.kind} from ${participant.identity}`,
      )
      handleRemoteTrack(track, participant)
    })

    lkRoom.on(
      RoomEvent.TrackUnsubscribed,
      (track, publication, participant) => {
        console.log(
          `[LiveKit][INFO]: Track unsubscribed: ${track.kind} from ${participant.identity}`,
        )
        handleTrackUnsubscribed(track, participant)
      },
    )

    lkRoom.on(RoomEvent.TrackMuted, (publication, participant) => {
      console.log(
        `[LiveKit][INFO]: Track muted: ${publication.trackSid} from ${participant.identity}`,
      )
    })

    lkRoom.on(RoomEvent.TrackUnmuted, (publication, participant) => {
      console.log(
        `[LiveKit][INFO]: Track unmuted: ${publication.trackSid} from ${participant.identity}`,
      )
    })

    // Local track events for screen sharing
    lkRoom.on(RoomEvent.LocalTrackPublished, (publication) => {
      const track = publication.track
      if (!track) return

      if (track.source === Track.Source.ScreenShare) {
        console.log(
          `[LiveKit][INFO]: Local screen share track published: ${publication.trackSid}`,
        )
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
          console.log(
            `[LiveKit][INFO]: 'Screen share track ended (browser UI)'}`,
          )
          void stopScreenShare()
        })
      } else if (track.source === Track.Source.ScreenShareAudio) {
        console.log(
          `[LiveKit][INFO]: Local screen share audio track published: ${publication.trackSid}`,
        )
        localScreenAudioPublication.value = publication
        localScreenAudioTrack.value = track as LocalAudioTrack
      }
    })

    lkRoom.on(RoomEvent.LocalTrackUnpublished, (publication) => {
      if (publication.source === Track.Source.ScreenShare) {
        console.log(
          `[LiveKit][INFO]: Local screen share track unpublished: ${publication.trackSid}`,
        )
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
      } else if (publication.source === Track.Source.ScreenShareAudio) {
        console.log(
          `[LiveKit][INFO]: Local screen share audio track unpublished: ${publication.trackSid}`,
        )
        localScreenAudioPublication.value = null
        localScreenAudioTrack.value = null
      }
    })

    // Connection state events
    lkRoom.on(RoomEvent.Disconnected, (reason) => {
      console.warn(
        `[LiveKit][WARN]: Disconnected from room: ${reason || "unknown reason"}`,
      )
      isConnected.value = false
      // Note: Don't call cleanup() here - it can cause race conditions
      // when switching rooms. Cleanup should only be called from onUnmounted
      // or when explicitly disconnecting. Just stop the intervals here.
      stopPingInterval()
      stopStatsPolling()
    })

    lkRoom.on(RoomEvent.Reconnecting, () => {
      console.warn(`[LiveKit][WARN]: 'Reconnecting to room...'}`)
    })

    lkRoom.on(RoomEvent.Reconnected, () => {
      console.log(`[LiveKit][INFO]: 'Reconnected to room'}`)
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

      console.log(`[LiveKit][INFO]: Audio track received from ${participantId}`)
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

        console.log(
          `[LiveKit][INFO]: Screen share track received from ${participantId}`,
        )
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
      }
    }
  }

  // Publish local audio track
  const publishAudioTrack = async (): Promise<void> => {
    if (!room.value || !localAudioTrack.value) {
      console.warn(
        `[LiveKit][WARN]: 'Cannot publish audio: room or track not ready'}`,
      )
      return
    }

    try {
      console.log(`[LiveKit][INFO]: 'Publishing audio track...'}`)
      const publication = await room.value.localParticipant.publishTrack(
        localAudioTrack.value,
      )
      localAudioPublication.value = publication
      console.log(`[LiveKit][INFO]: 'Audio track published successfully'}`)
    } catch (error) {
      console.error("Failed to publish audio track:", error)
      console.error(
        `[LiveKit][ERROR]: Failed to publish audio: ${(error as Error).message}`,
      )
    }
  }

  // Unpublish local audio track
  const unpublishAudioTrack = async (): Promise<void> => {
    if (!room.value || !localAudioPublication.value) {
      return
    }

    try {
      await room.value.localParticipant.unpublishTrack(
        localAudioPublication.value.trackSid,
      )
      localAudioPublication.value = null
      console.log(`[LiveKit][INFO]: 'Audio track unpublished'}`)
    } catch (error) {
      console.error("Failed to unpublish audio track:", error)
    }
  }

  // Initialize LiveKit connection (fetch token and connect)
  const initializeLiveKit = async (): Promise<boolean> => {
    try {
      console.log(`[LiveKit][INFO]: 'Initializing LiveKit...'}`)

      // Fetch token from backend
      const response = await apiService.getLiveKitToken(options.roomId)
      console.log(
        `[LiveKit][INFO]: Token received, connecting to ${response.room_url}`,
      )

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
      console.error(
        `[LiveKit][ERROR]: Initialization failed: ${(error as Error).message}`,
      )
      return false
    }
  }

  // Apply mute state
  const applyMuteState = async (muted: boolean): Promise<void> => {
    // Check if room is properly connected and ready
    if (!room.value || !isConnected.value) {
      console.log(`[LiveKit][INFO]: Cannot apply mute state - room not ready`)
      return
    }

    // Check if we have an audio track published
    if (!localAudioPublication.value) {
      console.log(`[LiveKit][INFO]: Cannot apply mute state - no audio track published yet`)
      return
    }

    try {
      await room.value.localParticipant.setMicrophoneEnabled(!muted)
      console.log(`[LiveKit][INFO]: Microphone ${muted ? "muted" : "unmuted"}`)
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
    console.log(`[LiveKit][INFO]: Deafen ${deafened ? "enabled" : "disabled"}`)
  }

  // Handle remote user mute toggle (from UI)
  const handleMuteToggle = (userId: string, isMuted: boolean): void => {
    const track = remoteAudioTracks.value.get(userId)
    if (track) {
      track.setMuted(isMuted)
    }
  }

  // Start screen sharing using LiveKit's setScreenShareEnabled API
  const startScreenShare = async (
    quality: ScreenShareQuality,
    audio: boolean,
  ): Promise<void> => {
    if (!room.value) {
      throw new Error("Not connected to room")
    }

    try {
      console.log(
        `[LiveKit][INFO]: Starting screen share: ${quality}${audio ? " with audio" : ""}`,
      )

      // Use LiveKit's recommended API instead of manual getDisplayMedia
      // This properly handles track management without interfering with existing audio
      await room.value.localParticipant.setScreenShareEnabled(true, {
        audio: audio,
        resolution: getScreenShareVideoConstraints(quality),
      })

      // The actual track handling is done in the LocalTrackPublished event listener
      // We update state optimistically, but the real state is managed by events
      screenShareQuality.value = quality

      console.log(`[LiveKit][INFO]: 'Screen sharing started successfully'}`)
    } catch (error) {
      console.error("Failed to start screen share:", error)
      console.error(
        `[LiveKit][ERROR]: Screen share failed: ${(error as Error).message}`,
      )
      throw error
    }
  }

  // Stop screen sharing using LiveKit's setScreenShareEnabled API
  const stopScreenShare = async (): Promise<void> => {
    if (!room.value || !isScreenSharing.value) {
      return
    }

    try {
      console.log(`[LiveKit][INFO]: 'Stopping screen share...'}`)

      // Use LiveKit's recommended API to disable screen sharing
      // This properly handles track cleanup without affecting existing audio
      await room.value.localParticipant.setScreenShareEnabled(false)

      // The actual state cleanup is handled in LocalTrackUnpublished event listener

      console.log(`[LiveKit][INFO]: 'Screen sharing stopped'}`)
    } catch (error) {
      console.error("Error stopping screen share:", error)
      console.error(
        `[LiveKit][ERROR]: Error stopping screen share: ${(error as Error).message}`,
      )
    }
  }

  // Get screen share video constraints
  // Returns VideoPreset string for LiveKit's setScreenShareEnabled API
  const getScreenShareVideoConstraints = (
    quality: ScreenShareQuality,
  ): string => {
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
    console.log(`[LiveKit][INFO]: 'Reinitializing audio stream...'}`)

    // Unpublish current track
    await unpublishAudioTrack()

    // Stop and clear current track
    if (localAudioTrack.value) {
      localAudioTrack.value.stop()
      localAudioTrack.value = null
    }

    // Clear processor
    disposeAudioWorkletProcessor()

    // Reset promise so we create a new track
    localStreamPromise = null

    // Create and publish new track
    await initializeAudioTrack()
    await publishAudioTrack()

    console.log(`[LiveKit][INFO]: 'Audio stream reinitialized'}`)
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
      stream: MediaStream | null
      quality: ScreenShareQuality
      connectionState: string
      isSelfView?: boolean
    }> = []

    // Add self-view if local user is sharing
    if (isScreenSharing.value && localScreenVideoTrack.value) {
      const selfStream = new MediaStream([
        localScreenVideoTrack.value.mediaStreamTrack,
      ])
      shares.push({
        userId: currentUserId + "-self",
        userNickname: "Your Screen",
        stream: selfStream,
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
        const tracks_array: MediaStreamTrack[] = []
        if (tracks?.video) {
          tracks_array.push(tracks.video.mediaStreamTrack)
        }
        if (tracks?.audio) {
          tracks_array.push(tracks.audio.mediaStreamTrack)
        }

        shares.push({
          userId,
          userNickname: participant?.name || userId,
          stream:
            tracks_array.length > 0 ? new MediaStream(tracks_array) : null,
          quality: shareState.quality,
          connectionState: "connected",
        })
      }
    })

    return shares
  })

  // Cleanup function
  const cleanup = () => {
    console.log(`[LiveKit][INFO]: 'Cleaning up LiveKit...'`)

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

    // Unpublish audio track
    void unpublishAudioTrack()

    // Stop local audio track
    if (localAudioTrack.value) {
      localAudioTrack.value.stop()
      localAudioTrack.value = null
    }

    // Dispose AudioWorklet processor
    disposeAudioWorkletProcessor()

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

    console.log(`[LiveKit][INFO]: 'LiveKit cleanup complete'`)
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

    // Legacy compatibility (for useWebRTC interface)
    localStream: computed(() =>
      localAudioTrack.value
        ? new MediaStream([localAudioTrack.value.mediaStreamTrack])
        : null,
    ),
    remoteStreams: computed(() => {
      const streams = new Map<string, MediaStream>()
      remoteAudioTracks.value.forEach((track, userId) => {
        streams.set(userId, new MediaStream([track.mediaStreamTrack]))
      })
      return streams
    }),
    peerConnections: ref(new Map()), // Empty map for compatibility
    peerConnectionStates: ref(new Map()), // Empty map for compatibility
    peerConnectionRetries: ref(new Map()), // Empty map for compatibility
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
    getParticipantStats,
    reinitializeAudioStream,
    cleanup,
  }
}
