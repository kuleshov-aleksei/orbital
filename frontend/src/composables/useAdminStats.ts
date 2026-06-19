import { ref, onUnmounted } from "vue"
import type { ClientStatsBatch, StatsStatus } from "@/types"
import { apiService } from "@/services/api"
import { debugError } from "@/utils/debug"

export function useAdminStats() {
  const rooms = ref<{ id: string; name: string; user_count: number }[]>([])
  const activeRoomId = ref<string | null>(null)
  const statsEnabled = ref(false)
  const statsStatuses = ref<StatsStatus[]>([])
  const reports = ref<Record<string, ClientStatsBatch>>({})
  const loading = ref(false)
  const toggling = ref(false)

  const loadRooms = async () => {
    try {
      const allRooms = await apiService.getRooms()
      rooms.value = allRooms.map((r) => ({
        id: r.id,
        name: r.name,
        user_count: r.user_count,
      }))
    } catch (error) {
      debugError("Failed to load rooms:", error)
    }
  }

  const loadStatsStatus = async () => {
    try {
      statsStatuses.value = await apiService.getStatsStatus()
    } catch (error) {
      debugError("Failed to load stats status:", error)
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
    reports.value = {}
    statsEnabled.value = isRoomEnabled(roomId)

    if (statsEnabled.value) {
      try {
        await apiService.subscribeRoomStats(roomId)
      } catch (error) {
        debugError("Failed to subscribe to room stats:", error)
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
        reports.value = {}
      } else {
        await apiService.enableRoomStats(roomId)
        await apiService.subscribeRoomStats(roomId)
        statsEnabled.value = true
      }
      await loadStatsStatus()
    } catch (error) {
      debugError("Failed to toggle stats:", error)
    } finally {
      toggling.value = false
    }
  }

  const getReporterIds = (): string[] => {
    return Object.keys(reports.value)
  }

  const getLatestRtt = (reporterId: string): number => {
    const batch = reports.value[reporterId]
    return batch?.rtt ?? 0
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
    reports,
    loading,
    toggling,
    loadRooms,
    loadStatsStatus,
    isRoomEnabled,
    selectRoom,
    toggleStats,
    getReporterIds,
    getLatestRtt,
  }
}
