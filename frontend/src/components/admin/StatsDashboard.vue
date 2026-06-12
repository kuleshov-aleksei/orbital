<template>
  <div class="space-y-4">
    <!-- Room Selector & Controls -->
    <div class="bg-gray-800 rounded-lg border border-gray-700">
      <div class="p-4 border-b border-gray-700">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold text-white">Remote Stats Collection</h2>

          <div class="flex items-center gap-3">
            <span class="text-sm text-gray-400">
              {{ enabledRoomsCount }} room{{ enabledRoomsCount !== 1 ? "s" : "" }} collecting
            </span>
          </div>
        </div>

        <p class="text-sm text-gray-400 mt-1">
          Select a room and enable stats collection to view real-time connection metrics from all
          participants.
        </p>
      </div>

      <div class="p-4 flex items-center gap-4">
        <div class="flex-1">
          <label class="block text-sm text-gray-400 mb-1">Room</label>

          <select
            v-model="selectedRoomId"
            class="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:border-indigo-500 outline-none"
            @change="onRoomChange">
            <option value="" disabled>Select a room...</option>
            <option
              v-for="room in rooms"
              :key="room.id"
              :value="room.id">
              {{ room.name }} ({{ room.user_count }} user{{ room.user_count !== 1 ? "s" : "" }})
            </option>
          </select>
        </div>

        <div class="pt-5">
          <button
            type="button"
            class="px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50"
            :class="
              isCollecting
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white'
            "
            :disabled="!selectedRoomId || toggling"
            @click="onToggle">
            <span v-if="toggling">Processing...</span>
            <span v-else-if="isCollecting">Disable Stats</span>
            <span v-else>Enable Stats</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Stats Dashboard -->
    <div v-if="isCollecting && selectedRoomId">
      <!-- Participant Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div
          v-for="(pData, userId) in participants"
          :key="userId"
          class="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <div class="flex items-center gap-3 mb-3">
            <UserAvatar
              :user-id="userId"
              :size="32"
              :show-status="false" />

            <div class="min-w-0">
              <div class="text-sm font-medium text-white truncate">
                {{ getUserDisplay(userId).nickname }}
              </div>

              <div class="text-xs text-gray-400">ID: {{ userId.slice(0, 12) }}...</div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2 text-sm">
            <div class="bg-gray-700/50 rounded p-2">
              <div class="text-gray-400 text-xs">Ping</div>
              <div class="text-white font-mono">{{ getLastPing(pData) }}ms</div>
            </div>

            <div class="bg-gray-700/50 rounded p-2">
              <div class="text-gray-400 text-xs">Bitrate</div>
              <div class="text-white font-mono">{{ formatBitrate(getLastBitrate(pData)) }}</div>
            </div>

            <div class="bg-gray-700/50 rounded p-2">
              <div class="text-gray-400 text-xs">Packet Loss</div>
              <div class="text-white font-mono">{{ getLastPacketLoss(pData) }}%</div>
            </div>

            <div class="bg-gray-700/50 rounded p-2">
              <div class="text-gray-400 text-xs">Jitter</div>
              <div class="text-white font-mono">{{ getLastJitter(pData) }}ms</div>
            </div>

            <div class="bg-gray-700/50 rounded p-2">
              <div class="text-gray-400 text-xs">Codec</div>
              <div class="text-white font-mono text-xs">{{ getLastCodec(pData) || "N/A" }}</div>
            </div>

            <div class="bg-gray-700/50 rounded p-2">
              <div class="text-gray-400 text-xs">Last Report</div>
              <div class="text-white font-mono text-xs">{{ formatReportTime(pData) }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div
        v-if="Object.keys(participants).length === 0"
        class="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
        <div class="text-gray-400">Waiting for stats reports...</div>
        <div class="text-gray-500 text-sm mt-1">
          Participants will appear here once they send their first report (up to 15 seconds).
        </div>
      </div>

      <!-- Charts -->
      <div
        v-for="(chart, userId) in chartData"
        :key="userId"
        class="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <h3 class="text-sm font-medium text-white mb-3">
          {{ getUserDisplay(userId).nickname }} — Metrics
        </h3>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div class="bg-gray-700/30 rounded p-3">
            <h4 class="text-xs text-gray-400 mb-2">Ping (ms) over time</h4>
            <LineChart
              v-if="chart.ping.length > 1"
              :data="makeChartData(chart.ping, 'Ping (ms)', '#22c55e')"
              :height="120" />
            <div v-else class="text-xs text-gray-500 py-6 text-center">Waiting for data...</div>
          </div>

          <div class="bg-gray-700/30 rounded p-3">
            <h4 class="text-xs text-gray-400 mb-2">Bitrate (bps) over time</h4>
            <LineChart
              v-if="chart.bitrate.length > 1"
              :data="makeChartData(chart.bitrate, 'Bitrate', '#3b82f6')"
              :height="120" />
            <div v-else class="text-xs text-gray-500 py-6 text-center">Waiting for data...</div>
          </div>

          <div class="bg-gray-700/30 rounded p-3">
            <h4 class="text-xs text-gray-400 mb-2">Packet Loss (%) over time</h4>
            <LineChart
              v-if="chart.packetLoss.length > 1"
              :data="makeChartData(chart.packetLoss, 'Packet Loss', '#ef4444')"
              :height="120" />
            <div v-else class="text-xs text-gray-500 py-6 text-center">Waiting for data...</div>
          </div>

          <div class="bg-gray-700/30 rounded p-3">
            <h4 class="text-xs text-gray-400 mb-2">Jitter (ms) over time</h4>
            <LineChart
              v-if="chart.jitter.length > 1"
              :data="makeChartData(chart.jitter, 'Jitter', '#f59e0b')"
              :height="120" />
            <div v-else class="text-xs text-gray-500 py-6 text-center">Waiting for data...</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Stats disabled state -->
    <div
      v-else-if="selectedRoomId && !isCollecting"
      class="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
      <div class="text-gray-400">Stats collection is disabled for this room</div>
      <div class="text-gray-500 text-sm mt-1">
        Click "Enable Stats" above to start receiving connection metrics from participants.
      </div>
    </div>

    <!-- No room selected -->
    <div
      v-if="!selectedRoomId"
      class="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
      <div class="text-gray-400">Select a room to get started</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, type PropType } from "vue"
