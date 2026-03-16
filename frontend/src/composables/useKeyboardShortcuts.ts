import { onMounted, onUnmounted } from "vue"
import { isElectron } from "@/services/electron"
import { useCallStore, useUserStore, useRoomStore } from "@/stores"
import { useSounds } from "@/services/sounds"
import { wsService } from "@/services/websocket"

export function useKeyboardShortcuts() {
  const callStore = useCallStore()
  const userStore = useUserStore()
  const roomStore = useRoomStore()
  const { playMute, playUnmute, playDeafen, playUndeafen } = useSounds()

  let wasMutedBeforePTT = false

  const isInputFocused = (): boolean => {
    const activeElement = document.activeElement
    if (!activeElement) return false
    const tag = activeElement.tagName.toLowerCase()
    return tag === "input" || tag === "textarea" || (activeElement as HTMLElement).isContentEditable
  }

  const handleMuteToggle = () => {
    const newValue = !callStore.isMuted
    callStore.setMuted(newValue)

    if (newValue) {
      playMute()
    } else {
      playUnmute()
    }

    const roomId = roomStore.activeRoomId
    if (roomId) {
      wsService.sendMuteState(roomId, newValue)
    }

    roomStore.updateUserStatus(userStore.userId, { is_muted: newValue })
  }

  const handleDeafenToggle = () => {
    const newValue = !callStore.isDeafened
    callStore.setDeafened(newValue)

    if (newValue) {
      playDeafen()
    } else {
      playUndeafen()
    }

    const roomId = roomStore.activeRoomId
    if (roomId) {
      wsService.sendDeafenState(roomId, newValue)
    }

    roomStore.updateUserStatus(userStore.userId, {
      is_deafened: newValue,
      is_muted: callStore.isMuted,
    })
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (isElectron()) return
    if (isInputFocused()) return

    if (e.code === "KeyM") {
      e.preventDefault()
      handleMuteToggle()
    } else if (e.code === "KeyD") {
      e.preventDefault()
      handleDeafenToggle()
    } else if (e.code === "Space") {
      e.preventDefault()
      if (callStore.isMuted) {
        wasMutedBeforePTT = true
        callStore.setMuted(false)
      }
    }
  }

  const handleKeyUp = (e: KeyboardEvent) => {
    if (isElectron()) return

    if (e.code === "Space" && wasMutedBeforePTT) {
      e.preventDefault()
      callStore.setMuted(true)
      wasMutedBeforePTT = false
    }
  }

  onMounted(() => {
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)
  })

  onUnmounted(() => {
    window.removeEventListener("keydown", handleKeyDown)
    window.removeEventListener("keyup", handleKeyUp)
  })
}
