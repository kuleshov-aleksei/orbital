<template>
  <div class="voice-call-view flex-1 flex flex-col" data-testid="voice-call-view">
    <!-- Room Header -->
    <header class="bg-gray-800 px-6 py-4 border-b border-gray-700">
      <div class="flex items-center justify-between">
        <div class="flex items-center">
           <button
             data-testid="leave-room-header"
             class="mr-4 text-gray-400 hover:text-white transition-colors duration-200"
             @click="$emit('leave-room')"
           >
             <PhArrowLeft class="w-5 h-5" />
           </button>
           <div>
             <h1 class="text-xl font-semibold text-white" data-testid="room-title">{{ currentRoom?.name || 'Voice Room' }}</h1>
             <p class="text-sm text-gray-400">{{ users.length }} users in room</p>
           </div>
        </div>
        
        <div class="flex items-center space-x-3">
          <!-- Connection Status -->
          <div class="flex items-center text-sm">
            <div class="w-2 h-2 bg-green-400 rounded-full mr-2"></div>
            <span class="text-gray-300">Connected</span>
          </div>
          
          <!-- Room Settings -->
          <button class="p-2 text-gray-400 hover:text-white transition-colors duration-200">
            <PhGearSix class="w-5 h-5" />
          </button>
        </div>
      </div>
    </header>

    <!-- Main Call Area -->
    <main class="flex-1 flex flex-col min-h-0 overflow-hidden">
      <!-- User Grid -->
      <div class="flex-1 p-4 lg:p-6 overflow-y-auto">
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
              :initial-volume="remoteStreamVolumes.get(user.id) || 80"
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
 import { wsService } from '@/services/websocket'
 import { webRTCStatsCollector } from '@/services/webrtc-stats'
 import type { User, RoomUser } from '@/types'
import { 
    PhArrowLeft, 
    PhGearSix, 
    PhMicrophone
  } from '@phosphor-icons/vue'

interface Props {
  roomId: string
  roomName: string
  users: User[]
}

const props = defineProps<Props>()
defineEmits<{
  'leave-room': []
}>()

// Local state
const peerConnections = ref<Map<string, RTCPeerConnection>>(new Map())
const peerConnectionStates = ref<Map<string, string>>(new Map())
const peerConnectionRetries = ref<Map<string, number>>(new Map())
const remoteStreams = ref<Map<string, MediaStream>>(new Map())
const remoteStreamVolumes = ref<Map<string, number>>(new Map())
 const remoteStreamMutes = ref<Map<string, boolean>>(new Map())
 const localStream = ref<MediaStream | null>(null)
 const isMuted = ref(false)
 const isDeafened = ref(false)
 const isScreenSharing = ref(false)
 const currentRoomUsers = ref<Map<string, RoomUser>>(new Map())
 const maxRetries = 3
 const debugDashboardRef = ref()
// Fix for ICE candidate race condition
const pendingIceCandidates = ref<Map<string, RTCIceCandidate[]>>(new Map())
// Track current user's join time (0 = not set yet)
const currentUserJoinTime = ref<number>(0)

// Computed properties
const currentRoom = computed(() => {
  return {
    name: props.roomName || 'Voice Room',
    id: props.roomId
  }
})



