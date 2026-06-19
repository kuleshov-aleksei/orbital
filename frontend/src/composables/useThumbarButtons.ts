import { watch } from "vue"
import { useCallStore, useUserStore, useRoomStore } from "@/stores"
import { setThumbarButtons, onThumbarButtonClick, isElectron } from "@/services/electron"
import { useSounds } from "@/services/sounds"
import { wsService } from "@/services/websocket"

export function useThumbarButtons() {
  if (!isElectron()) return

  const callStore = useCallStore()
  const userStore = useUserStore()
  const roomStore = useRoomStore()
  const { playMute, playUnmute, playDeafen, playUndeafen } = useSounds()

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

  const updateButtons = () => {
    if (roomStore.isInRoom) {
      setThumbarButtons({
        isMuted: callStore.isMuted,
        isDeafened: callStore.isDeafened,
      })
    } else {
      setThumbarButtons(null)
    }
  }

  watch(
    [() => callStore.isMuted, () => callStore.isDeafened, () => roomStore.isInRoom],
    updateButtons,
    {
      immediate: true,
    },
  )

  onThumbarButtonClick((action: string) => {
    if (action === "mute") {
      handleMuteToggle()
    } else if (action === "deafen") {
      handleDeafenToggle()
    }
  })
}
