import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
  Room,
  RoomEvent,
  type LocalAudioTrack,
  type LocalTrackPublication,
  type RemoteAudioTrack,
  type RemoteVideoTrack,
  type RemoteParticipant,
  type LocalParticipant,
  createLocalAudioTrack,
  LocalVideoTrack,
  LocalAudioTrack,
  Track
} from 'livekit-client'
import { apiService } from '@/services/api'
import { usePresenceStore } from '@/stores/presence'
import { useAudioSettingsStore } from '@/stores/audioSettings'
import { useCallStore } from '@/stores/call'
import { getLiveKitAudioConstraints } from '@/services/livekit-audio-processors'
import { getAudioWorkletProcessor } from '@/services/audio'
import type { User, ScreenShareQuality } from '@/types'
import type { AudioWorkletProcessor } from '@/types/audio'

export interface UseLiveKitOptions {
  roomId: string
  roomName: string
  users: User[]
  remoteStreamVolumes: Map<string, number>
  onVolumeChange: (userId: string, volume: number) => void
  onPingUpdate: (ping: number, quality: 'excellent' | 'good' | 'fair' | 'poor') => void
  onDebugLog?: (message: string, level: 'info' | 'warning' | 'error', userId?: string) => void
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
  const screenShareQuality = ref<ScreenShareQuality>('1080p30')
  const localScreenVideoTrack = ref<LocalVideoTrack | null>(null)
  const localScreenAudioTrack = ref<LocalAudioTrack | null>(null)
  const userScreenShareStates = ref<Map<string, ScreenShareState>>(new Map())
  const remoteScreenTracks = ref<Map<string, { video?: RemoteVideoTrack; audio?: RemoteAudioTrack }>>(new Map())
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

  // Debug logging helper
  const addDebugLog = (message: string, level: 'info' | 'warning' | 'error' = 'info', userId?: string) => {
    if (options.onDebugLog) {
      options.onDebugLog(message, level, userId)
    }
    console.log(`[LiveKit][${level.toUpperCase()}]${userId ? ' [' + userId + ']' : ''}: ${message}`)
  }

  // Get current user ID
  const getCurrentUserId = (): string => {
    let userId = localStorage.getItem('orbital_user_id')
    if (!userId) {
      userId = 'user_' + Math.random().toString(36).substr(2, 12)
      localStorage.setItem('orbital_user_id', userId)
    }
    return userId
  }