import type {
  RoomStatsMessage,
  ClientStatsReport,
  ParticipantStatsData,
  ChartDataPoint,
} from "@/types"
import LineChart from "./LineChart.vue"
import UserAvatar from "@/components/UserAvatar.vue"
import { useUsersStore } from "@/stores"

const props = defineProps({
  rooms: {
    type: Array as PropType<{ id: string; name: string; user_count: number }[]>,
    default: () => [],
  },
  statsStatuses: {
    type: Array as PropType<{ room_id: string; enabled: boolean }[]>,
    default: () => [],
  },
})

const emit = defineEmits<{
  selectRoom: [roomId: string]
  toggleStats: [roomId: string]
}>()

const usersStore = useUsersStore()

const getUserDisplay = (userId: string): { nickname: string; avatarUrl?: string } => {
  const user = usersStore.allUsers.find((u) => u.id === userId)
  return {
    nickname: user?.nickname ?? `User_${userId.slice(0, 8)}`,
    avatarUrl: user?.avatar_url,
  }
}

const now = ref(Date.now())
let timeInterval: ReturnType<typeof setInterval> | null = null

const selectedRoomId = ref("")
const isCollecting = ref(false)
const toggling = ref(false)
const participants = ref<Record<string, ParticipantStatsData>>({})
const chartData = ref<Record<string, ChartParticipant>>({})

interface ChartParticipant {
  ping: ChartDataPoint[]
  bitrate: ChartDataPoint[]
  packetLoss: ChartDataPoint[]
  jitter: ChartDataPoint[]
}

const enabledRoomsCount = computed(() => {
  return props.statsStatuses.filter((s) => s.enabled).length
})

const onRoomChange = () => {
  if (selectedRoomId.value) {
    isCollecting.value = props.statsStatuses.some(
      (s) => s.room_id === selectedRoomId.value && s.enabled,
    )
    participants.value = {}
    chartData.value = {}
    emit("selectRoom", selectedRoomId.value)
  }
}

const onToggle = async () => {
  if (!selectedRoomId.value) return
  toggling.value = true
  emit("toggleStats", selectedRoomId.value)
  // The parent will update isCollecting after the API call completes
  // For now, optimistically toggle
  isCollecting.value = !isCollecting.value
  if (!isCollecting.value) {
    participants.value = {}
    chartData.value = {}
  }
  toggling.value = false
}

