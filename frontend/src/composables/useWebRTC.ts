import { ref, computed, onMounted, onUnmounted } from 'vue'
import { wsService } from '@/services/websocket'
import { webRTCStatsCollector, analyzeICEConnection } from '@/services/webrtc-stats'
import { useAudioSettingsStore } from '@/stores/audioSettings'
import { getAudioWorkletProcessor } from '@/services/audio'
import { apiService, type ICEServer } from '@/services/api'
import type {
  User,
  RoomUser,
  ScreenShareQuality,
  ScreenShareData,
  WebSocketMessage,
  ICEConnectionType
} from '@/types'
import type { AudioWorkletProcessor } from '@/types/audio'

export interface UseWebRTCOptions {
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

export function useWebRTC(options: UseWebRTCOptions) {
  // Audio settings store
  const audioSettings = useAudioSettingsStore()

  // Reactive state
  const localStream = ref<MediaStream | null>(null)
  const remoteStreams = ref<Map<string, MediaStream>>(new Map())
  const peerConnections = ref<Map<string, RTCPeerConnection>>(new Map())
  const peerConnectionStates = ref<Map<string, string>>(new Map())
  const remoteStreamMutes = ref<Map<string, boolean>>(new Map())
  const currentRoomUsers = ref<Map<string, RoomUser>>(new Map())
  const peerConnectionRetries = ref<Map<string, number>>(new Map())
  const pendingIceCandidates = ref<Map<string, RTCIceCandidateInit[]>>(new Map())
  const currentUserJoinTime = ref<number>(0)
  const reconnectionTimers = ref<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const reconnectionInProgress = ref<Map<string, boolean>>(new Map())
  
  // 3-way handshake reconnection state
  // 'none' | 'request_sent' | 'ready_received' - tracks where we are in the handshake
  const reconnectionHandshakeState = ref<Map<string, 'none' | 'request_sent' | 'ready_received'>>(new Map())
  // Timestamp of when we sent reconnect_request (for tie-breaking in race condition)
  const reconnectionRequestTime = ref<Map<string, number>>(new Map())

  // Screen sharing state
  const isScreenSharing = ref(false)
  const screenShareQuality = ref<ScreenShareQuality>('1080p30')
  const screenShareAudioEnabled = ref(false)
  const localScreenStream = ref<MediaStream | null>(null)
  const remoteScreenStreams = ref<Map<string, MediaStream>>(new Map())
  const userScreenShareStates = ref<Map<string, ScreenShareState>>(new Map())

  // ICE servers configuration for TURN/STUN
  const iceServers = ref<ICEServer[]>([
    { urls: ['stun:stun.l.google.com:19302'] },
    { urls: ['stun:stun1.l.google.com:19302'] }
  ])

  // AudioWorklet processor for 3rd party noise suppression
  let audioWorkletProcessor: AudioWorkletProcessor | null = null

  // Ping tracking
  const lastPingTime = ref<number>(0)
  const currentPing = ref<number>(0)

  // Used to avoid getUserMedia races during offer/answer handling
  let localStreamPromise: Promise<MediaStream | null> | null = null

  // Debug logging helper
  const addDebugLog = (message: string, level: 'info' | 'warning' | 'error' = 'info', userId?: string) => {
    if (options.onDebugLog) {
      options.onDebugLog(message, level, userId)
    }
    console.log(`[${level.toUpperCase()}]${userId ? ' [' + userId + ']' : ''}: ${message}`)
  }

  // Get current user ID from localStorage
  const getCurrentUserId = (): string => {
    let userId = localStorage.getItem('orbital_user_id')
    if (!userId) {
      userId = 'user_' + Math.random().toString(36).substr(2, 12)
      localStorage.setItem('orbital_user_id', userId)
      console.log('Generated new user ID:', userId)
    }
    return userId
  }

  // Update connection state
  const updateConnectionState = (userId: string, state: string) => {
    peerConnectionStates.value.set(userId, state)
    console.log(`🔄 Connection state for ${userId}: ${state}`)
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

  // Ensure local media stream is available
  const ensureLocalStream = async (): Promise<MediaStream | null> => {
    if (localStream.value) return localStream.value

    if (!localStreamPromise) {
      // Load audio settings if not already loaded
      if (!audioSettings.isLoaded) {
        audioSettings.loadSettings()
      }

      // Get audio constraints from store
      const audioConstraints = audioSettings.audioConstraints
      const algorithm = audioSettings.noiseSuppressionAlgorithm
      const requiresWorklet = audioSettings.requiresAudioWorklet

      console.log('Getting user media with audio constraints:', audioConstraints)
      addDebugLog(`Audio constraints: ${JSON.stringify(audioConstraints)}`, 'info')
      addDebugLog(`Algorithm: ${algorithm}, requires AudioWorklet: ${requiresWorklet}`, 'info')

      localStreamPromise = (async () => {
        try {
          // Get raw audio stream
          const rawStream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
            video: false
          })

          // If algorithm requires AudioWorklet processing, apply it
          if (requiresWorklet) {
            addDebugLog(`Applying AudioWorklet processing for ${algorithm}`, 'info')

            // Dispose any existing processor
            disposeAudioWorkletProcessor()

            // Get the AudioWorklet processor
            audioWorkletProcessor = getAudioWorkletProcessor(algorithm)

            if (audioWorkletProcessor) {
              try {
                // Process the stream through AudioWorklet
                const processedStream = await audioWorkletProcessor.processStream(rawStream)
                localStream.value = processedStream
                addDebugLog(`AudioWorklet processing applied successfully for ${algorithm}`, 'info')
                return processedStream
              } catch (error) {
                console.error(`Failed to apply ${algorithm} AudioWorklet processing:`, error)
                addDebugLog(`Failed to apply ${algorithm} processing: ${(error as Error).message}`, 'error')

                // Set WASM error in store
                audioSettings.setWASMError(`Failed to load ${algorithm}: ${(error as Error).message}. Falling back to browser-native noise suppression.`)

                // Fallback to browser-native
                addDebugLog('Falling back to browser-native noise suppression', 'warning')
                disposeAudioWorkletProcessor()
                audioSettings.setNoiseSuppressionAlgorithm('browser-native')

                // Get new stream with browser-native constraints
                rawStream.getTracks().forEach(t => t.stop())
                const fallbackStream = await navigator.mediaDevices.getUserMedia({
                  audio: audioSettings.audioConstraints,
                  video: false
                })
                localStream.value = fallbackStream
                return fallbackStream
              }
            }
          }

          // No AudioWorklet processing needed or failed to get processor
          localStream.value = rawStream
          addDebugLog('Local media stream obtained successfully', 'info')
          return rawStream
        } catch (error) {
          console.error('Failed to get media stream:', error)
          addDebugLog(`Failed to get media stream: ${(error as Error).message}`, 'error')
          return null
        }
      })()
    }

    return await localStreamPromise
  }