  // Dispose AudioWorklet processor
  const disposeAudioWorkletProcessor = () => {
    if (audioWorkletProcessor) {
      try {
        audioWorkletProcessor.dispose()
      } catch (error) {
        console.warn('Error disposing AudioWorklet processor:', error)
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
    if (localAudioTrack.value) {
      return localAudioTrack.value
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

          addDebugLog(`Initializing audio track with algorithm: ${algorithm}`, 'info')

          // Get audio constraints based on algorithm
          const audioConstraints = getLiveKitAudioConstraints(algorithm)

          // Apply AudioWorklet processing BEFORE creating LiveKit track to avoid Proxy cloning issues
          if (requiresWorklet && (algorithm === 'rnnoise' || algorithm === 'speex')) {
            addDebugLog(`Applying AudioWorklet processor for ${algorithm} before track creation`, 'info')

            disposeAudioWorkletProcessor()
            audioWorkletProcessor = getAudioWorkletProcessor(algorithm)

            if (audioWorkletProcessor) {
              try {
                // Get raw media stream first
                const rawStream = await navigator.mediaDevices.getUserMedia({
                  audio: audioConstraints
                })

                // Process through AudioWorklet
                const processedStream = await audioWorkletProcessor.processStream(rawStream)
                addDebugLog(`AudioWorklet processor applied successfully`, 'info')

                // Create LiveKit track from processed stream (no setProcessor needed)
                const processedTrack = processedStream.getAudioTracks()[0]
                if (processedTrack) {
                  const track = new LocalAudioTrack(processedTrack)
                  localAudioTrack.value = track
                  addDebugLog('Audio track initialized successfully with AudioWorklet processing', 'info')
                  return track
                }
              } catch (error) {
                console.error(`Failed to apply ${algorithm} AudioWorklet:`, error)
                addDebugLog(`Failed to apply ${algorithm} processing: ${(error as Error).message}`, 'error')

                // Fallback to browser-native
                audioSettingsStore.setWASMError(`Failed to load ${algorithm}: ${(error as Error).message}. Falling back to browser-native.`)
                disposeAudioWorkletProcessor()
                audioSettingsStore.setNoiseSuppressionAlgorithm('browser-native')

                const fallbackTrack = await createLocalAudioTrack({
                  audio: getLiveKitAudioConstraints('browser-native'),
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
          addDebugLog('Audio track initialized successfully', 'info')
          return track
        } catch (error) {
          console.error('Failed to initialize audio track:', error)
          addDebugLog(`Failed to initialize audio: ${(error as Error).message}`, 'error')
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

      addDebugLog(`Connecting to LiveKit room at ${url}`, 'info')

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

      addDebugLog('Connected to LiveKit room successfully', 'info')

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
      console.error('Failed to connect to LiveKit room:', error)
      connectionError.value = (error as Error).message
      addDebugLog(`Connection failed: ${(error as Error).message}`, 'error')
      isConnecting.value = false
      return false
    }
  }

  // Setup LiveKit room event listeners
  const setupRoomEventListeners = (lkRoom: Room) => {
    // Remote participant events
    lkRoom.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      addDebugLog(`Participant connected: ${participant.identity}`, 'info')
      remoteParticipants.value.set(participant.identity, participant)
      
      // Subscribe to participant's tracks
      participant.trackPublications.forEach((publication) => {
        if (publication.track) {
          handleRemoteTrack(publication.track, participant)
        }
      })
    })

    lkRoom.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      addDebugLog(`Participant disconnected: ${participant.identity}`, 'info')
      remoteParticipants.value.delete(participant.identity)
      remoteAudioTracks.value.delete(participant.identity)
      remoteScreenTracks.value.delete(participant.identity)
      userScreenShareStates.value.delete(participant.identity)
      screenShareVersion.value++
    })

    // Track events
    lkRoom.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      addDebugLog(`Track subscribed: ${track.kind} from ${participant.identity}`, 'info')
      handleRemoteTrack(track, participant)
    })

    lkRoom.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      addDebugLog(`Track unsubscribed: ${track.kind} from ${participant.identity}`, 'info')
      handleTrackUnsubscribed(track, participant)
    })

    lkRoom.on(RoomEvent.TrackMuted, (publication, participant) => {
      addDebugLog(`Track muted: ${publication.trackSid} from ${participant.identity}`, 'info')
    })

    lkRoom.on(RoomEvent.TrackUnmuted, (publication, participant) => {
      addDebugLog(`Track unmuted: ${publication.trackSid} from ${participant.identity}`, 'info')
    })

    // Local track events for screen sharing
    lkRoom.on(RoomEvent.LocalTrackPublished, (publication) => {
      const track = publication.track
      if (!track) return

      if (track.source === Track.Source.ScreenShare) {
        addDebugLog(`Local screen share track published: ${publication.trackSid}`, 'info')
        localScreenVideoPublication.value = publication
        localScreenVideoTrack.value = track as LocalVideoTrack
        isScreenSharing.value = true
        screenShareVersion.value++

        // Update local state for self-view
        userScreenShareStates.value.set(getCurrentUserId(), {
          isSharing: true,
          quality: screenShareQuality.value
        })

        // Listen for browser-native stop sharing (via the "Stop sharing" button)
        track.on('ended', () => {
          addDebugLog('Screen share track ended (browser UI)', 'info')
          void stopScreenShare()
        })
      } else if (track.source === Track.Source.ScreenShareAudio) {
        addDebugLog(`Local screen share audio track published: ${publication.trackSid}`, 'info')
        localScreenAudioPublication.value = publication
        localScreenAudioTrack.value = track as LocalAudioTrack
      }
    })

    lkRoom.on(RoomEvent.LocalTrackUnpublished, (publication) => {
      if (publication.source === Track.Source.ScreenShare) {
        addDebugLog(`Local screen share track unpublished: ${publication.trackSid}`, 'info')
        localScreenVideoPublication.value = null
        localScreenVideoTrack.value = null
        isScreenSharing.value = false
        screenShareQuality.value = '1080p30'
        screenShareVersion.value++

        // Update local state
        userScreenShareStates.value.set(getCurrentUserId(), {
          isSharing: false,
          quality: '1080p30'
        })
      } else if (publication.source === Track.Source.ScreenShareAudio) {
        addDebugLog(`Local screen share audio track unpublished: ${publication.trackSid}`, 'info')
        localScreenAudioPublication.value = null
        localScreenAudioTrack.value = null
      }
    })

