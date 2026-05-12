import { useAppStore } from "@/stores"

export function useCallControls() {
  const appStore = useAppStore()

  const handlePingUpdate = (
    ping: number,
    quality: "sub-wave" | "excellent" | "good" | "fair" | "poor",
  ) => {
    appStore.updateConnectionStatus(ping, quality)
  }

  return {
    handlePingUpdate,
  }
}