  // Create peer connection for a user
  const createPeerConnection = (userId: string): RTCPeerConnection => {
    const configuration: RTCConfiguration = {
      iceServers: iceServers.value
    }

    // Debug: Force ICE relay if enabled in settings
    if (audioSettings.forceICERelay) {
      configuration.iceTransportPolicy = 'relay'
      addDebugLog('⚠️ Force ICE relay enabled - using TURN only', 'warning', userId)
    }

    addDebugLog(`Creating peer connection with ${iceServers.value.length} ICE servers`, 'info', userId)
    const peerConnection = new RTCPeerConnection(configuration)

    // Add local audio tracks to the peer connection
    if (localStream.value) {
      localStream.value.getAudioTracks().forEach(track => {
        peerConnection.addTrack(track, localStream.value!)
      })
    }

    // Add screen share video track if active
    if (localScreenStream.value) {
      localScreenStream.value.getVideoTracks().forEach(track => {
        peerConnection.addTrack(track, localScreenStream.value!)
      })
    }

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        webRTCStatsCollector.saveOutgoingIceCandidate(userId, event.candidate)
        wsService.sendMessage('ice_candidate', {
          target_user_id: userId,
          user_id: getCurrentUserId(),
          candidate: event.candidate
        })
      } else {
        console.log('ICE gathering completed for', userId)
      }
    }

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState
      console.log(`🔗 Connection state with ${userId}:`, state)
      updateConnectionState(userId, state)

      if (state === 'connected') {
        console.log(`✅ Successfully connected to ${userId}`)
        peerConnectionRetries.value.set(userId, 0)
        // Clear any pending reconnection timer on successful connection
        if (reconnectionTimers.value.has(userId)) {
          clearTimeout(reconnectionTimers.value.get(userId))
          reconnectionTimers.value.delete(userId)
        }
        // Clear reconnection state to prevent interference with future reconnections
        reconnectionInProgress.value.delete(userId)
        reconnectionHandshakeState.value.set(userId, 'none')
        reconnectionRequestTime.value.delete(userId)
        webRTCStatsCollector.startCollection(userId, peerConnection)
        console.log(`📊 Started stats collection for ${userId}`)
      } else if (state === 'failed') {
        console.error(`❌ Connection with ${userId} failed`)
        handleConnectionFailure(userId)
      } else if (state === 'disconnected') {
        console.warn(`⚠️ Disconnected from ${userId}`)
        handleConnectionDisconnection(userId)
      } else if (state === 'closed') {
        webRTCStatsCollector.stopCollection(userId)
        console.log(`📊 Stopped stats collection for ${userId}`)
      }
    }

    // Handle ICE connection state changes
    peerConnection.oniceconnectionstatechange = () => {
      const iceState = peerConnection.iceConnectionState
      console.log(`🧊 ICE connection state with ${userId}:`, iceState)

      if (iceState === 'connected' || iceState === 'completed') {
        console.log(`✅ ICE connection established with ${userId}`)
      } else if (iceState === 'failed') {
        console.error(`❌ ICE connection with ${userId} failed`)
        updateConnectionState(userId, 'ice-failed')
      }
    }

    // Handle ICE gathering state
    peerConnection.onicegatheringstatechange = () => {
      console.log(`🧊 ICE gathering state with ${userId}:`, peerConnection.iceGatheringState)
    }

    // Handle remote tracks
    peerConnection.ontrack = (event) => {
      console.log(`Received remote track from ${userId}:`, event.streams)
      handleRemoteTrack(userId, event.streams[0])
    }

    // Handle signaling state changes
    peerConnection.onsignalingstatechange = () => {
      console.log(`Signaling state with ${userId}:`, peerConnection.signalingState)
    }

    peerConnections.value.set(userId, peerConnection)
    return peerConnection
  }

  // Handle remote track
  const handleRemoteTrack = (userId: string, stream: MediaStream) => {
    try {
      console.log(`🎵 Received remote stream from ${userId}:`, stream)

      const hasVideo = stream.getVideoTracks().length > 0
      const hasAudio = stream.getAudioTracks().length > 0

      if (hasVideo) {
        handleScreenShareTrack(userId, stream)
        console.log(`🖥️ Stored screen share stream for ${userId}`)
      }

      if (hasAudio || !hasVideo) {
        remoteStreams.value.set(userId, stream)

        if (!options.remoteStreamVolumes.has(userId)) {
          options.onVolumeChange(userId, 80)
        }

        if (!remoteStreamMutes.value.has(userId)) {
          remoteStreamMutes.value.set(userId, false)
        }

        console.log(`🎵 Stored audio stream for ${userId}, total streams: ${remoteStreams.value.size}`)
      }
    } catch (error) {
      console.error('❌ Error handling remote track:', error)
    }
  }

  // Schedule reconnection with exponential backoff
  const scheduleReconnection = (userId: string) => {
    if (!currentRoomUsers.value.has(userId)) {
      console.log(`🧹 User ${userId} left room, cleaning up`)
      cleanupPeerConnection(userId)
      return
    }

    // Check if WebSocket is connected
    if (!wsService.isConnected()) {
      console.log(`⏸️ WebSocket not connected, skipping reconnection to ${userId}`)
      return
    }

    // Check if reconnection is already in progress for this user
    if (reconnectionInProgress.value.get(userId)) {
      console.log(`⏸️ Reconnection already in progress for ${userId}`)
      return
    }

    // Check if already connected - no need to reconnect
    const existingConnection = peerConnections.value.get(userId)
    if (existingConnection && existingConnection.connectionState === 'connected') {
      console.log(`⏸️ Already connected to ${userId}, skipping reconnection`)
      return
    }

    const currentRetries = peerConnectionRetries.value.get(userId) || 0
    const baseDelay = 200 // Start with 200ms
    const maxDelay = 3200 // Cap at 3.2 seconds
    const delay = Math.min(baseDelay * Math.pow(2, currentRetries), maxDelay)

    console.log(`🔄 Scheduling reconnection to ${userId} (attempt ${currentRetries + 1}, delay: ${delay}ms)`)

    // Clear any existing timer
    if (reconnectionTimers.value.has(userId)) {
      clearTimeout(reconnectionTimers.value.get(userId))
    }

    const timer = setTimeout(() => {
      if (!currentRoomUsers.value.has(userId)) {
        console.log(`🧹 User ${userId} left room during reconnection delay`)
        return
      }

      // Check WebSocket again before attempting reconnection
      if (!wsService.isConnected()) {
        console.log(`⏸️ WebSocket not connected, aborting reconnection to ${userId}`)
        return
      }

      // Mark reconnection as in progress
      reconnectionInProgress.value.set(userId, true)

      try {
        // Step 1: Send reconnect_request to initiate 3-way handshake
        console.log(`🔄 Step 1/3: Sending reconnect_request to ${userId}`)
        const requestTime = Date.now()
        reconnectionRequestTime.value.set(userId, requestTime)
        reconnectionHandshakeState.value.set(userId, 'request_sent')
        
        wsService.sendMessage('reconnect_request', {
          target_user_id: userId,
          user_id: getCurrentUserId(),
          request_time: requestTime
        })
      } catch (error) {
        console.error(`❌ Error during reconnection to ${userId}:`, error)
        reconnectionInProgress.value.delete(userId)
        reconnectionHandshakeState.value.set(userId, 'none')
      }
    }, delay)

    reconnectionTimers.value.set(userId, timer)
  }

  // Handle connection failure with retry logic
  const handleConnectionFailure = (userId: string) => {
    scheduleReconnection(userId)
  }

  // Handle connection disconnection
  const handleConnectionDisconnection = (userId: string) => {
    scheduleReconnection(userId)
  }

  // Cleanup peer connection
  const cleanupPeerConnection = (userId: string) => {
    try {
      console.log(`🧹 Starting cleanup for peer ${userId}`)

      webRTCStatsCollector.stopCollection(userId)

      const peerConnection = peerConnections.value.get(userId)
      if (peerConnection) {
        peerConnection.close()
        peerConnections.value.delete(userId)
      }

      const audioElement = document.getElementById(`audio-${userId}`)
      if (audioElement) {
        audioElement.remove()
      }

      // Clear any pending reconnection timer
      if (reconnectionTimers.value.has(userId)) {
        clearTimeout(reconnectionTimers.value.get(userId))
        reconnectionTimers.value.delete(userId)
      }

      // Clear pending ICE candidates for this user
      if (pendingIceCandidates.value.has(userId)) {
        pendingIceCandidates.value.delete(userId)
        console.log(`🧊 Cleared pending ICE candidates for ${userId}`)
      }

      // Clear reconnection in progress flag
      reconnectionInProgress.value.delete(userId)
      
      // Clear handshake state
      reconnectionHandshakeState.value.delete(userId)
      reconnectionRequestTime.value.delete(userId)

      remoteStreams.value.delete(userId)
      remoteStreamMutes.value.delete(userId)
      peerConnectionStates.value.delete(userId)
      // Note: We intentionally do NOT delete from currentRoomUsers here
      // This allows reconnection attempts to continue as long as the user
      // is still in the room according to the server. currentRoomUsers
      // is managed by handleRoomUsers and handleUserLeft only.

      console.log(`✅ Cleaned up peer connection and audio for ${userId}`)
    } catch (error) {
      console.error('❌ Error cleaning up peer connection:', error)
    }
  }

  // Create offer for a user
  const createOfferForUser = async (userId: string) => {
    try {
      addDebugLog(`Starting createOfferForUser for ${userId}`, 'info', userId)
      await ensureLocalStream()
      const peerConnection = createPeerConnection(userId)
      const offer = await peerConnection.createOffer()
      await peerConnection.setLocalDescription(offer)

      updateConnectionState(userId, 'creating-offer')
      addDebugLog(`Created SDP offer for ${userId}`, 'info', userId)

      wsService.sendMessage('sdp_offer', {
        target_user_id: userId,
        user_id: getCurrentUserId(),
        sdp: offer
      })

      updateConnectionState(userId, 'offer-sent')
      console.log(`✅ Created and sent offer to ${userId}:`, offer)
      addDebugLog(`Successfully sent offer to ${userId}`, 'info', userId)
    } catch (error) {
      console.error('❌ Error creating offer:', error)
      addDebugLog(`Error creating offer: ${(error as Error).message}`, 'error', userId)
      updateConnectionState(userId, 'error')
    }
  }

  // Process pending ICE candidates
  const processPendingIceCandidates = async (userId: string) => {
    const pendingCandidates = pendingIceCandidates.value.get(userId)
    if (pendingCandidates && pendingCandidates.length > 0) {
      console.log(`🧊 Processing ${pendingCandidates.length} pending ICE candidates for ${userId}`)
      addDebugLog(`Processing ${pendingCandidates.length} pending ICE candidates for ${userId}`, 'info', userId)

      for (const candidate of pendingCandidates) {
        try {
          const peerConnection = peerConnections.value.get(userId)
          if (peerConnection && peerConnection.remoteDescription) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
            console.log(`🧊 Added pending ICE candidate for ${userId}:`, candidate)
            addDebugLog(`Added pending ICE candidate for ${userId}`, 'info', userId)
          }
        } catch (error) {
          console.error(`❌ Error adding pending ICE candidate for ${userId}:`, error)
          addDebugLog(`Error adding pending ICE candidate: ${(error as Error).message}`, 'error', userId)
        }
      }
      pendingIceCandidates.value.delete(userId)
      addDebugLog(`Processed all pending ICE candidates for ${userId}`, 'info', userId)
    }
  }

  // Handle ICE candidate message
  const handleIceCandidate = async (data: { user_id: string; candidate: RTCIceCandidateInit }) => {
    let peerUserId = 'unknown'
    try {
      const { user_id, candidate } = data
      peerUserId = user_id
      const peerConnection = peerConnections.value.get(user_id)

      if (!peerConnection) {
        console.warn(`⚠️ Received ICE candidate for unknown peer: ${user_id}, queuing candidate`)
        if (!pendingIceCandidates.value.has(user_id)) {
          pendingIceCandidates.value.set(user_id, [])
        }
        pendingIceCandidates.value.get(user_id)!.push(candidate)
        addDebugLog(`ICE candidate queued for unknown peer ${user_id}`, 'warning', user_id)
        return
      }

      if (peerConnection.remoteDescription) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
        console.log(`🧊 Added ICE candidate from ${user_id}:`, candidate)
        addDebugLog(`ICE candidate added from ${user_id}`, 'info', user_id)
        // Note: Don't update connection state here - the actual connection state
        // is tracked by peerConnection.onconnectionstatechange
      } else {
        console.log(`🧊 Queuing ICE candidate from ${user_id} (no remote description yet)`)
        if (!pendingIceCandidates.value.has(user_id)) {
          pendingIceCandidates.value.set(user_id, [])
        }
        pendingIceCandidates.value.get(user_id)!.push(candidate)
        addDebugLog(`ICE candidate queued (no remote description) for ${user_id}`, 'info', user_id)
      }
    } catch (error) {
      console.error('❌ Error handling ICE candidate:', error, 'Data:', data)
      updateConnectionState(peerUserId, 'error')
    }
  }

  // Handle SDP offer
  const handleSdpOffer = async (data: { user_id: string; sdp: RTCSessionDescriptionInit }) => {
    try {
      addDebugLog('handleSdpOffer called!', 'info')
      const { user_id, sdp } = data
      console.log(`📥 Received SDP offer from ${user_id}:`, sdp)

      const ensuredStream = await ensureLocalStream()
      addDebugLog(`SDP offer received from ${user_id}`, 'info', user_id)
      updateConnectionState(user_id, 'offer-received')

      let peerConnection = peerConnections.value.get(user_id)
      if (!peerConnection) {
        console.log(`🔗 Creating new peer connection for ${user_id}`)
        peerConnection = createPeerConnection(user_id)
      } else if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'closed') {
        console.log(`🔄 Closing failed peer connection for ${user_id} and creating new one`)
        peerConnection.close()
        peerConnections.value.delete(user_id)
        peerConnection = createPeerConnection(user_id)
      } else if (ensuredStream) {
        const hasAudioSender = peerConnection.getSenders().some((s) => s.track?.kind === 'audio')
        if (!hasAudioSender) {
          ensuredStream.getAudioTracks().forEach((track) => {
            peerConnection!.addTrack(track, ensuredStream)
          })
        }
      }

      updateConnectionState(user_id, 'setting-remote-desc')
      await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp))

      await processPendingIceCandidates(user_id)

      updateConnectionState(user_id, 'creating-answer')
      const answer = await peerConnection.createAnswer()

      updateConnectionState(user_id, 'setting-local-desc')
      await peerConnection.setLocalDescription(answer)

      wsService.sendMessage('sdp_answer', {
        target_user_id: user_id,
        user_id: getCurrentUserId(),
        sdp: answer
      })

      updateConnectionState(user_id, 'answer-sent')
      console.log(`📤 Sent SDP answer to ${user_id}:`, answer)
      addDebugLog(`SDP answer sent to ${user_id}`, 'info', user_id)
    } catch (error) {
      console.error('❌ Error handling SDP offer:', error, 'Data:', data)
      updateConnectionState(data.user_id, 'error')
    }
  }

  // Handle SDP answer
  const handleSdpAnswer = async (data: { user_id: string; sdp: RTCSessionDescriptionInit }) => {
    try {
      console.log(`📥 Received SDP answer:`, data)
      const { user_id, sdp } = data
      const peerConnection = peerConnections.value.get(user_id)

      if (!peerConnection) {
        console.warn(`⚠️ Received SDP answer for unknown peer: ${user_id}`)
        addDebugLog(`SDP answer for unknown peer: ${user_id}`, 'warning', user_id)
        return
      }

      console.log(`🔍 Found existing peer connection for ${user_id}, state: ${peerConnection.signalingState}`)

      if (peerConnection.signalingState === 'stable' && peerConnection.remoteDescription?.type === 'answer') {
        console.warn(`⚠️ Ignoring duplicate SDP answer for ${user_id} (already stable)`)
        addDebugLog(`Ignoring duplicate SDP answer for ${user_id} (already stable)`, 'warning', user_id)
        return
      }

      updateConnectionState(user_id, 'answer-received')
      await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp))

      await processPendingIceCandidates(user_id)

      // Note: Don't set 'handshake-complete' state - wait for actual connection state
      // from onconnectionstatechange which will be 'connected' when ready

      console.log(`✅ SDP answer processed for ${user_id}:`, sdp)
      addDebugLog(`SDP answer processed successfully for ${user_id}`, 'info', user_id)
    } catch (error) {
      console.error('❌ Error handling SDP answer:', error, 'Data:', data)
      updateConnectionState(data?.user_id || 'unknown', 'error')
      addDebugLog(`Error handling SDP answer: ${(error as Error).message}`, 'error', data?.user_id)
    }
  }

  // Handle room users update
  const handleRoomUsers = (users: RoomUser[]) => {
    console.log("handleRoomUsers called with " + users.length + " users")
    addDebugLog('handleRoomUsers called', 'info')
    const currentUserId = getCurrentUserId()
    const otherUsers = users.filter((user: RoomUser) => user.id !== currentUserId)

    console.log('Current users in room:', otherUsers)
    console.log('Current connections:', Array.from(peerConnections.value.keys()))
    addDebugLog(`Current users: ${otherUsers.length}, connections: ${peerConnections.value.size}`, 'info')

    // Update room users map
    const newUsers = new Map<string, RoomUser>()
    users.forEach((user: RoomUser) => {
      newUsers.set(user.id, user)
    })
    currentRoomUsers.value = newUsers

    // Update screen sharing states from room_users data
    users.forEach((user: RoomUser) => {
      if (!user) return

      const isSharing = user.is_screen_sharing
      const quality = user.screen_share_quality

      console.log("Processing user " + user.id + " is_screen_sharing: " + isSharing)

      if (isSharing) {
        userScreenShareStates.value.set(user.id, {
          isSharing: true,
          quality: quality || '1080p30'
        })
        addDebugLog(`User ${user.id} is screen sharing (${quality}) from room state`, 'info', user.id)
      } else {
        const prevState = userScreenShareStates.value.get(user.id)
        if (prevState?.isSharing) {
          userScreenShareStates.value.set(user.id, {
            isSharing: false,
            quality: '1080p30'
          })
        }
      }
    })

    // Set current user join time from server
    const currentUser = users.find((user: RoomUser) => user.id === currentUserId)
    if (currentUser && currentUserJoinTime.value === 0) {
      const joinedAt = currentUser.joined_at
      if (joinedAt) {
        currentUserJoinTime.value = new Date(joinedAt).getTime()
        console.log(`📅 Set current user join time from server: ${joinedAt}`)
        addDebugLog(`Set current user join time from server: ${joinedAt}`, 'info')
      }
    }

    // MESH TOPOLOGY LOGIC: Existing users offer to newer users
    const existingConnections = Array.from(peerConnections.value.keys())

    otherUsers.forEach(user => {
      const joinedAt = user.joined_at
      const userJoinTime = joinedAt ? new Date(joinedAt).getTime() : 0
      const alreadyConnected = existingConnections.includes(user.id)
      const shouldCreateOffer = currentUserJoinTime.value < userJoinTime && !alreadyConnected
      const userNickname = user.nickname || 'Unknown'
      console.log(`🔍 User ${user.id} (${userNickname}): joined at ${joinedAt}, should create offer: ${shouldCreateOffer}`)

      if (shouldCreateOffer) {
        console.log(`🔗 Creating connection with newer user ${user.id} (${userNickname})`)
        addDebugLog(`Creating connection with newer user ${user.id}`, 'info', user.id)
        void createOfferForUser(user.id)
        updateConnectionState(user.id, 'connecting')
      } else if (alreadyConnected) {
        console.log(`✅ Connection to ${user.id} already exists`)
      } else {
        console.log(`⏸️ Not creating connection to ${user.id} - user joined before us`)
        addDebugLog(`Not creating connection to ${user.id} - user joined before us`, 'info', user.id)
      }
    })

    // Find users who left
    const leftUserIds = existingConnections.filter(userId =>
      !users.some((user: RoomUser) => user.id === userId)
    )

    leftUserIds.forEach(userId => {
      console.log(`👋 User ${userId} left room, cleaning up connection`)
      cleanupPeerConnection(userId)
      // Actually remove from room users list and clear retry count
      currentRoomUsers.value.delete(userId)
      peerConnectionRetries.value.delete(userId)
      reconnectionInProgress.value.delete(userId)
    })
  }

  // Handle user left
  const handleUserLeft = (data: { user_id: string }) => {
    const { user_id } = data
    console.log(`User left: ${user_id}`)
    cleanupPeerConnection(user_id)
    // Actually remove from room users list and clear retry count
    currentRoomUsers.value.delete(user_id)
    peerConnectionRetries.value.delete(user_id)
    reconnectionInProgress.value.delete(user_id)
  }

  // Handle mute toggle from AudioStream
  const handleMuteToggle = (userId: string, isMuted: boolean) => {
    console.log(`🎤 Mute toggled for user ${userId}: ${isMuted ? 'muted' : 'unmuted'}`)
    remoteStreamMutes.value.set(userId, isMuted)

    const audioElement = document.getElementById(`audio-${userId}`) as HTMLAudioElement
    if (audioElement) {
      audioElement.muted = isMuted
    }
  }

  // Handle audio level from AudioStream
  const handleAudioLevel = (userId: string, level: number, isSpeaking: boolean) => {
    if (currentRoomUsers.value.has(userId)) {
      const user = currentRoomUsers.value.get(userId)
      if (user) {
        user.is_speaking = isSpeaking
        currentRoomUsers.value.set(userId, { ...user })
      }
    }
  }

  // Screen sharing methods
  const getDisplayMediaConstraints = (quality: ScreenShareQuality, audio: boolean): MediaStreamConstraints => {
    const constraints: MediaStreamConstraints = {
      video: true,
      audio: audio ? { echoCancellation: false, noiseSuppression: false } : false
    }

    if (quality !== 'source') {
      const videoConstraints: MediaTrackConstraints = {}

      switch (quality) {
        case '1080p60':
          videoConstraints.width = { ideal: 1920 }
          videoConstraints.height = { ideal: 1080 }
          videoConstraints.frameRate = { ideal: 60 }
          break
        case '1080p30':
          videoConstraints.width = { ideal: 1920 }
          videoConstraints.height = { ideal: 1080 }
          videoConstraints.frameRate = { ideal: 30 }
          break
        case '720p30':
          videoConstraints.width = { ideal: 1280 }
          videoConstraints.height = { ideal: 720 }
          videoConstraints.frameRate = { ideal: 30 }
          break
        case '360p30':
          videoConstraints.width = { ideal: 640 }
          videoConstraints.height = { ideal: 360 }
          videoConstraints.frameRate = { ideal: 30 }
          break
        case 'text':
          videoConstraints.width = { ideal: 1920 }
          videoConstraints.height = { ideal: 1080 }
          videoConstraints.frameRate = { ideal: 5 }
          break
      }

      constraints.video = videoConstraints
    }

    return constraints
  }

  const startScreenShare = async (quality: ScreenShareQuality, audio: boolean) => {
    try {
      const constraints = getDisplayMediaConstraints(quality, audio)

      const screenStream = await navigator.mediaDevices.getDisplayMedia(constraints)
      localScreenStream.value = screenStream

      const videoTracks = screenStream.getVideoTracks()
      if (videoTracks.length > 0) {
        const track = videoTracks[0]

        track.onended = () => {
          console.log("Track onended event triggered!")
          console.log('Screen share track ended (browser UI)')
          stopScreenShare()
        }

        const userId = getCurrentUserId()

        for (const [peerUserId, pc] of peerConnections.value.entries()) {
          try {
            pc.addTrack(track, screenStream)
            console.log(`🖥️ Added screen share track to peer ${peerUserId}`)
            addDebugLog(`Added screen share track to peer ${peerUserId}`, 'info', peerUserId)

            console.log(`🔄 Triggering renegotiation for screen share with peer ${peerUserId}`)
            addDebugLog(`Triggering renegotiation for screen share with peer ${peerUserId}`, 'info', peerUserId)

            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)

            wsService.sendMessage('sdp_offer', {
              target_user_id: peerUserId,
              user_id: userId,
              sdp: offer
            })

            console.log(`📤 Sent screen share renegotiation offer to ${peerUserId}`)
            addDebugLog(`Sent screen share renegotiation offer to ${peerUserId}`, 'info', peerUserId)

          } catch (error) {
            console.error(`Failed to add screen track or renegotiate with peer ${peerUserId}:`, error)
            addDebugLog(`Failed to add screen track to peer ${peerUserId}: ${(error as Error).message}`, 'error', peerUserId)
          }
        }
      }

      wsService.sendMessage('screen_share_start', {
        user_id: getCurrentUserId(),
        quality: quality,
        has_audio: audio
      } as ScreenShareData)

      isScreenSharing.value = true
      console.log('✅ Screen sharing started:', quality, audio ? 'with audio' : 'without audio')
      addDebugLog(`Screen sharing started: ${quality}${audio ? ' with audio' : ''}`, 'info')

    } catch (error) {
      console.error('❌ Failed to get display media:', error)
      addDebugLog(`Failed to start screen share: ${(error as Error).message}`, 'error')
      throw error
    }
  }

  const stopScreenShare = () => {
    console.log("stopScreenShare called, isScreenSharing: " + isScreenSharing.value)
    if (!isScreenSharing.value) return

    try {
      if (localScreenStream.value) {
        localScreenStream.value.getTracks().forEach(track => {
          track.stop()

          peerConnections.value.forEach((pc) => {
            const sender = pc.getSenders().find(s => s.track === track)
            if (sender) {
              try {
                pc.removeTrack(sender)
                console.log('🖥️ Removed screen share track from peer connection')
              } catch (error) {
                console.error('Failed to remove screen track:', error)
              }
            }
          })
        })

        localScreenStream.value = null
      }

      wsService.sendMessage('screen_share_stop', {
        user_id: getCurrentUserId()
      })

      isScreenSharing.value = false
      screenShareQuality.value = '1080p30'
      screenShareAudioEnabled.value = false

      console.log('✅ Screen sharing stopped')
      addDebugLog('Screen sharing stopped', 'info')

    } catch (error) {
      console.error('❌ Error stopping screen share:', error)
      addDebugLog(`Error stopping screen share: ${(error as Error).message}`, 'error')
    }
  }

  const handleScreenShareStart = (data: ScreenShareData) => {
    const { user_id, quality } = data
    console.log(`🖥️ User ${user_id} started screen sharing:`, quality)

    userScreenShareStates.value.set(user_id, {
      isSharing: true,
      quality: quality
    })

    addDebugLog(`User ${user_id} started screen sharing (${quality})`, 'info', user_id)
  }

  const handleScreenShareStop = (data: { user_id: string }) => {
    const { user_id } = data
    console.log(`🖥️ User ${user_id} stopped screen sharing`)

    userScreenShareStates.value.set(user_id, {
      isSharing: false,
      quality: '1080p30'
    })

    remoteScreenStreams.value.delete(user_id)

    addDebugLog(`User ${user_id} stopped screen sharing`, 'info', user_id)
  }

  const handleScreenShareTrack = (userId: string, stream: MediaStream) => {
    console.log(`🖥️ Received screen share stream from ${userId}:`, stream)
    remoteScreenStreams.value.set(userId, stream)
    console.log(`🖥️ Stored screen share stream for ${userId}`)
  }

  // Get connection quality
  const getConnectionQuality = (userId: string) => {
    return webRTCStatsCollector.getConnectionQuality(userId)
  }

  // Analyze ICE connection to determine if using TURN relay
  const analyzeConnection = async (userId: string): Promise<ICEConnectionType> => {
    const peerConnection = peerConnections.value.get(userId)
    if (!peerConnection) {
      return {
        type: 'unknown',
        usingTURN: false,
        localType: 'unknown',
        remoteType: 'unknown'
      }
    }
    return analyzeICEConnection(peerConnection)
  }

  // WebSocket message handlers (must be stable references)
  const onIceCandidateMessage = (message: WebSocketMessage) => {
    console.log('📨 Received ice_candidate message:', message)
    void handleIceCandidate(message.data as { user_id: string; candidate: RTCIceCandidateInit })
  }

  const onSdpOfferMessage = (message: WebSocketMessage) => {
    console.log('📨 Received sdp_offer message:', message)
    addDebugLog('WebSocket received sdp_offer', 'info')
    void handleSdpOffer(message.data as { user_id: string; sdp: RTCSessionDescriptionInit })
  }

  const onSdpAnswerMessage = (message: WebSocketMessage) => {
    void handleSdpAnswer(message.data as { user_id: string; sdp: RTCSessionDescriptionInit })
  }

  const onRoomUsersMessage = (message: WebSocketMessage) => {
    console.log('📨 Received room_users message:', message)
    handleRoomUsers(message.data as RoomUser[])
  }

  const onUserLeftMessage = (message: WebSocketMessage) => {
    handleUserLeft(message.data as { user_id: string })
  }

  const onSpeakingStatusMessage = () => {
    // TODO: Handle speaking status updates if needed
  }

  // Handle reconnection handshake request (Step 1/3)
  const onReconnectRequestMessage = (message: WebSocketMessage) => {
    const data = message.data as { user_id: string; target_user_id: string; request_time: number }
    const { user_id, request_time } = data
    
    console.log(`📨 Received reconnect_request from ${user_id} at ${request_time}`)
    
    // Check if we also sent a request (race condition)
    const ourRequestTime = reconnectionRequestTime.value.get(user_id)
    const ourState = reconnectionHandshakeState.value.get(user_id) || 'none'
    
    if (ourState === 'request_sent' && ourRequestTime) {
      // Both sides sent request simultaneously - tie-breaker needed
      if (ourRequestTime < request_time) {
        // We sent first, we win - ignore their request and wait for their ready
        console.log(`🤝 Race condition: We sent first (${ourRequestTime} < ${request_time}), waiting for their ready`)
        return
      } else if (ourRequestTime > request_time) {
        // They sent first, they win - abort our request and respond to theirs
        console.log(`🤝 Race condition: They sent first (${request_time} < ${ourRequestTime}), aborting our request and responding`)
        // Clear our request
        reconnectionHandshakeState.value.set(user_id, 'none')
        reconnectionRequestTime.value.delete(user_id)
        if (reconnectionTimers.value.has(user_id)) {
          clearTimeout(reconnectionTimers.value.get(user_id))
          reconnectionTimers.value.delete(user_id)
        }
        reconnectionInProgress.value.delete(user_id)
      } else {
        // Same timestamp (extremely unlikely) - tie-break with user ID
        if (getCurrentUserId() < user_id) {
          console.log(`🤝 Race condition: Same timestamp, we win by user ID`)
          return
        } else {
          console.log(`🤝 Race condition: Same timestamp, they win by user ID`)
          reconnectionHandshakeState.value.set(user_id, 'none')
          reconnectionRequestTime.value.delete(user_id)
        }
      }
    }
    
    // Step 2: Clean up and send reconnect_ready
    console.log(`🔄 Step 2/3: Cleaning up and sending reconnect_ready to ${user_id}`)
    cleanupPeerConnection(user_id)
    
    wsService.sendMessage('reconnect_ready', {
      target_user_id: user_id,
      user_id: getCurrentUserId()
    })
  }

  // Handle reconnection handshake ready (Step 2/3)
  const onReconnectReadyMessage = (message: WebSocketMessage) => {
    const data = message.data as { user_id: string; target_user_id: string }
    const { user_id } = data
    
    console.log(`📨 Received reconnect_ready from ${user_id}`)
    
    // Verify we're in the right state
    const currentState = reconnectionHandshakeState.value.get(user_id)
    if (currentState !== 'request_sent') {
      console.log(`⚠️ Unexpected reconnect_ready from ${user_id} (state: ${currentState}), ignoring`)
      return
    }
    
    // Step 3: Create offer with fresh TURN credentials
    console.log(`🔄 Step 3/3: Creating offer for ${user_id}`)
    reconnectionHandshakeState.value.set(user_id, 'ready_received')
    
    // Handle async operations
    void (async () => {
      try {
        // Refresh TURN credentials
        await fetchTURNConfig()
        
        // Create and send offer
        await createOfferForUser(user_id)
        
        console.log(`✅ Reconnection handshake completed for ${user_id}`)
      } catch (error) {
        console.error(`❌ Error creating offer during reconnection to ${user_id}:`, error)
      } finally {
        // Reset handshake state
        reconnectionHandshakeState.value.set(user_id, 'none')
        reconnectionRequestTime.value.delete(user_id)
        reconnectionInProgress.value.delete(user_id)
      }
    })()
  }

  const onScreenShareStartMessage = (message: WebSocketMessage) => {
    console.log('📨 Received screen_share_start message:', message)
    handleScreenShareStart(message.data as ScreenShareData)
  }

  const onScreenShareStopMessage = (message: WebSocketMessage) => {
    console.log('📨 Received screen_share_stop message:', message)
    handleScreenShareStop(message.data as { user_id: string })
  }

  // Ping tracking
  let pingInterval: ReturnType<typeof setInterval> | null = null
  const PING_INTERVAL = 3000

  const sendPing = () => {
    lastPingTime.value = Date.now()
    wsService.sendMessage('ping', {
      user_id: getCurrentUserId(),
      timestamp: lastPingTime.value
    })
  }

  const onPongMessage = (message: WebSocketMessage) => {
    const data = message.data as { timestamp: number }
    const now = Date.now()
    const ping = now - data.timestamp
    currentPing.value = ping

    let quality: 'excellent' | 'good' | 'fair' | 'poor' = 'excellent'
    if (ping < 30) {
      quality = 'excellent'
    } else if (ping < 60) {
      quality = 'good'
    } else if (ping < 100) {
      quality = 'fair'
    } else {
      quality = 'poor'
    }

    options.onPingUpdate(ping, quality)
  }

  // Fetch TURN server configuration from backend
  const fetchTURNConfig = async () => {
    try {
      addDebugLog('Fetching TURN server configuration...', 'info')
      const turnConfig = await apiService.getTurnConfig(getCurrentUserId())
      
      if (turnConfig.ice_servers && turnConfig.ice_servers.length > 0) {
        iceServers.value = turnConfig.ice_servers
        addDebugLog(`Loaded ${turnConfig.ice_servers.length} ICE servers (TTL: ${turnConfig.ttl}s)`, 'info')
        
        // Log TURN servers for debugging (without credentials)
        const turnServers = turnConfig.ice_servers.filter(s => 
          s.urls.some(url => url.startsWith('turn:') || url.startsWith('turns:'))
        )
        if (turnServers.length > 0) {
          addDebugLog(`Found ${turnServers.length} TURN server(s)`, 'info')
        }
      }
    } catch (error) {
      console.error('Failed to fetch TURN configuration:', error)
      addDebugLog('Failed to fetch TURN configuration, using default STUN servers', 'warning')
      // Keep default STUN servers on error
    }
  }

  // Initialize WebRTC
  const initializeWebRTC = async () => {
    // Fetch TURN configuration first
    await fetchTURNConfig()
    // Then get local media stream
    await ensureLocalStream()
  }

  // Apply mute state to local stream
  const applyMuteState = (muted: boolean) => {
    if (localStream.value) {
      localStream.value.getAudioTracks().forEach(track => {
        track.enabled = !muted
      })
    }
    wsService.sendMessage('speaking_status', {
      user_id: getCurrentUserId(),
      is_speaking: false,
      is_muted: muted
    })
  }

  // Apply deafen state to remote audio elements
  const applyDeafenState = (deafened: boolean) => {
    currentRoomUsers.value.forEach((user, userId) => {
      if (userId !== getCurrentUserId()) {
        const audioElement = document.getElementById(`audio-${userId}`) as HTMLAudioElement
        if (audioElement) {
          audioElement.muted = deafened
        }
      }
    })
  }

  // Computed screen share data for display
  const screenShareData = computed(() => {
    const shares: Array<{
      userId: string
      userNickname: string
      stream: MediaStream | null
      quality: ScreenShareQuality
      connectionState: string
      isSelfView?: boolean
    }> = []

    if (isScreenSharing.value && localScreenStream.value) {
      shares.push({
        userId: getCurrentUserId() + '-self',
        userNickname: 'Your Screen',
        stream: localScreenStream.value,
        quality: screenShareQuality.value,
        connectionState: 'self-view',
        isSelfView: true
      })
    }

    userScreenShareStates.value.forEach((state, userId) => {
      if (state.isSharing) {
        const user = currentRoomUsers.value.get(userId)
        shares.push({
          userId,
          userNickname: user?.nickname || userId,
          stream: remoteScreenStreams.value.get(userId) || null,
          quality: state.quality,
          connectionState: peerConnectionStates.value.get(userId) || 'connecting'
        })
      }
    })

    return shares
  })

  // Debug data for screen sharing
  const localScreenShareDebugData = computed(() => {
    if (!isScreenSharing.value || !localScreenStream.value) return []

    return [{
      userId: getCurrentUserId(),
      userNickname: 'You',
      stream: localScreenStream.value,
      quality: screenShareQuality.value,
      connectionState: 'connected'
    }]
  })

  const remoteScreenShareDebugData = computed(() => {
    const shares: Array<{
      userId: string
      userNickname: string
      stream: MediaStream | null
      quality: ScreenShareQuality
      connectionState: string
    }> = []

    userScreenShareStates.value.forEach((state, userId) => {
      if (state.isSharing) {
        const user = currentRoomUsers.value.get(userId)
        shares.push({
          userId,
          userNickname: user?.nickname || userId,
          stream: remoteScreenStreams.value.get(userId) || null,
          quality: state.quality,
          connectionState: peerConnectionStates.value.get(userId) || 'connecting'
        })
      }
    })

    return shares
  })

  // Lifecycle hooks
  onMounted(async () => {
    // Register WebSocket listeners FIRST
    wsService.on('ice_candidate', onIceCandidateMessage)
    wsService.on('sdp_offer', onSdpOfferMessage)
    wsService.on('sdp_answer', onSdpAnswerMessage)
    wsService.on('room_users', onRoomUsersMessage)
    wsService.on('user_left', onUserLeftMessage)
    wsService.on('speaking_status', onSpeakingStatusMessage)
    wsService.on('screen_share_start', onScreenShareStartMessage)
    wsService.on('screen_share_stop', onScreenShareStopMessage)
    wsService.on('pong', onPongMessage)
    wsService.on('reconnect_request', onReconnectRequestMessage)
    wsService.on('reconnect_ready', onReconnectReadyMessage)

    // Initialize WebRTC
    await initializeWebRTC()

    // Start ping interval
    pingInterval = setInterval(sendPing, PING_INTERVAL)
    sendPing()
  })

  onUnmounted(() => {
    // Clear ping interval
    if (pingInterval) {
      clearInterval(pingInterval)
      pingInterval = null
    }

    // Unregister WebSocket listeners
    wsService.off('ice_candidate', onIceCandidateMessage)
    wsService.off('sdp_offer', onSdpOfferMessage)
    wsService.off('sdp_answer', onSdpAnswerMessage)
    wsService.off('room_users', onRoomUsersMessage)
    wsService.off('user_left', onUserLeftMessage)
    wsService.off('speaking_status', onSpeakingStatusMessage)
    wsService.off('screen_share_start', onScreenShareStartMessage)
    wsService.off('screen_share_stop', onScreenShareStopMessage)
    wsService.off('pong', onPongMessage)
    wsService.off('reconnect_request', onReconnectRequestMessage)
    wsService.off('reconnect_ready', onReconnectReadyMessage)

    // Clean up all peer connections
    peerConnections.value.forEach((connection, userId) => {
      cleanupPeerConnection(userId)
    })

    // Clear all reconnection timers
    reconnectionTimers.value.forEach((timer) => {
      clearTimeout(timer)
    })
    reconnectionTimers.value.clear()
    reconnectionInProgress.value.clear()
    reconnectionHandshakeState.value.clear()
    reconnectionRequestTime.value.clear()

    // Clean up statistics collection
    webRTCStatsCollector.cleanup()

    // Clean up media streams
    if (localStream.value) {
      localStream.value.getTracks().forEach(track => {
        track.stop()
      })
    }

    if (localScreenStream.value) {
      localScreenStream.value.getTracks().forEach(track => {
        track.stop()
      })
    }

    // Clean up AudioWorklet processor
    disposeAudioWorkletProcessor()

    console.log('WebRTC cleanup completed')
  })

  // Reinitialize audio stream with new constraints when settings change
  const reinitializeAudioStream = async (): Promise<void> => {
    try {
      console.log('Reinitializing audio stream with new constraints...')
      addDebugLog('Reinitializing audio stream with new constraints', 'info')

      // Stop existing local stream
      if (localStream.value) {
        localStream.value.getTracks().forEach(track => {
          track.stop()
        })
        localStream.value = null
      }

      // Dispose AudioWorklet processor
      disposeAudioWorkletProcessor()

      // Reset the promise so ensureLocalStream will create a new one
      localStreamPromise = null

      // Get new stream with updated constraints
      const newStream = await ensureLocalStream()

      if (!newStream) {
        console.error('Failed to reinitialize audio stream')
        addDebugLog('Failed to reinitialize audio stream', 'error')
        return
      }

      // Replace tracks in all peer connections
      const audioTrack = newStream.getAudioTracks()[0]
      if (audioTrack) {
        for (const [userId, pc] of peerConnections.value.entries()) {
          const senders = pc.getSenders()
          const audioSender = senders.find(s => s.track?.kind === 'audio')

          if (audioSender) {
            await audioSender.replaceTrack(audioTrack)
            console.log(`Replaced audio track for peer ${userId}`)
            addDebugLog(`Replaced audio track for peer ${userId}`, 'info')
          } else {
            // If no audio sender exists, add the track
            pc.addTrack(audioTrack, newStream)
            console.log(`Added audio track to peer ${userId}`)
            addDebugLog(`Added audio track to peer ${userId}`, 'info')
          }
        }
      }

      console.log('Audio stream reinitialized successfully')
      addDebugLog('Audio stream reinitialized successfully', 'info')
    } catch (error) {
      console.error('Error reinitializing audio stream:', error)
      addDebugLog(`Error reinitializing audio stream: ${(error as Error).message}`, 'error')
    }
  }

  return {
    // State refs
    localStream,
    remoteStreams,
    peerConnections,
    peerConnectionStates,
    remoteStreamMutes,
    currentRoomUsers,
    isScreenSharing,
    screenShareQuality,
    screenShareAudioEnabled,
    localScreenStream,
    remoteScreenStreams,
    userScreenShareStates,
    currentPing,
    peerConnectionRetries,

    // Computed
    screenShareData,
    localScreenShareDebugData,
    remoteScreenShareDebugData,

    // Methods
    getCurrentUserId,
    ensureLocalStream,
    initializeWebRTC,
    fetchTURNConfig,
    cleanupPeerConnection,
    handleMuteToggle,
    handleAudioLevel,
    startScreenShare,
    stopScreenShare,
    getConnectionQuality,
    analyzeConnection,
    applyMuteState,
    applyDeafenState,
    addDebugLog,
    reinitializeAudioStream
  }
}