    // Connection state events
    lkRoom.on(RoomEvent.Disconnected, (reason) => {
      addDebugLog(`Disconnected from room: ${reason || 'unknown reason'}`, 'warning')
      isConnected.value = false
      cleanup()
    })

    lkRoom.on(RoomEvent.Reconnecting, () => {
      addDebugLog('Reconnecting to room...', 'warning')
    })

    lkRoom.on(RoomEvent.Reconnected, () => {
      addDebugLog('Reconnected to room', 'info')
    })
  }

  // Handle remote track subscription
  const handleRemoteTrack = (track: RemoteAudioTrack | RemoteVideoTrack, participant: RemoteParticipant) => {
    const participantId = participant.identity

    if (track.kind === Track.Kind.Audio) {
      const audioTrack = track
      remoteAudioTracks.value.set(participantId, audioTrack)

      // Set initial volume if specified
      const volume = options.remoteStreamVolumes.get(participantId) ?? 80
      audioTrack.setVolume(volume / 100)

      addDebugLog(`Audio track received from ${participantId}`, 'info', participantId)
    } else if (track.kind === Track.Kind.Video) {
      // Check if it's a screen share (source === 'screen_share')
      const videoTrack = track
      if (videoTrack.source === Track.Source.ScreenShare) {
        const currentTracks = remoteScreenTracks.value.get(participantId) || {}
        remoteScreenTracks.value.set(participantId, { ...currentTracks, video: videoTrack })
        
        userScreenShareStates.value.set(participantId, {
          isSharing: true,
          quality: '1080p30' // Default, will be updated from attributes if available
        })
        screenShareVersion.value++
        
        addDebugLog(`Screen share track received from ${participantId}`, 'info', participantId)
      }
    }
  }

  // Handle track unsubscription
  const handleTrackUnsubscribed = (track: RemoteAudioTrack | RemoteVideoTrack, participant: RemoteParticipant) => {
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
          quality: '1080p30'
        })
        screenShareVersion.value++
      }
    }
  }

  // Publish local audio track
  const publishAudioTrack = async (): Promise<void> => {
    if (!room.value || !localAudioTrack.value) {
      addDebugLog('Cannot publish audio: room or track not ready', 'warning')
      return
    }

    try {
      addDebugLog('Publishing audio track...', 'info')
      const publication = await room.value.localParticipant.publishTrack(localAudioTrack.value)
      localAudioPublication.value = publication
      addDebugLog('Audio track published successfully', 'info')
    } catch (error) {
      console.error('Failed to publish audio track:', error)
      addDebugLog(`Failed to publish audio: ${(error as Error).message}`, 'error')
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
      addDebugLog('Audio track unpublished', 'info')
    } catch (error) {
      console.error('Failed to unpublish audio track:', error)
    }
  }

  // Initialize LiveKit connection (fetch token and connect)
  const initializeLiveKit = async (): Promise<boolean> => {
    try {
      addDebugLog('Initializing LiveKit...', 'info')

      // Fetch token from backend
      const response = await apiService.getLiveKitToken(options.roomId)
      addDebugLog(`Token received, connecting to ${response.room_url}`, 'info')

      // Initialize audio track first
      await initializeAudioTrack()

      // Connect to room
      const connected = await connectToRoom(response.token, response.room_url)
      
      if (connected) {
        // Start ping interval
        startPingInterval()
      }

      return connected
    } catch (error) {
      console.error('Failed to initialize LiveKit:', error)
      addDebugLog(`Initialization failed: ${(error as Error).message}`, 'error')
      return false
    }
  }

  // Apply mute state
  const applyMuteState = async (muted: boolean): Promise<void> => {
    if (!room.value) {
      return
    }

    try {
      await room.value.localParticipant.setMicrophoneEnabled(!muted)
      addDebugLog(`Microphone ${muted ? 'muted' : 'unmuted'}`, 'info')
    } catch (error) {
      console.error('Failed to apply mute state:', error)
    }
  }

  // Apply deafen state
  const applyDeafenState = (deafened: boolean): void => {
    // In LiveKit, deafening is handled by muting all remote audio elements
    remoteAudioTracks.value.forEach((track) => {
      track.setMuted(deafened)
    })
    addDebugLog(`Deafen ${deafened ? 'enabled' : 'disabled'}`, 'info')
  }

  // Handle remote user mute toggle (from UI)
  const handleMuteToggle = (userId: string, isMuted: boolean): void => {
    const track = remoteAudioTracks.value.get(userId)
    if (track) {
      track.setMuted(isMuted)
    }
  }

  // Handle audio level updates (from UI/voice activity)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleAudioLevel = (userId: string, level: number, isSpeaking: boolean): void => {
    // In LiveKit, speaking status is tracked via the presence store
    // This is called for UI updates only
    // Parameters kept for API compatibility with useWebRTC
  }

  // Start screen sharing using LiveKit's setScreenShareEnabled API
  const startScreenShare = async (quality: ScreenShareQuality, audio: boolean): Promise<void> => {
    if (!room.value) {
      throw new Error('Not connected to room')
    }

    try {
      addDebugLog(`Starting screen share: ${quality}${audio ? ' with audio' : ''}`, 'info')

      // Use LiveKit's recommended API instead of manual getDisplayMedia
      // This properly handles track management without interfering with existing audio
      await room.value.localParticipant.setScreenShareEnabled(true, {
        audio: audio,
        resolution: getScreenShareVideoConstraints(quality),
      })

      // The actual track handling is done in the LocalTrackPublished event listener
      // We update state optimistically, but the real state is managed by events
      screenShareQuality.value = quality

      addDebugLog('Screen sharing started successfully', 'info')
    } catch (error) {
      console.error('Failed to start screen share:', error)
      addDebugLog(`Screen share failed: ${(error as Error).message}`, 'error')
      throw error
    }
  }

  // Stop screen sharing using LiveKit's setScreenShareEnabled API
  const stopScreenShare = async (): Promise<void> => {
    if (!room.value || !isScreenSharing.value) {
      return
    }

    try {
      addDebugLog('Stopping screen share...', 'info')

      // Use LiveKit's recommended API to disable screen sharing
      // This properly handles track cleanup without affecting existing audio
      await room.value.localParticipant.setScreenShareEnabled(false)

      // The actual state cleanup is handled in LocalTrackUnpublished event listener

      addDebugLog('Screen sharing stopped', 'info')
    } catch (error) {
      console.error('Error stopping screen share:', error)
      addDebugLog(`Error stopping screen share: ${(error as Error).message}`, 'error')
    }
  }

  // Get screen share video constraints
  // Returns VideoPreset string for LiveKit's setScreenShareEnabled API
  const getScreenShareVideoConstraints = (quality: ScreenShareQuality): string => {
    // Map quality to LiveKit VideoPreset names
    // These are standard LiveKit presets: https://docs.livekit.io/client-sdk-js/enums/VideoPreset.html
    const presetMap: Record<ScreenShareQuality, string> = {
      'source': 'screen_share',  // Use LiveKit's default screen share preset
      '1080p60': 'screenShareH1080FPS60',
      '1080p30': 'screenShareH1080FPS30',
      '720p30': 'screenShareH720FPS30',
      '360p30': 'screenShareH360FPS30',
      'text': 'screenShareH1080FPS5'
    }

    return presetMap[quality] || 'screenShareH1080FPS30'
  }

  // Reinitialize audio stream (when algorithm changes)
  const reinitializeAudioStream = async (): Promise<void> => {
    addDebugLog('Reinitializing audio stream...', 'info')

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

    addDebugLog('Audio stream reinitialized', 'info')
  }

  // Start ping interval
  const startPingInterval = () => {
    if (pingInterval) {
      clearInterval(pingInterval)
    }

    pingInterval = setInterval(() => {
      // In LiveKit, we can estimate connection quality via RTC stats
      // For now, we'll set a default good quality since LiveKit handles most quality issues
      currentPing.value = 30 // Placeholder - LiveKit doesn't expose direct ping
      options.onPingUpdate(currentPing.value, 'excellent')
    }, PING_INTERVAL)
  }

  // Stop ping interval
  const stopPingInterval = () => {
    if (pingInterval) {
      clearInterval(pingInterval)
      pingInterval = null
    }
  }

  // Get connection quality (for compatibility with useWebRTC interface)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const getConnectionQuality = (userId: string): {
    bitrate: number
    packetLoss: number
    jitter: number
    quality: 'excellent' | 'good' | 'fair' | 'poor' | 'unknown'
  } => {
    // LiveKit doesn't expose per-user connection stats in the same way
    // Return placeholder data for compatibility
    return {
      bitrate: 0,
      packetLoss: 0,
      jitter: 0,
      quality: 'unknown'
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
      const selfStream = new MediaStream([localScreenVideoTrack.value.mediaStreamTrack])
      shares.push({
        userId: currentUserId + '-self',
        userNickname: 'Your Screen',
        stream: selfStream,
        quality: screenShareQuality.value,
        connectionState: 'self-view',
        isSelfView: true
      })
    }

    // Add remote shares
    remoteParticipants.value.forEach((participant, userId) => {
      const shareState = userScreenShareStates.value.get(userId)
      if (shareState?.isSharing && userId !== currentUserId) {
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
          userNickname: participant.name || userId,
          stream: tracks_array.length > 0 ? new MediaStream(tracks_array) : null,
          quality: shareState.quality,
          connectionState: 'connected'
        })
      }
    })

    return shares
  })

  // Debug data for screen sharing
  const localScreenShareDebugData = computed(() => {
    if (!isScreenSharing.value) return []

    return [{
      userId: getCurrentUserId(),
      userNickname: 'You',
      stream: localScreenVideoTrack.value 
        ? new MediaStream([localScreenVideoTrack.value.mediaStreamTrack])
        : null,
      quality: screenShareQuality.value,
      connectionState: 'connected'
    }]
  })

  const remoteScreenShareDebugData = computed(() => {
    void screenShareVersion.value
    const shares: Array<{
      userId: string
      userNickname: string
      stream: MediaStream | null
      quality: ScreenShareQuality
      connectionState: string
    }> = []

    remoteParticipants.value.forEach((participant, userId) => {
      const shareState = userScreenShareStates.value.get(userId)
      if (shareState?.isSharing) {
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
          userNickname: participant.name || userId,
          stream: tracks_array.length > 0 ? new MediaStream(tracks_array) : null,
          quality: shareState.quality,
          connectionState: 'connected'
        })
      }
    })

    return shares
  })

  // Cleanup function
  const cleanup = () => {
    addDebugLog('Cleaning up LiveKit...', 'info')

    stopPingInterval()

    // Stop screen share if active (using LiveKit API)
    if (isScreenSharing.value && room.value) {
      void room.value.localParticipant.setScreenShareEnabled(false)
    }

    // Reset screen sharing state
    localScreenVideoTrack.value = null
    localScreenAudioTrack.value = null
    localScreenVideoPublication.value = null
    localScreenAudioPublication.value = null
    isScreenSharing.value = false
    screenShareQuality.value = '1080p30'

    // Unpublish audio track
    void unpublishAudioTrack()

    // Stop local audio track
    if (localAudioTrack.value) {
      localAudioTrack.value.stop()
      localAudioTrack.value = null
    }

    // Dispose AudioWorklet processor
    disposeAudioWorkletProcessor()

    // Disconnect from room
    if (room.value) {
      void room.value.disconnect()
      room.value = null
    }

    // Clear stores
    remoteParticipants.value.clear()
    remoteAudioTracks.value.clear()
    remoteScreenTracks.value.clear()
    userScreenShareStates.value.clear()

    // Clear presence store
    presenceStore.cleanup()

    isConnected.value = false
    localParticipant.value = null
    localStreamPromise = null

    addDebugLog('LiveKit cleanup complete', 'info')
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
    localScreenShareDebugData,
    remoteScreenShareDebugData,
    
    // Legacy compatibility (for useWebRTC interface)
    localStream: computed(() => localAudioTrack.value 
      ? new MediaStream([localAudioTrack.value.mediaStreamTrack])
      : null),
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
    
    // Methods
    initializeLiveKit,
    ensureLocalStream,
    applyMuteState,
    applyDeafenState,
    handleMuteToggle,
    handleAudioLevel,
    startScreenShare,
    stopScreenShare,
    getConnectionQuality,
    reinitializeAudioStream,
    cleanup,
    addDebugLog,
  }
}