const updateStats = (message: RoomStatsMessage) => {
  if (message.room_id !== selectedRoomId.value) return

  participants.value = message.participants || {}

  for (const [userId, pData] of Object.entries(message.participants || {})) {
    if (!chartData.value[userId]) {
      chartData.value[userId] = {
        ping: [],
        bitrate: [],
        packetLoss: [],
        jitter: [],
      }
    }

    const cd = chartData.value[userId]
    const reports: ClientStatsReport[] = []

    if (pData.last_report) reports.push(pData.last_report)
    if (pData.history) reports.push(...pData.history)

    // Deduplicate by timestamp
    const seen = new Set<number>()
    const unique = reports.filter((r) => {
      if (seen.has(r.timestamp)) return false
      seen.add(r.timestamp)
      return true
    })
    unique.sort((a, b) => a.timestamp - b.timestamp)

    for (const report of unique) {
      const ts = report.timestamp
      const cs = report.connection_stats

      if (!cd.ping.find((p) => p.timestamp === ts)) {
        cd.ping.push({ timestamp: ts, value: cs.rtt })
      }
      if (cs.audio && !cd.bitrate.find((b) => b.timestamp === ts)) {
        cd.bitrate.push({ timestamp: ts, value: cs.audio.bitrate })
      }
      if (cs.audio && !cd.packetLoss.find((p) => p.timestamp === ts)) {
        cd.packetLoss.push({ timestamp: ts, value: cs.audio.packet_loss })
      }
      if (cs.audio && !cd.jitter.find((j) => j.timestamp === ts)) {
        cd.jitter.push({ timestamp: ts, value: cs.audio.jitter })
      }
    }

    // Keep last 20
    cd.ping = cd.ping.slice(-20)
    cd.bitrate = cd.bitrate.slice(-20)
    cd.packetLoss = cd.packetLoss.slice(-20)
    cd.jitter = cd.jitter.slice(-20)
  }
}

const getLastReport = (pData: ParticipantStatsData): ClientStatsReport | null => {
  return pData.last_report || (pData.history && pData.history.length > 0 ? pData.history[pData.history.length - 1] : null)
}

const getLastPing = (pData: ParticipantStatsData): number => {
  const r = getLastReport(pData)
  return r?.connection_stats?.rtt ?? 0
}

const getLastBitrate = (pData: ParticipantStatsData): number => {
  const r = getLastReport(pData)
  return r?.connection_stats?.audio?.bitrate ?? 0
}

const getLastPacketLoss = (pData: ParticipantStatsData): number => {
  const r = getLastReport(pData)
  const pl = r?.connection_stats?.audio?.packet_loss ?? 0
  return Math.round(pl * 100) / 100
}

const getLastJitter = (pData: ParticipantStatsData): number => {
  const r = getLastReport(pData)
  const j = r?.connection_stats?.audio?.jitter ?? 0
  return Math.round(j * 100) / 100
}

const getLastCodec = (pData: ParticipantStatsData): string | undefined => {
  const r = getLastReport(pData)
  return r?.connection_stats?.audio?.codec || r?.connection_stats?.video?.codec
}

const formatRelativeTime = (ts: number): string => {
  const diff = now.value - ts
  if (diff < 1000) return "just now"
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

const formatAbsoluteTime = (ts: number): string => {
  return new Date(ts).toLocaleTimeString()
}

const formatReportTime = (pData: ParticipantStatsData): string => {
  const r = getLastReport(pData)
  if (!r) return "N/A"
  const rel = formatRelativeTime(r.timestamp)
  const abs = formatAbsoluteTime(r.timestamp)
  return `${rel} (${abs})`
}

const formatBitrate = (bps: number): string => {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} Kbps`
  return `${bps.toFixed(0)} bps`
}

const makeChartData = (
  points: ChartDataPoint[],
  label: string,
  borderColor: string,
) => ({
  labels: points.map((p) => new Date(p.timestamp).toLocaleTimeString()),
  datasets: [
    {
      label,
      data: points.map((p) => p.value),
      borderColor,
      backgroundColor: borderColor + "20",
      borderWidth: 1.5,
      pointRadius: 2,
      fill: true,
      tension: 0.3,
    },
  ],
})

const handleGlobalMessage = (message: { type: string; data: unknown }) => {
  if (message.type === "room_stats") {
    updateStats(message.data as RoomStatsMessage)
  }
}

// Listen for room_stats messages
import { wsService } from "@/services/websocket"

watch(
  () => selectedRoomId.value,
  (newVal) => {
    if (newVal) {
      isCollecting.value = props.statsStatuses.some(
        (s) => s.room_id === newVal && s.enabled,
      )
    }
  },
)

onMounted(() => {
  wsService.onGlobal("room_stats", handleGlobalMessage)
  timeInterval = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

onUnmounted(() => {
  if (timeInterval) {
    clearInterval(timeInterval)
    timeInterval = null
  }
})
</script>
