import { onBeforeUnmount, watch } from "vue"
import { useCallStore } from "@/stores"
import { useMuteDeafenToggle } from "@/composables/useMuteDeafenToggle"
import {
  isCapacitor,
  onCallNotificationAction,
  setCallNotificationState,
} from "@/services/platform"
import { debugWarn } from "@/utils/debug"

/**
 * Mute/Deafen buttons on the Android ongoing call notification (the Android
 * counterpart of useThumbarButtons). The buttons go through useMuteDeafenToggle,
 * so permissions, sounds and presence sync match the in-app buttons. Call once
 * from App.vue; a no-op outside the Android app.
 */
export function useCallNotificationControls() {
  if (!isCapacitor()) return

  const callStore = useCallStore()
  const { toggleMute, toggleDeafen } = useMuteDeafenToggle()
  let disposed = false
  let removeListener: (() => void) | null = null

  const stopWatch = watch(
    [() => callStore.isMuted, () => callStore.isDeafened],
    ([muted, deafened]) => void setCallNotificationState({ muted, deafened }),
    { immediate: true },
  )

  onCallNotificationAction((action) => {
    if (action === "mute") toggleMute()
    else if (action === "deafen") toggleDeafen()
  })
    .then((remove) => {
      if (disposed) remove()
      else removeListener = remove
    })
    .catch((err) => debugWarn("[CallNotification] listener setup failed", err))

  onBeforeUnmount(() => {
    disposed = true
    stopWatch()
    removeListener?.()
  })
}
