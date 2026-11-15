import { computed, onBeforeUnmount, ref, watch } from "vue"
import { useConnectionStore, type ServerStatus } from "@/stores/connection"

// A fast first response never flashes the indicator.
const SHOW_DELAY_MS = 300

/** Debounced server status for the connection indicators. */
export function useConnectionStatusLabel() {
  const connection = useConnectionStore()
  const shownStatus = ref<ServerStatus>("online")
  let timer: ReturnType<typeof setTimeout> | null = null

  const clear = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  watch(
    () => connection.status,
    (status) => {
      clear()
      if (status === "online") {
        shownStatus.value = "online"
        return
      }
      // Switching between connecting and offline while visible is immediate.
      if (shownStatus.value !== "online") {
        shownStatus.value = status
        return
      }
      timer = setTimeout(() => {
        timer = null
        shownStatus.value = connection.status
      }, SHOW_DELAY_MS)
    },
    { immediate: true },
  )
  onBeforeUnmount(clear)

  const visible = computed(() => shownStatus.value !== "online")
  const label = computed(() =>
    shownStatus.value === "offline"
      ? "Offline, waiting for connection"
      : "Connecting to the server…",
  )

  return { visible, shownStatus, label }
}
