<template>
  <div class="voice-call-view flex-1 flex flex-col" data-testid="voice-call-view">
    <!-- Room Header -->
    <header class="bg-gray-800 px-6 py-4 border-b border-gray-700">
      <div class="flex items-center justify-between">
        <div class="flex items-center">
           <!-- Back to room list button (mobile only, doesn't leave room) -->
           <button
             v-if="isMobile"
             data-testid="back-to-rooms"
             class="mr-4 text-gray-400 hover:text-white transition-colors duration-200"
             title="Back to room list"
             @click="$emit('show-room-list')"
           >
             <PhArrowLeft class="w-5 h-5" />
           </button>
           
           <!-- Leave room button (desktop only) -->
           <button
             v-else
             data-testid="leave-room-header"
             class="mr-4 text-gray-400 hover:text-white transition-colors duration-200"
             @click="$emit('leave-room')"
           >
             <PhArrowLeft class="w-5 h-5" />
           </button>
           
           <div>
             <h1 
               class="text-xl font-semibold text-white cursor-pointer hover:text-indigo-400 transition-colors duration-200" 
               :class="{ 'cursor-pointer': isMobile }"
               data-testid="room-title"
               @click="isMobile && $emit('toggle-user-sidebar')"
             >
               {{ currentRoom?.name || 'Voice Room' }}
             </h1>
             <p class="text-sm text-gray-400">{{ users.length }} users in room</p>
           </div>
        </div>
        
        <div class="flex items-center space-x-3">
          <!-- Mobile: Users count button to toggle sidebar -->
          <button
            v-if="isMobile"
            class="flex items-center px-3 py-1.5 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors duration-200"
            @click="$emit('toggle-user-sidebar')"
          >
            <PhUsers class="w-4 h-4 mr-2" />
            <span class="text-sm">{{ users.length }}</span>
          </button>
          
          <!-- Desktop: Connection Status and Settings -->
          <template v-if="!isMobile">
            <div class="flex items-center text-sm">
              <div class="w-2 h-2 bg-green-400 rounded-full mr-2"></div>
              <span class="text-gray-300">Connected</span>
            </div>
            
            <button class="p-2 text-gray-400 hover:text-white transition-colors duration-200">
              <PhGearSix class="w-5 h-5" />
            </button>
          </template>
        </div>
      </div>
    </header>

    <!-- Screen Share Quality Modal -->
    <ScreenShareQualityModal
      :is-open="showQualityModal"
      @select-quality="handleQualitySelected"
      @cancel="showQualityModal = false"
    />

    <!-- Main Call Area -->
    <main class="flex-1 flex flex-col min-h-0 overflow-hidden">
      <!-- Screen Share Area -->
      <ScreenShareArea
        v-if="screenShareData.length > 0"
        :screen-shares="screenShareData"
        :is-user-grid-visible="isUserGridVisible"
        class="flex-shrink-0 m-4"
        @toggle-user-grid="isUserGridVisible = !isUserGridVisible"
      />

      <!-- User Grid -->
      <div
        v-show="isUserGridVisible || screenShareData.length === 0"
        class="flex-1 p-4 lg:p-6 overflow-y-auto"
      >
        <div v-if="users.length > 0" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-w-6xl mx-auto">
          <div
            v-for="user in users"
            :key="user.id"
            class="relative"
          >
            <AudioStream
              :user-id="user.id"
              :user-nickname="user.nickname"
              :stream="remoteStreams.get(user.id)"
              :connection-state="peerConnectionStates.get(user.id)"
              :initial-volume="props.remoteStreamVolumes.get(user.id) || 80"
              :is-deafened="isDeafened"
              :is-screen-sharing="userScreenShareStates.get(user.id)?.isSharing || false"
              :screen-share-quality="userScreenShareStates.get(user.id)?.quality"
              @volume-change="handleVolumeChange"
              @mute-toggle="handleMuteToggle"
              @audio-level="handleAudioLevel"
            />
          </div>
        </div>

         <!-- Empty State -->
         <div v-else class="flex items-center justify-center h-full">
           <div class="text-center">
             <div class="w-20 h-20 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
               <PhMicrophone class="w-10 h-10 text-gray-600" />
             </div>
             <h3 class="text-xl font-semibold text-white mb-2">Waiting for others...</h3>
             <p class="text-gray-400">You're the first one here. Invite some friends to join!</p>
           </div>
         </div>
        </div>

        <!-- Audio Controls -->
        <div class="bg-gray-800 border-t border-gray-700 px-6 py-4">
          <AudioControls 
            :is-muted="isMuted"
            :is-deafened="isDeafened"
            :is-screen-sharing="isScreenSharing"
            @toggle-mute="toggleMute"
            @toggle-deafen="toggleDeafen"
            @toggle-screen-share="toggleScreenShare"
            @leave-room="$emit('leave-room')"
          />
        </div>
      </main>
      
      <!-- Debug Dashboard -->
      <DebugDashboard
        ref="debugDashboardRef"
        :users="props.users"
        :peer-connections="peerConnections"
        :get-connection-quality="getConnectionQuality"
      />
  </div>
</template>

 <script setup lang="ts">
 import { computed, onMounted, onUnmounted, ref } from 'vue'
 import AudioControls from '@/components/AudioControls.vue'
 import AudioStream from '@/components/AudioStream.vue'
 import DebugDashboard from '@/components/DebugDashboard.vue'
 import ScreenShareArea from '@/components/ScreenShareArea.vue'
 import ScreenShareQualityModal from '@/components/ScreenShareQualityModal.vue'
 import { wsService } from '@/services/websocket'
 import { webRTCStatsCollector } from '@/services/webrtc-stats'
 import type { User, RoomUser, ScreenShareQuality, ScreenShareData } from '@/types'
import {
    PhArrowLeft,
    PhGearSix,
    PhMicrophone,
    PhUsers
  } from '@phosphor-icons/vue'

interface Props {
  roomId: string
  roomName: string
  users: User[]
  remoteStreamVolumes: Map<string, number>
  isMobile?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isMobile: false
})

