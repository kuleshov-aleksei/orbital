import { ref, onUnmounted } from "vue"
import type { RoomStatsMessage, ClientStatsReport, ParticipantStatsData, StatsStatus } from "@/types"
import { apiService } from "@/services/api"

export interface ChartDataPoint {
  timestamp: number
  value: number
}

export interface ParticipantChartData {
  userId: string
  ping: ChartDataPoint[]
  bitrate: ChartDataPoint[]
  packetLoss: ChartDataPoint[]
  jitter: ChartDataPoint[]
}

export function useAdminStats() {
  const rooms = ref<{ id: string; name: string; user_count: number }[]>([])
  const activeRoomId = ref<string | null>(null)
  const statsEnabled = ref(false)
  const statsStatuses = ref<StatsStatus[]>([])
  const participants = ref<Record<string, ParticipantStatsData>>({})
  const loading = ref(false)
  const toggling = ref(false)
  const chartDataMap = ref<Map<string, ParticipantChartData>>(new Map())

  const loadRooms = async () => {
    try {
      const allRooms = await apiService.getRooms()
      rooms.value = allRooms.map((r) => ({
        id: r.id,
        name: r.name,
        user_count: r.user_count,
      }))
    } catch (error) {
      console.error("Failed to load rooms:", error)
    }
  }

  const loadStatsStatus = async () => {
    try {
      statsStatuses.value = await apiService.getStatsStatus()
    } catch (error) {
      console.error("Failed to load stats status:", error)
    }
  }

  const isRoomEnabled = (roomId: string): boolean => {
    return statsStatuses.value.some((s) => s.room_id === roomId && s.enabled)
  }

  const selectRoom = async (roomId: string) => {
    // Unsubscribe from previous room
    if (activeRoomId.value && activeRoomId.value !== roomId) {
      try {
        await apiService.unsubscribeRoomStats(activeRoomId.value)
      } catch {
        // Ignore errors on unsubscribe
      }
    }

    activeRoomId.value = roomId
    participants.value = {}
    chartDataMap.value = new Map()
    statsEnabled.value = isRoomEnabled(roomId)

    if (statsEnabled.value) {
      try {
        await apiService.subscribeRoomStats(roomId)
      } catch (error) {
        console.error("Failed to subscribe to room stats:", error)
      }
    }
  }

  const toggleStats = async (roomId: string) => {
    toggling.value = true
    try {
      const statuses = await apiService.getStatsStatus()
      const currentlyEnabled = statuses.some((s) => s.room_id === roomId && s.enabled)

      if (currentlyEnabled) {
        await apiService.disableRoomStats(roomId)
        await apiService.unsubscribeRoomStats(roomId)
        statsEnabled.value = false
        participants.value = {}
        chartDataMap.value = new Map()
      } else {
        await apiService.enableRoomStats(roomId)
        await apiService.subscribeRoomStats(roomId)
        statsEnabled.value = true
      }
      await loadStatsStatus()
    } catch (error) {
      console.error("Failed to toggle stats:", error)
    } finally {
      toggling.value = false
    }
  }

  const formatTimestamp = (ts: number): string => {
    const d = new Date(ts)
    return d.toLocaleTimeString()
  }

  const getConnectionTypeLabel = (report: ClientStatsReport): string => {
    const pairs = report.connection_stats?.ice_candidate_pairs
    if (!pairs || pairs.length === 0) return "N/A"

    const selected = pairs.find((p) => p.selected)
    if (!selected) return "Unknown"

    switch (selected.local_candidate_type) {
      case "host":
        return "P2P (Direct)"
      case "srflx":
        return "STUN (Server Reflexive)"
      case "relay":
        return "TURN (Relayed)"
      default:
        return selected.local_candidate_type
    }
  }

  onUnmounted(() => {
    if (activeRoomId.value) {
      apiService.unsubscribeRoomStats(activeRoomId.value).catch(() => {})
    }
  })

  return {
    rooms,
    activeRoomId,
    statsEnabled,
    statsStatuses,
    participants,
    chartDataMap,
    loading,
    toggling,
    loadRooms,
    loadStatsStatus,
    isRoomEnabled,
    selectRoom,
    toggleStats,
    formatTimestamp,
    getConnectionTypeLabel,
  }
}
