<template>
  <div class="voice-call-view flex-1 flex flex-col">
    <!-- Room Header -->
    <header class="bg-gray-800 px-6 py-4 border-b border-gray-700">
      <div class="flex items-center justify-between">
        <div class="flex items-center">
          <button
            @click="$emit('leave-room')"
            class="mr-4 text-gray-400 hover:text-white transition-colors duration-200"
          >
            <PhArrowLeft class="w-5 h-5" />
          </button>
          <div>
            <h1 class="text-xl font-semibold text-white">{{ currentRoom?.name || 'Voice Room' }}</h1>
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
              :userId="user.id"
              :userNickname="user.nickname"
              :stream="remoteStreams.get(user.id)"
              :connectionState="peerConnectionStates.get(user.id)"
              :initialVolume="remoteStreamVolumes.get(user.id) || 80"
              @volume-change="handleVolumeChange"
              @mute-toggle="handleMuteToggle"
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
          :isMuted="isMuted"
          :isDeafened="isDeafened"
          :isScreenSharing="isScreenSharing"
          @toggle-mute="toggleMute"
          @toggle-deafen="toggleDeafen"
          @toggle-screen-share="toggleScreenShare"
          @leave-room="$emit('leave-room')"
        />
       </div>

       <!-- Debug Panel (Development) -->
       <div v-if="connectionInfo.length > 0" class="bg-gray-900 border-t border-gray-700 p-4">
         <div class="text-xs text-gray-400 mb-2">Connection Debug Info:</div>
         <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
           <div 
             v-for="info in connectionInfo" 
             :key="info.userId"
             class="bg-gray-800 rounded p-2 border border-gray-600"
           >
             <div class="text-xs text-gray-300">
               <div class="font-mono">{{ info.user?.nickname || info.userId }}</div>
               <div class="flex items-center mt-1">
                 <div class="w-2 h-2 rounded-full mr-2" 
                      :class="{
                        'bg-green-400': info.state === 'connected',
                        'bg-yellow-400': ['connecting', 'creating-offer', 'creating-answer'].includes(info.state),
                        'bg-red-400': info.state === 'failed' || info.state === 'error',
                        'bg-gray-400': ['disconnected', 'ice-failed'].includes(info.state)
                      }">
                 </div>
                 <span class="font-mono">{{ info.state }}</span>
               </div>
             </div>
           </div>
         </div>
       </div>
     </main>
   </div>
 </template>

