import { onUnmounted } from "vue"
import { wsService } from "@/services/websocket"
import type { StatsControlCommand } from "@/types"

interface RemoteReporterControls {
  startRemoteReporting: (ws: typeof wsService, roomId: string, intervalMs: number) => void
  stopRemoteReporting: () => void
}

export function useRemoteStatsReporter(
  roomId: string,
  controls: RemoteReporterControls,
) {
  const handleEnableStats = (message: { type: string; data: unknown }) => {
    const data = message.data as StatsControlCommand
    if (data?.room_id === roomId && data?.action === "enable") {
      const interval = data.interval_ms || 15000
      controls.startRemoteReporting(wsService, roomId, interval)
    }
  }

  const handleDisableStats = (message: { type: string; data: unknown }) => {
    const data = message.data as StatsControlCommand
    if (data?.room_id === roomId && data?.action === "disable") {
      controls.stopRemoteReporting()
    }
  }

  // Register callbacks on the room WebSocket
  wsService.on("enable_stats_collection", handleEnableStats)
  wsService.on("disable_stats_collection", handleDisableStats)

  onUnmounted(() => {
    controls.stopRemoteReporting()
  })
}
