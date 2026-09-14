import { onMounted, onUnmounted } from "vue"
import { isElectron, onHotkeyTriggered } from "@/services/electron"
import { useCallStore, useRoomStore } from "@/stores"
import { useMuteDeafenToggle } from "@/composables/useMuteDeafenToggle"

export function useKeyboardShortcuts() {
  const callStore = useCallStore()
  const roomStore = useRoomStore()
  const { toggleMute, toggleDeafen } = useMuteDeafenToggle()

  let wasMutedBeforePTT = false

  const isInputFocused = (): boolean => {
    const activeElement = document.activeElement
    if (!activeElement) return false
    const tag = activeElement.tagName.toLowerCase()
    return tag === "input" || tag === "textarea" || (activeElement as HTMLElement).isContentEditable
  }

  const handleMuteToggle = () => {
    toggleMute()
  }

  const handleDeafenToggle = () => {
    toggleDeafen()
  }

  const handlePTTDown = () => {
    if (callStore.isMuted) {
      wasMutedBeforePTT = true
      callStore.setMuted(false)
    }
  }

  const handlePTTUp = () => {
    if (wasMutedBeforePTT) {
      callStore.setMuted(true)
      wasMutedBeforePTT = false
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (isElectron()) return
    if (isInputFocused()) return

    if (e.code === "KeyM") {
      e.preventDefault()
      handleMuteToggle()
    } else if (e.code === "KeyD") {
      if (roomStore.activeRoom?.type !== "spatial_audio") {
        e.preventDefault()
        handleDeafenToggle()
      }
    } else if (e.code === "Space") {
      e.preventDefault()
      handlePTTDown()
    }
  }

  const handleKeyUp = (e: KeyboardEvent) => {
    if (isElectron()) return

    if (e.code === "Space" && wasMutedBeforePTT) {
      e.preventDefault()
      handlePTTUp()
    }
  }

  onMounted(() => {
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)

    if (isElectron()) {
      onHotkeyTriggered((action: string) => {
        if (action === "mute") {
          handleMuteToggle()
        } else if (action === "deafen") {
          if (roomStore.activeRoom?.type !== "spatial_audio") {
            handleDeafenToggle()
          }
        } else if (action === "ptt-pressed") {
          if (callStore.isMuted) {
            handlePTTDown()
          } else {
            callStore.setMuted(true)
          }
        }
      })
    }
  })

  onUnmounted(() => {
    window.removeEventListener("keydown", handleKeyDown)
    window.removeEventListener("keyup", handleKeyUp)
  })

  return {
    handleMuteToggle,
    handleDeafenToggle,
  }
}
