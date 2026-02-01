import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useCallStore = defineStore('call', () => {
  // State
  const isMuted = ref(false)
  const isDeafened = ref(false)
  const isScreenSharing = ref(false)

  // Actions
  function setMuted(muted: boolean) {
    isMuted.value = muted
  }

  function setDeafened(deafened: boolean) {
    isDeafened.value = deafened
  }

  function setScreenSharing(sharing: boolean) {
    isScreenSharing.value = sharing
  }

  function toggleMute() {
    isMuted.value = !isMuted.value
  }

  function toggleDeafen() {
    isDeafened.value = !isDeafened.value
  }

  function toggleScreenShare() {
    isScreenSharing.value = !isScreenSharing.value
  }

  function resetCallState() {
    isMuted.value = false
    isDeafened.value = false
    isScreenSharing.value = false
  }

  return {
    isMuted,
    isDeafened,
    isScreenSharing,
    setMuted,
    setDeafened,
    setScreenSharing,
    toggleMute,
    toggleDeafen,
    toggleScreenShare,
    resetCallState
  }
})
