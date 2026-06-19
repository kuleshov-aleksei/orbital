<template>
  <div class="space-y-4">
    <div class="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-lg font-semibold text-white">Stats Map</h2>
        <span class="text-sm text-gray-400">
          {{ enabledRoomsCount }} room{{ enabledRoomsCount !== 1 ? "s" : "" }} collecting
        </span>
      </div>
      <p class="text-sm text-gray-400 mb-4">
        Hover over an avatar to see per-pair connection metrics.
      </p>

      <div class="flex items-center gap-4">
        <div class="flex-1">
          <select
            v-model="statsRoomId"
            class="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:border-indigo-500 outline-none"
            @change="onStatsRoomChange">
            <option value="" disabled>Select a room...</option>
            <option v-for="room in adminStats.rooms.value" :key="room.id" :value="room.id">
              {{ room.name }} ({{ room.user_count }} user{{ room.user_count !== 1 ? "s" : "" }})
            </option>
          </select>
        </div>

        <button
          type="button"
          class="px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50"
          :class="toggleButtonClass"
          :disabled="!statsRoomId || adminStats.toggling.value"
          @click="onStatsToggle(statsRoomId)">
          <span v-if="adminStats.toggling.value">Processing...</span>
          <span v-else-if="adminStats.statsEnabled.value">Disable Stats</span>
          <span v-else>Enable Stats</span>
        </button>
      </div>
    </div>

    <div v-if="adminStats.statsEnabled.value && statsRoomId">
      <StatsMap :reports="adminStats.reports.value" :get-latest-rtt="adminStats.getLatestRtt" />
    </div>

    <div
      v-else-if="statsRoomId && !adminStats.statsEnabled.value"
      class="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
      <div class="text-gray-400">Stats collection is disabled for this room</div>
      <div class="text-gray-500 text-sm mt-1">
        Click "Enable Stats" above to start receiving connection metrics from participants.
      </div>
    </div>

    <div v-if="!statsRoomId" class="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
      <div class="text-gray-400">Select a room to get started</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue"
import { useAdminStats } from "@/composables/useAdminStats"
import StatsMap from "@/components/admin/StatsMap.vue"
import { wsService } from "@/services/websocket"
import type { RoomStatsMessage } from "@/types"

const adminStats = useAdminStats()
const statsRoomId = ref("")

const enabledRoomsCount = computed(
  () => adminStats.statsStatuses.value.filter((s) => s.enabled).length,
)

const toggleButtonClass = computed(() => {
  return adminStats.statsEnabled.value
    ? "bg-red-600 hover:bg-red-700 text-white"
    : "bg-indigo-600 hover:bg-indigo-700 text-white"
})

const handleRoomStatsMessage = (message: { type: string; data: unknown }) => {
  if (message.type === "room_stats") {
    const msg = message.data as RoomStatsMessage
    if (msg.room_id === statsRoomId.value) {
      adminStats.reports.value = msg.reports
    }
  }
}

onMounted(async () => {
  await Promise.all([adminStats.loadRooms(), adminStats.loadStatsStatus()])
  wsService.onGlobal("room_stats", handleRoomStatsMessage)
})

onUnmounted(() => {
  wsService.offGlobal("room_stats", handleRoomStatsMessage)
})

const onStatsRoomChange = async () => {
  if (statsRoomId.value) {
    await adminStats.selectRoom(statsRoomId.value)
  }
}

const onStatsToggle = async (roomId: string) => {
  await adminStats.toggleStats(roomId)
}
</script>