const emit = defineEmits<{
  'leave-room': []
  'volume-change': [userId: string, volume: number]
  'show-room-list': []
  'toggle-user-sidebar': []
}>()

 // Reactive state
 const localStream = ref<MediaStream | null>(null)
 const remoteStreams = ref<Map<string, MediaStream>>(new Map())
 const peerConnections = ref<Map<string, RTCPeerConnection>>(new Map())
 const peerConnectionStates = ref<Map<string, string>>(new Map())
 const remoteStreamMutes = ref<Map<string, boolean>>(new Map())
   // Used to avoid getUserMedia races during offer/answer handling
   let localStreamPromise: Promise<MediaStream | null> | null = null
   const isMuted = ref(false)
   const isDeafened = ref(false)
   const isScreenSharing = ref(false)
   const screenShareQuality = ref<ScreenShareQuality>('1080p30')
   const screenShareAudioEnabled = ref(false)
   const localScreenStream = ref<MediaStream | null>(null)
   const remoteScreenStreams = ref<Map<string, MediaStream>>(new Map())
   const userScreenShareStates = ref<Map<string, { isSharing: boolean; quality: ScreenShareQuality }>>(new Map())
   const showQualityModal = ref(false)
   const isUserGridVisible = ref(true)
  const currentRoomUsers = ref<Map<string, RoomUser>>(new Map())
  const maxRetries = 3
  const debugDashboardRef = ref()
 // Fix for ICE candidate race condition
 const pendingIceCandidates = ref<Map<string, RTCIceCandidateInit[]>>(new Map())
 // Track current user's join time (0 = not set yet)
 const currentUserJoinTime = ref<number>(0)