// WebRTC setup
const initializeWebRTC = async () => {
  try {
    // Get user media
    localStream.value = await navigator.mediaDevices.getUserMedia({ 
      audio: true, 
      video: false 
    })

    console.log('Local media stream obtained:', localStream.value)
  } catch (error) {
    console.error('Failed to get media stream:', error)
  }
}

  

 const handleIceCandidate = async (data: { user_id: string; candidate: RTCIceCandidateInit }) => {
    try {
      const { user_id, candidate } = data
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
      updateConnectionState(user_id, 'error')
    }
  }

  const handleSdpOffer = async (data: { user_id: string; sdp: string }) => {
     try {
       addDebugLog('handleSdpOffer called!', 'info')
       const { user_id, sdp } = data
       console.log(`📥 Received SDP offer from ${user_id}:`, sdp)
       // Add to debug logs
       addDebugLog(`SDP offer received from ${user_id}`, 'info', user_id)
       updateConnectionState(user_id, 'offer-received')
     
      let peerConnection = peerConnections.value.get(user_id)
      if (!peerConnection) {
        console.log(`🔗 Creating new peer connection for ${user_id}`)
        peerConnection = await createPeerConnection(user_id)
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

  const handleSdpAnswer = async (data: { user_id: string; sdp: string }) => {
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
      
       updateConnectionState(user_id, 'answer-received')
       await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp))
       
       // Process pending ICE candidates after remote description is set
       await processPendingIceCandidates(user_id)
       
       updateConnectionState(user_id, 'handshake-complete')
      
      console.log(`✅ SDP answer processed for ${user_id}:`, sdp)
      addDebugLog(`SDP answer processed successfully for ${user_id}`, 'info', user_id)
    } catch (error) {
      console.error('❌ Error handling SDP answer:', error, 'Data:', data)
      updateConnectionState(user_id, 'error')
      addDebugLog(`Error handling SDP answer: ${error.message}`, 'error', userId)
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
               await peerConnection.addIceCandidate(candidate)
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

    // Process any pending ICE candidates
    const pendingCandidates = pendingIceCandidates.value.get(userId)
    if (pendingCandidates && pendingCandidates.length > 0) {
      console.log(`🧊 Processing ${pendingCandidates.length} pending ICE candidates for ${userId}`)
      for (const candidate of pendingCandidates) {
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
          console.log(`🧊 Added pending ICE candidate for ${userId}:`, candidate)
        } catch (error) {
          console.error(`❌ Error adding pending ICE candidate for ${userId}:`, error)
        }
      }
      pendingIceCandidates.value.delete(userId)
    }

    peerConnections.value.set(userId, peerConnection)
    return peerConnection
 }

 const handleRemoteTrack = (userId: string, stream: MediaStream) => {
   try {
     console.log(`🎵 Received remote stream from ${userId}:`, stream)
     
     // Store the remote stream
     remoteStreams.value.set(userId, stream)
     
     // Initialize volume and mute state if not already set
     if (!remoteStreamVolumes.value.has(userId)) {
       remoteStreamVolumes.value.set(userId, 80) // Default volume
     }
     
     if (!remoteStreamMutes.value.has(userId)) {
       remoteStreamMutes.value.set(userId, false) // Default unmuted
     }
     
     console.log(`🎵 Stored remote stream for ${userId}, total streams: ${remoteStreams.value.size}`)
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
     remoteStreamVolumes.value.delete(userId)
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
   remoteStreamVolumes.value.set(userId, volume)
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
}

const toggleScreenShare = () => {
  isScreenSharing.value = !isScreenSharing.value
  console.log('Screen sharing:', isScreenSharing.value)
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



// Lifecycle hooks
onMounted(async () => {
  // Register WebSocket listeners FIRST, before initializing WebRTC
  wsService.on('ice_candidate', (message) => {
    console.log('📨 Received ice_candidate message:', message)
    handleIceCandidate(message.data)
  })
  wsService.on('sdp_offer', (message) => {
    console.log('📨 Received sdp_offer message:', message)
    addDebugLog('WebSocket received sdp_offer', 'info')
    handleSdpOffer(message.data)
  })
  wsService.on('sdp_answer', (message) => handleSdpAnswer(message.data))
  wsService.on('room_users', (message) => {
    console.log('📨 Received room_users message:', message)
    handleRoomUsers(message.data)
  })
  wsService.on('user_left', (message) => handleUserLeft(message.data))
  wsService.on('speaking_status', () => {
    // Handle speaking status updates if needed
  })
  
  // Now initialize WebRTC after listeners are ready
  await initializeWebRTC()
})

onUnmounted(() => {
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
  
  console.log('WebRTC cleanup completed')
})
</script>
