import { watch } from "vue"
import { useCallStore, useRoomStore } from "@/stores"
import { setThumbarButtons, onThumbarButtonClick, isElectron } from "@/services/electron"
import { useMuteDeafenToggle } from "@/composables/useMuteDeafenToggle"

export function useThumbarButtons() {
  if (!isElectron()) return

  const callStore = useCallStore()
  const roomStore = useRoomStore()
  const { toggleMute, toggleDeafen } = useMuteDeafenToggle()

  const handleMuteToggle = () => {
    toggleMute()
  }

  const handleDeafenToggle = () => {
    toggleDeafen()
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