<script setup lang="ts">
 import { computed, onMounted, onUnmounted, ref } from 'vue'
 import AudioControls from '@/components/AudioControls.vue'
 import AudioStream from '@/components/AudioStream.vue'
 import { wsService } from '@/services/websocket'
 import type { User, WebSocketMessage, IceCandidateData, SDPData } from '@/types'
 import { 
   PhArrowLeft, 
   PhGearSix, 
   PhMicrophoneSlash, 
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
const currentRoomUsers = ref<Map<string, any>>(new Map())
const maxRetries = 3

// Computed properties
const currentRoom = computed(() => {
  return {
    name: props.roomName || 'Voice Room',
    id: props.roomId
  }
})

const userCount = computed(() => props.users.length)

// Connection info for debugging
const connectionInfo = computed(() => {
  return Array.from(peerConnectionStates.value.entries()).map(([userId, state]) => ({
    userId,
    state,
    user: currentRoomUsers.value.get(userId)
  }))
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

 const handleWebSocketMessage = (message: WebSocketMessage) => {
   switch (message.type) {
     case 'ice_candidate':
       handleIceCandidate(message.data)
       break
     case 'sdp_offer':
       handleSdpOffer(message.data)
       break
     case 'sdp_answer':
       handleSdpAnswer(message.data)
       break
     case 'room_users':
       handleRoomUsers(message.data)
       break
     case 'user_left':
       handleUserLeft(message.data)
       break
   }
 }

 const handleIceCandidate = async (data: any) => {
   try {
     const { user_id, candidate } = data
     const peerConnection = peerConnections.value.get(user_id)
     
     if (!peerConnection) {
       console.warn(`⚠️ Received ICE candidate for unknown peer: ${user_id}`)
       return
     }
     
     await peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
     updateConnectionState(user_id, 'ice-candidate-added')
     console.log(`🧊 Added ICE candidate from ${user_id}:`, candidate)
   } catch (error) {
     console.error('❌ Error handling ICE candidate:', error, 'Data:', data)
     updateConnectionState(user_id, 'error')
   }
 }

 const handleSdpOffer = async (data: any) => {
   try {
     const { user_id, sdp } = data
     console.log(`📥 Received SDP offer from ${user_id}:`, sdp)
     updateConnectionState(user_id, 'offer-received')
     
     let peerConnection = peerConnections.value.get(user_id)
     if (!peerConnection) {
       console.log(`🔗 Creating new peer connection for ${user_id}`)
       peerConnection = createPeerConnection(user_id)
     }
     
     updateConnectionState(user_id, 'setting-remote-desc')
     await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp))
     
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
   } catch (error) {
     console.error('❌ Error handling SDP offer:', error, 'Data:', data)
     updateConnectionState(user_id, 'error')
   }
 }

 const handleSdpAnswer = async (data: any) => {
   try {
     const { user_id, sdp } = data
     const peerConnection = peerConnections.value.get(user_id)
     
     if (!peerConnection) {
       console.warn(`⚠️ Received SDP answer for unknown peer: ${user_id}`)
       return
     }
     
     updateConnectionState(user_id, 'answer-received')
     await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp))
     updateConnectionState(user_id, 'handshake-complete')
     
     console.log(`✅ SDP answer processed for ${user_id}:`, sdp)
   } catch (error) {
     console.error('❌ Error handling SDP answer:', error, 'Data:', data)
     updateConnectionState(user_id, 'error')
   }
 }

 const handleRoomUsers = (users: any[]) => {
   const currentUserId = getCurrentUserId()
   const otherUsers = users.filter((user: any) => user.id !== currentUserId)
   
   console.log('Current users in room:', otherUsers)
   
   // Update room users map
   const newUsers = new Map<string, any>()
   users.forEach((user: any) => {
     newUsers.set(user.id, user)
   })
   currentRoomUsers.value = newUsers
   
   // Find users who joined (new users not in current connections)
   const existingConnections = Array.from(peerConnections.value.keys())
   const newUserIds = otherUsers
     .filter((user: any) => !existingConnections.includes(user.id))
     .map((user: any) => user.id)
   
   // Create connections with new users
   newUserIds.forEach(userId => {
     const user = otherUsers.find((u: any) => u.id === userId)
     if (user) {
       console.log(`🔗 Creating connection with ${user.id} (${user.nickname})`)
       createOfferForUser(userId)
       updateConnectionState(userId, 'connecting')
     }
   })
   
   // Find users who left (connections that aren't in room anymore)
   const leftUserIds = existingConnections.filter(userId => 
     !users.some((user: any) => user.id === userId)
   )
   
   // Clean up connections to users who left
   leftUserIds.forEach(userId => {
     console.log(`👋 User ${userId} left room, cleaning up connection`)
     cleanupPeerConnection(userId)
   })
 }

 const handleUserLeft = (data: any) => {
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
     const peerConnection = createPeerConnection(userId)
     const offer = await peerConnection.createOffer()
     await peerConnection.setLocalDescription(offer)
     
     updateConnectionState(userId, 'creating-offer')
     
     wsService.sendMessage('sdp_offer', {
       target_user_id: userId,
       user_id: getCurrentUserId(),
       sdp: offer
     })
     
     updateConnectionState(userId, 'offer-sent')
     console.log(`✅ Created and sent offer to ${userId}:`, offer)
   } catch (error) {
     console.error('❌ Error creating offer:', error)
     updateConnectionState(userId, 'error')
   }
 }

 const createPeerConnection = (userId: string): RTCPeerConnection => {
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
     } else if (state === 'failed') {
       console.error(`❌ Connection with ${userId} failed`)
       handleConnectionFailure(userId)
     } else if (state === 'disconnected') {
       console.warn(`⚠️ Disconnected from ${userId}`)
       handleConnectionDisconnection(userId)
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

 const getCurrentUserId = (): string => {
   // Get current user ID from localStorage or generate new one
   return localStorage.getItem('orbital_user_id') || 'unknown-user'
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

// Lifecycle hooks
onMounted(async () => {
  await initializeWebRTC()
  
  // Listen for WebRTC signaling messages
  wsService.on('ice_candidate', handleWebSocketMessage)
  wsService.on('sdp_offer', handleWebSocketMessage)
  wsService.on('sdp_answer', handleWebSocketMessage)
  wsService.on('room_users', handleWebSocketMessage)
  wsService.on('user_left', handleWebSocketMessage)
})

onUnmounted(() => {
  // Clean up all peer connections and audio elements
  peerConnections.value.forEach((connection, userId) => {
    cleanupPeerConnection(userId)
  })
  
  // Clean up media stream
  if (localStream.value) {
    localStream.value.getTracks().forEach(track => {
      track.stop()
    })
  }
  
  console.log('WebRTC cleanup completed')
})
</script>