// Computed properties
 const currentRoom = computed(() => {
   return {
     name: props.roomName || 'Voice Room',
     id: props.roomId
   }
 })

 // Build screen share data for ScreenShareArea component
 const screenShareData = computed(() => {
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



// WebRTC setup
const ensureLocalStream = async (): Promise<MediaStream | null> => {
  if (localStream.value) return localStream.value

  if (!localStreamPromise) {
    localStreamPromise = navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((stream) => {
        localStream.value = stream
        console.log('Local media stream obtained:', localStream.value)
        return stream
      })
      .catch((error) => {
        console.error('Failed to get media stream:', error)
        return null
      })
  }

  return await localStreamPromise
}

const initializeWebRTC = async () => {
  await ensureLocalStream()
}

  

 const handleIceCandidate = async (data: { user_id: string; candidate: RTCIceCandidateInit }) => {
     let peerUserId = 'unknown'
     try {
       const { user_id, candidate } = data
       peerUserId = user_id
       const peerConnection = peerConnections.value.get(user_id)
      
      if (!peerConnection) {
        console.warn(`⚠️ Received ICE candidate for unknown peer: ${user_id}, queuing candidate`)
        // Queue the candidate for when connection is created
        if (!pendingIceCandidates.value.has(user_id)) {
          pendingIceCandidates.value.set(user_id, [])
        }
        pendingIceCandidates.value.get(user_id)!.push(candidate)
        addDebugLog(`ICE candidate queued for unknown peer ${user_id}`, 'warning', user_id)
        return
      }
      
      // Only add candidate if remote description is set, otherwise queue it
      if (peerConnection.remoteDescription) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
        updateConnectionState(user_id, 'ice-candidate-added')
        console.log(`🧊 Added ICE candidate from ${user_id}:`, candidate)
        addDebugLog(`ICE candidate added from ${user_id}`, 'info', user_id)
      } else {
        // Queue candidate for when remote description is ready
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

  const handleSdpOffer = async (data: { user_id: string; sdp: RTCSessionDescriptionInit }) => {
      try {
        addDebugLog('handleSdpOffer called!', 'info')
        const { user_id, sdp } = data
        console.log(`📥 Received SDP offer from ${user_id}:`, sdp)

        // Ensure we have local tracks before answering, otherwise the answer becomes recvonly
        const ensuredStream = await ensureLocalStream()
        // Add to debug logs
        addDebugLog(`SDP offer received from ${user_id}`, 'info', user_id)
        updateConnectionState(user_id, 'offer-received')
     
       let peerConnection = peerConnections.value.get(user_id)
       if (!peerConnection) {
         console.log(`🔗 Creating new peer connection for ${user_id}`)
         peerConnection = await createPeerConnection(user_id)
       } else if (ensuredStream) {
         // If the PC existed before mic permission was granted, it may have no sender track.
         // Attach tracks before creating the answer so SDP is sendrecv.
         const hasAudioSender = peerConnection.getSenders().some((s) => s.track?.kind === 'audio')
         if (!hasAudioSender) {
           ensuredStream.getAudioTracks().forEach((track) => {
             peerConnection.addTrack(track, ensuredStream)
           })
         }
       }
     
     updateConnectionState(user_id, 'setting-remote-desc')
     await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp))
     
     // Process pending ICE candidates after remote description is set
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
     updateConnectionState(user_id, 'error')
    }
  }

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

       // Defensive: ignore duplicate answers (can happen if event handlers were registered twice)
       if (peerConnection.signalingState === 'stable' && peerConnection.remoteDescription?.type === 'answer') {
         console.warn(`⚠️ Ignoring duplicate SDP answer for ${user_id} (already stable)`)
         addDebugLog(`Ignoring duplicate SDP answer for ${user_id} (already stable)`, 'warning', user_id)
         return
       }
       
        updateConnectionState(user_id, 'answer-received')
        await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp))
       
       // Process pending ICE candidates after remote description is set
       await processPendingIceCandidates(user_id)
       
       updateConnectionState(user_id, 'handshake-complete')
      
      console.log(`✅ SDP answer processed for ${user_id}:`, sdp)
      addDebugLog(`SDP answer processed successfully for ${user_id}`, 'info', user_id)
     } catch (error) {
       console.error('❌ Error handling SDP answer:', error, 'Data:', data)
       updateConnectionState(data?.user_id || 'unknown', 'error')
       addDebugLog(`Error handling SDP answer: ${(error as Error).message}`, 'error', data?.user_id)
     }
   }

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
             addDebugLog(`Error adding pending ICE candidate: ${error.message}`, 'error', userId)
           }
         }
        pendingIceCandidates.value.delete(userId)
        addDebugLog(`Processed all pending ICE candidates for ${userId}`, 'info', userId)
      }
    }

   const handleRoomUsers = (users: RoomUser[]) => {
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
     
     // Set current user join time from server
     const currentUser = users.find((user: RoomUser) => user.id === currentUserId)
     if (currentUser && currentUserJoinTime.value === 0) {
       // Use joined_at field (snake_case) as that's what Go JSON sends
       currentUserJoinTime.value = new Date(currentUser.joined_at).getTime()
       console.log(`📅 Set current user join time from server: ${currentUser.joined_at}`)
       addDebugLog(`Set current user join time from server: ${currentUser.joined_at}`, 'info')
     }
     
     // MESH TOPOLOGY LOGIC: Existing users offer to newer users
     const existingConnections = Array.from(peerConnections.value.keys())
     
     otherUsers.forEach(user => {
        // Use joined_at field (snake_case) as that's what Go JSON sends
        const userJoinTime = new Date(user.joined_at).getTime()
        const alreadyConnected = existingConnections.includes(user.id)
        const shouldCreateOffer = currentUserJoinTime.value < userJoinTime && !alreadyConnected
        console.log(`🔍 User ${user.id} (${user.nickname}): joined at ${user.joined_at}, should create offer: ${shouldCreateOffer}`)
       
        console.log(`🔍 User ${user.id} (${user.nickname}): joined at ${user.joined_at}, should create offer: ${shouldCreateOffer}`)
       
       if (shouldCreateOffer) {
         console.log(`🔗 Creating connection with newer user ${user.id} (${user.nickname})`)
         addDebugLog(`Creating connection with newer user ${user.id}`, 'info', user.id)
         createOfferForUser(user.id)
         updateConnectionState(user.id, 'connecting')
       } else if (alreadyConnected) {
         console.log(`✅ Connection to ${user.id} already exists`)
       } else {
         console.log(`⏸️ Not creating connection to ${user.id} - user joined before us`)
         addDebugLog(`Not creating connection to ${user.id} - user joined before us`, 'info', user.id)
       }
     })
    
    // Find users who left (connections that aren't in room anymore)
    const leftUserIds = existingConnections.filter(userId => 
      !users.some((user: RoomUser) => user.id === userId)
    )
    
    // Clean up connections to users who left
    leftUserIds.forEach(userId => {
      console.log(`👋 User ${userId} left room, cleaning up connection`)
      cleanupPeerConnection(userId)
    })
  }

 const handleUserLeft = (data: { user_id: string }) => {
   const { user_id } = data
   console.log(`User left: ${user_id}`)
   cleanupPeerConnection(user_id)
 }

 const updateConnectionState = (userId: string, state: string) => {
   peerConnectionStates.value.set(userId, state)
   console.log(`🔄 Connection state for ${userId}: ${state}`)
 }

    const createOfferForUser = async (userId: string) => {
      try {
        addDebugLog(`Starting createOfferForUser for ${userId}`, 'info', userId)
        // Ensure local tracks exist before creating the offer (prevents recvonly/one-way media)
        await ensureLocalStream()
        const peerConnection = await createPeerConnection(userId)
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

  const createPeerConnection = async (userId: string): Promise<RTCPeerConnection> => {
   const configuration = {
     iceServers: [
       { urls: 'stun:stun.l.google.com:19302' },
       { urls: 'stun:stun1.l.google.com:19302' }
     ]
   }

   const peerConnection = new RTCPeerConnection(configuration)
   
    // Add local audio tracks to the peer connection
    if (localStream.value) {
      localStream.value.getAudioTracks().forEach(track => {
        peerConnection.addTrack(track, localStream.value!)
      })
    }
   
   // Handle ICE candidates
   peerConnection.onicecandidate = (event) => {
     if (event.candidate) {
        webRTCStatsCollector.saveOutgoingIceCandidate(userId, event.candidate);
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
        // Reset retry counter on successful connection
        peerConnectionRetries.value.set(userId, 0)
        // Start statistics collection when connection is established
        webRTCStatsCollector.startCollection(userId, peerConnection)
        console.log(`📊 Started stats collection for ${userId}`)
      } else if (state === 'failed') {
        console.error(`❌ Connection with ${userId} failed`)
        handleConnectionFailure(userId)
      } else if (state === 'disconnected') {
        console.warn(`⚠️ Disconnected from ${userId}`)
        handleConnectionDisconnection(userId)
      } else if (state === 'closed') {
        // Stop statistics collection when connection is closed
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
       // Could implement reconnection logic here
       updateConnectionState(userId, 'ice-failed')
     }
   }

   // Handle ICE gathering state
   peerConnection.onicegatheringstatechange = () => {
     console.log(`🧊 ICE gathering state with ${userId}:`, peerConnection.iceGatheringState)
   }

   // Handle remote tracks (when user sends their audio)
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

  const handleRemoteTrack = (userId: string, stream: MediaStream) => {
    try {
      console.log(`🎵 Received remote stream from ${userId}:`, stream)
      
      // Check if this is a screen share stream (has video track but no audio)
      // or an audio stream (has audio track)
      const hasVideo = stream.getVideoTracks().length > 0
      const hasAudio = stream.getAudioTracks().length > 0
      
      if (hasVideo) {
        // This is a screen share stream
        handleScreenShareTrack(userId, stream)
        console.log(`🖥️ Stored screen share stream for ${userId}`)
      }
      
      if (hasAudio || !hasVideo) {
        // This is an audio stream (or default if no video)
        remoteStreams.value.set(userId, stream)
        
        // Initialize volume and mute state if not already set
        if (!props.remoteStreamVolumes.has(userId)) {
          emit('volume-change', userId, 80) // Default volume
        }
        
        if (!remoteStreamMutes.value.has(userId)) {
          remoteStreamMutes.value.set(userId, false) // Default unmuted
        }
        
        console.log(`🎵 Stored audio stream for ${userId}, total streams: ${remoteStreams.value.size}`)
      }
    } catch (error) {
      console.error('❌ Error handling remote track:', error)
    }
  }

 const handleConnectionFailure = (userId: string) => {
   const currentRetries = peerConnectionRetries.value.get(userId) || 0
   
   if (currentRetries < maxRetries) {
     console.log(`🔄 Retrying connection to ${userId} (${currentRetries + 1}/${maxRetries})`)
     peerConnectionRetries.value.set(userId, currentRetries + 1)
     
     // Clean up failed connection
     cleanupPeerConnection(userId)
     
     // Wait before retrying (exponential backoff)
     const delay = Math.pow(2, currentRetries) * 1000
     setTimeout(() => {
       if (currentRoomUsers.value.has(userId)) {
         createOfferForUser(userId)
       }
     }, delay)
   } else {
     console.error(`❌ Max retries reached for ${userId}, giving up`)
     cleanupPeerConnection(userId)
   }
 }

 const handleConnectionDisconnection = (userId: string) => {
   // Check if user is still in room
   if (currentRoomUsers.value.has(userId)) {
     console.log(`🔄 User ${userId} still in room, attempting reconnection`)
     // Attempt reconnection after a short delay
     setTimeout(() => {
       if (currentRoomUsers.value.has(userId)) {
         createOfferForUser(userId)
       }
     }, 2000)
   } else {
     console.log(`🧹 User ${userId} left room, cleaning up`)
     cleanupPeerConnection(userId)
   }
 }

  const cleanupPeerConnection = (userId: string) => {
    try {
      console.log(`🧹 Starting cleanup for peer ${userId}`)
      
      // Stop statistics collection
      webRTCStatsCollector.stopCollection(userId)
      
      const peerConnection = peerConnections.value.get(userId)
      if (peerConnection) {
        peerConnection.close()
        peerConnections.value.delete(userId)
      }
     
     // Remove audio element
     const audioElement = document.getElementById(`audio-${userId}`)
     if (audioElement) {
       audioElement.remove()
     }
     
     // Clean up remote stream data
     remoteStreams.value.delete(userId)
     remoteStreamMutes.value.delete(userId)
     
     // Remove from connection states and room users
     peerConnectionStates.value.delete(userId)
     peerConnectionRetries.value.delete(userId)
     currentRoomUsers.value.delete(userId)
     
     console.log(`✅ Cleaned up peer connection and audio for ${userId}`)
   } catch (error) {
     console.error('❌ Error cleaning up peer connection:', error)
   }
 }

 const handleVolumeChange = (userId: string, volume: number) => {
   console.log(`🔊 Volume changed for user ${userId}: ${volume}`)
   emit('volume-change', userId, volume)
 }

const handleMuteToggle = (userId: string, isMuted: boolean) => {
  console.log(`🎤 Mute toggled for user ${userId}: ${isMuted ? 'muted' : 'unmuted'}`)
  remoteStreamMutes.value.set(userId, isMuted)
  
  // Update audio element if it exists
  const audioElement = document.getElementById(`audio-${userId}`) as HTMLAudioElement
  if (audioElement) {
    audioElement.muted = isMuted
  }
}

const handleAudioLevel = (userId: string, level: number, isSpeaking: boolean) => {
  // Update user in currentRoomUsers if exists
  if (currentRoomUsers.value.has(userId)) {
    const user = currentRoomUsers.value.get(userId)
    if (user) {
      user.is_speaking = isSpeaking
      currentRoomUsers.value.set(userId, { ...user })
    }
  }
}

const getCurrentUserId = (): string => {
  // Get current user ID from localStorage or generate new one
  let userId = localStorage.getItem('orbital_user_id')
  if (!userId) {
    userId = 'user_' + Math.random().toString(36).substr(2, 12)
    localStorage.setItem('orbital_user_id', userId)
    console.log('Generated new user ID:', userId)
  }
  return userId
}

const toggleMute = () => {
  isMuted.value = !isMuted.value
  if (localStream.value) {
    localStream.value.getAudioTracks().forEach(track => {
      track.enabled = !isMuted.value
    })
  }
  
  // Notify others of mute status
  wsService.sendMessage('speaking_status', {
    user_id: getCurrentUserId(),
    is_speaking: false,
    is_muted: isMuted.value
  })
}

const toggleDeafen = () => {
  isDeafened.value = !isDeafened.value
  console.log('Deafen status:', isDeafened.value)
  
  // Mute/unmute all incoming audio streams when deafened
  currentRoomUsers.value.forEach((user, userId) => {
    if (userId !== getCurrentUserId()) {
      const audioElement = document.getElementById(`audio-${userId}`) as HTMLAudioElement
      if (audioElement) {
        audioElement.muted = isDeafened.value
      }
    }
  })
}

const toggleScreenShare = () => {
  if (isScreenSharing.value) {
    // Stop screen sharing
    stopScreenShare()
  } else {
    // Open quality selection modal
    showQualityModal.value = true
  }
}

const handleQualitySelected = async (quality: ScreenShareQuality, shareAudio: boolean) => {
  showQualityModal.value = false
  screenShareQuality.value = quality
  screenShareAudioEnabled.value = shareAudio
  
  try {
    await startScreenShare(quality, shareAudio)
  } catch (error) {
    console.error('Failed to start screen share:', error)
    addDebugLog(`Failed to start screen share: ${(error as Error).message}`, 'error')
  }
}

const getDisplayMediaConstraints = (quality: ScreenShareQuality, audio: boolean): MediaStreamConstraints => {
  const constraints: MediaStreamConstraints = {
    video: true,
    audio: audio ? { echoCancellation: false, noiseSuppression: false } : false
  }
  
  // Apply quality constraints
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
    
    // Get screen share stream
    const screenStream = await navigator.mediaDevices.getDisplayMedia(constraints)
    localScreenStream.value = screenStream
    
    // Add video tracks to all existing peer connections
    const videoTracks = screenStream.getVideoTracks()
    if (videoTracks.length > 0) {
      const track = videoTracks[0]
      
      // Listen for the 'ended' event (when user stops sharing via browser UI)
      track.onended = () => {
        console.log('Screen share track ended (browser UI)')
        stopScreenShare()
      }
      
      // Add track to all peer connections
      peerConnections.value.forEach((pc, userId) => {
        try {
          pc.addTrack(track, screenStream)
          console.log(`🖥️ Added screen share track to peer ${userId}`)
          addDebugLog(`Added screen share track to peer ${userId}`, 'info', userId)
        } catch (error) {
          console.error(`Failed to add screen track to peer ${userId}:`, error)
        }
      })
    }
    
    // Send screen_share_start message via WebSocket
    const userId = getCurrentUserId()
    wsService.sendMessage('screen_share_start', {
      user_id: userId,
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
  if (!isScreenSharing.value) return
  
  try {
    // Stop all tracks in the local screen stream
    if (localScreenStream.value) {
      localScreenStream.value.getTracks().forEach(track => {
        track.stop()
        
        // Remove track from all peer connections
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
    
    // Send screen_share_stop message via WebSocket
    const userId = getCurrentUserId()
    wsService.sendMessage('screen_share_stop', {
      user_id: userId
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
  
  // Update user's screen share state
  userScreenShareStates.value.set(user_id, {
    isSharing: true,
    quality: quality
  })
  
  addDebugLog(`User ${user_id} started screen sharing (${quality})`, 'info', user_id)
}

const handleScreenShareStop = (data: { user_id: string }) => {
  const { user_id } = data
  console.log(`🖥️ User ${user_id} stopped screen sharing`)
  
  // Update user's screen share state
  userScreenShareStates.value.set(user_id, {
    isSharing: false,
    quality: '1080p30'
  })
  
  // Clean up remote screen stream
  remoteScreenStreams.value.delete(user_id)
  
  addDebugLog(`User ${user_id} stopped screen sharing`, 'info', user_id)
}

const handleScreenShareTrack = (userId: string, stream: MediaStream) => {
  console.log(`🖥️ Received screen share stream from ${userId}:`, stream)
  
  // Store the remote screen stream
  remoteScreenStreams.value.set(userId, stream)
  
  console.log(`🖥️ Stored screen share stream for ${userId}`)
}

// Statistics methods


const getConnectionQuality = (userId: string) => {
  return webRTCStatsCollector.getConnectionQuality(userId)
}

// Debug logging function
const addDebugLog = (message: string, level: 'info' | 'warning' | 'error' = 'info', userId?: string) => {
  if (debugDashboardRef.value && debugDashboardRef.value.addLog) {
    debugDashboardRef.value.addLog(message, level, userId)
  }
  console.log(`[${level.toUpperCase()}]${userId ? ' [' + userId + ']' : ''}: ${message}`)
}



// WebSocket handlers must be stable references so we can unregister them.
const onIceCandidateMessage = (message: WebSocketMessage) => {
  console.log('📨 Received ice_candidate message:', message)
  handleIceCandidate(message.data)
}
const onSdpOfferMessage = (message: WebSocketMessage) => {
  console.log('📨 Received sdp_offer message:', message)
  addDebugLog('WebSocket received sdp_offer', 'info')
  handleSdpOffer(message.data)
}
const onSdpAnswerMessage = (message: WebSocketMessage) => handleSdpAnswer(message.data)
const onRoomUsersMessage = (message: WebSocketMessage) => {
  console.log('📨 Received room_users message:', message)
  handleRoomUsers(message.data)
}
const onUserLeftMessage = (message: WebSocketMessage) => handleUserLeft(message.data)
const onSpeakingStatusMessage = () => {
  // TODO: Handle speaking status updates if needed
}
const onScreenShareStartMessage = (message: WebSocketMessage) => {
  console.log('📨 Received screen_share_start message:', message)
  handleScreenShareStart(message.data as ScreenShareData)
}
const onScreenShareStopMessage = (message: WebSocketMessage) => {
  console.log('📨 Received screen_share_stop message:', message)
  handleScreenShareStop(message.data as { user_id: string })
}

// Lifecycle hooks
onMounted(async () => {
  // Register WebSocket listeners FIRST, before initializing WebRTC
  wsService.on('ice_candidate', onIceCandidateMessage)
  wsService.on('sdp_offer', onSdpOfferMessage)
  wsService.on('sdp_answer', onSdpAnswerMessage)
  wsService.on('room_users', onRoomUsersMessage)
  wsService.on('user_left', onUserLeftMessage)
  wsService.on('speaking_status', onSpeakingStatusMessage)
  wsService.on('screen_share_start', onScreenShareStartMessage)
  wsService.on('screen_share_stop', onScreenShareStopMessage)

  // Now initialize WebRTC after listeners are ready
  await initializeWebRTC()
})

onUnmounted(() => {
  // Unregister WebSocket listeners to prevent duplicate signaling after re-join.
  wsService.off('ice_candidate', onIceCandidateMessage)
  wsService.off('sdp_offer', onSdpOfferMessage)
  wsService.off('sdp_answer', onSdpAnswerMessage)
  wsService.off('room_users', onRoomUsersMessage)
  wsService.off('user_left', onUserLeftMessage)
  wsService.off('speaking_status', onSpeakingStatusMessage)
  wsService.off('screen_share_start', onScreenShareStartMessage)
  wsService.off('screen_share_stop', onScreenShareStopMessage)

  // Clean up all peer connections and audio elements
  peerConnections.value.forEach((connection, userId) => {
    cleanupPeerConnection(userId)
  })

  // Clean up all statistics collection
  webRTCStatsCollector.cleanup()

  // Clean up media stream
  if (localStream.value) {
    localStream.value.getTracks().forEach(track => {
      track.stop()
    })
  }

  // Clean up screen share stream
  if (localScreenStream.value) {
    localScreenStream.value.getTracks().forEach(track => {
      track.stop()
    })
  }

  console.log('WebRTC cleanup completed')
})
</script>
