<template>
  <div
    class="stats-popup absolute z-50 bg-gray-800 border w-[860px] border-gray-700 rounded-xl shadow-2xl p-4 pointer-events-auto"
    :style="{ left: `${position.x}px`, top: `${position.y}px`, maxHeight: '520px' }"
    @mouseenter="$emit('popup-enter')"
    @mouseleave="$emit('popup-leave')">
    <div class="overflow-y-auto max-h-[520px] space-y-4">
      <!-- Header -->
      <div class="flex items-center gap-3 pb-3 border-b border-gray-700">
        <UserAvatar :user-id="hoveredUserId" :size="36" :show-status="false" />
        <div>
          <div class="text-sm font-semibold text-white">
            {{ getUserDisplay(hoveredUserId).nickname }}
          </div>
          <div class="text-xs text-gray-400">Ping: {{ getLatestRtt(hoveredUserId) }}ms</div>
        </div>
      </div>

      <!-- Per-pair stats: side-by-side columns -->
      <div v-for="otherId in otherUserIds" :key="otherId">
        <div
          class="text-xs font-medium text-gray-300 uppercase tracking-wider border-b border-gray-700/50 pb-1 mb-2">
          {{ getUserDisplay(hoveredUserId).nickname }} &harr; {{ getUserDisplay(otherId).nickname }}
        </div>

        <div class="grid grid-cols-2 gap-3">
          <!-- Column 1: hoveredUserId -> otherId -->
          <div class="min-w-0">
            <div class="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 text-center">
              {{ getUserDisplay(hoveredUserId).nickname }} &rarr;
            </div>

            <template v-if="getObservations(hoveredUserId, otherId).length > 0">
              <div
                v-for="obs in getLatestPerTrack(getObservations(hoveredUserId, otherId))"
                :key="obs.track_type"
                class="bg-gray-700/40 rounded-lg p-2 mb-1.5">
                <div class="flex items-center justify-between mb-1">
                  <span class="text-[10px] font-medium text-gray-400 uppercase">{{
                    obs.track_type
                  }}</span>
                  <span class="text-[10px] text-gray-500">{{ obs.codec || "N/A" }}</span>
                </div>
                <div class="grid grid-cols-3 gap-1 text-[10px] mb-1">
                  <div>
                    <span class="text-gray-500">Jitter</span>
                    <span class="text-white font-mono block">{{ formatMs(obs.jitter) }}</span>
                  </div>
                  <div>
                    <span class="text-gray-500">Loss</span>
                    <span class="text-white font-mono block">{{ formatPct(obs.packet_loss) }}</span>
                  </div>
                  <div>
                    <span class="text-gray-500">Bitrate</span>
                    <span class="text-white font-mono block">{{ formatBitrate(obs.bitrate) }}</span>
                  </div>
                </div>
                <div v-if="obs.resolution" class="text-[10px] text-gray-500 mb-1">
                  {{ obs.resolution }}{{ obs.fps ? ` @ ${obs.fps}fps` : "" }}
                </div>
                <div class="grid grid-cols-2 gap-1">
                  <div class="h-20 p-0.5 bg-gray-800 rounded overflow-hidden">
                    <LineChart
                      v-if="
                        getMetricHistory(hoveredUserId, otherId, obs.track_type, 'jitter').length >
                        1
                      "
                      :data="
                        makeSparkline(
                          getMetricHistory(hoveredUserId, otherId, obs.track_type, 'jitter'),
                          'Jitter',
                          '#f59e0b',
                        )
                      "
                      :height="72" />
                  </div>
                  <div class="h-20 p-0.5 bg-gray-800 rounded overflow-hidden">
                    <LineChart
                      v-if="
                        getMetricHistory(hoveredUserId, otherId, obs.track_type, 'packet_loss')
                          .length > 1
                      "
                      :data="
                        makeSparkline(
                          getMetricHistory(hoveredUserId, otherId, obs.track_type, 'packet_loss'),
                          'Loss',
                          '#ef4444',
                        )
                      "
                      :height="72" />
                  </div>
                </div>
              </div>
            </template>
            <div v-else class="text-[10px] text-gray-500 italic text-center py-2">No data</div>
          </div>

          <!-- Column 2: otherId -> hoveredUserId -->
          <div class="min-w-0">
            <div class="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 text-center">
              {{ getUserDisplay(otherId).nickname }} &rarr;
            </div>

            <template v-if="getObservations(otherId, hoveredUserId).length > 0">
              <div
                v-for="obs in getLatestPerTrack(getObservations(otherId, hoveredUserId))"
                :key="obs.track_type"
                class="bg-gray-700/40 rounded-lg p-2 mb-1.5">
                <div class="flex items-center justify-between mb-1">
                  <span class="text-[10px] font-medium text-gray-400 uppercase">{{
                    obs.track_type
                  }}</span>
                  <span class="text-[10px] text-gray-500">{{ obs.codec || "N/A" }}</span>
                </div>
                <div class="grid grid-cols-3 gap-1 text-[10px] mb-1">
                  <div>
                    <span class="text-gray-500">Jitter</span>
                    <span class="text-white font-mono block">{{ formatMs(obs.jitter) }}</span>
                  </div>
                  <div>
                    <span class="text-gray-500">Loss</span>
                    <span class="text-white font-mono block">{{ formatPct(obs.packet_loss) }}</span>
                  </div>
                  <div>
                    <span class="text-gray-500">Bitrate</span>
                    <span class="text-white font-mono block">{{ formatBitrate(obs.bitrate) }}</span>
                  </div>
                </div>
                <div v-if="obs.resolution" class="text-[10px] text-gray-500 mb-1">
                  {{ obs.resolution }}{{ obs.fps ? ` @ ${obs.fps}fps` : "" }}
                </div>
                <div class="grid grid-cols-2 gap-1">
                  <div class="h-20 p-0.5 bg-gray-800 rounded overflow-hidden">
                    <LineChart
                      v-if="
                        getMetricHistory(otherId, hoveredUserId, obs.track_type, 'jitter').length >
                        1
                      "
                      :data="
                        makeSparkline(
                          getMetricHistory(otherId, hoveredUserId, obs.track_type, 'jitter'),
                          'Jitter',
                          '#f59e0b',
                        )
                      "
                      :height="72" />
                  </div>
                  <div class="h-20 p-0.5 bg-gray-800 rounded overflow-hidden">
                    <LineChart
                      v-if="
                        getMetricHistory(otherId, hoveredUserId, obs.track_type, 'packet_loss')
                          .length > 1
                      "
                      :data="
                        makeSparkline(
                          getMetricHistory(otherId, hoveredUserId, obs.track_type, 'packet_loss'),
                          'Loss',
                          '#ef4444',
                        )
                      "
                      :height="72" />
                  </div>
                </div>
              </div>
            </template>
            <div v-else class="text-[10px] text-gray-500 italic text-center py-2">No data</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import type { ClientStatsBatch, PerPairObservation } from "@/types"
import { useUsersStore } from "@/stores"
import UserAvatar from "@/components/UserAvatar.vue"
import LineChart from "./LineChart.vue"

interface TrackGroup {
  track_type: string
  jitter: number
  packet_loss: number
  bitrate: number
  codec?: string
  resolution?: string
  fps?: number
}

const props = defineProps<{
  reports: Record<string, ClientStatsBatch>
  hoveredUserId: string
  allUserIds: string[]
  position: { x: number; y: number }
  getLatestRtt: (userId: string) => number
}>()

defineEmits<{
  (e: "popup-enter"): void
  (e: "popup-leave"): void
}>()

const usersStore = useUsersStore()

const getUserDisplay = (userId: string): { nickname: string } => {
  const user = usersStore.allUsers.find((u) => u.id === userId)
  return { nickname: user?.nickname ?? `User_${userId.slice(0, 8)}` }
}

const otherUserIds = computed(() => props.allUserIds.filter((id) => id !== props.hoveredUserId))

const getObservations = (fromId: string, toId: string): PerPairObservation[] => {
  const batch = props.reports[fromId]
  if (!batch?.observations) return []
  return batch.observations[toId] || []
}

const getLatestPerTrack = (observations: PerPairObservation[]): TrackGroup[] => {
  const latest = new Map<string, PerPairObservation>()
  for (const obs of observations) {
    const existing = latest.get(obs.track_type)
    if (!existing || obs.timestamp > existing.timestamp) {
      latest.set(obs.track_type, obs)
    }
  }
  return Array.from(latest.values()).map((obs) => ({
    track_type: obs.track_type,
    jitter: obs.jitter,
    packet_loss: obs.packet_loss,
    bitrate: obs.bitrate,
    codec: obs.codec,
    resolution: obs.resolution,
    fps: obs.fps,
  }))
}

const getMetricHistory = (
  fromId: string,
  toId: string,
  trackType: string,
  metric: "jitter" | "packet_loss" | "bitrate",
): { timestamp: number; value: number }[] => {
  const observations = getObservations(fromId, toId)
  return observations
    .filter((o) => o.track_type === trackType)
    .map((o) => ({ timestamp: o.timestamp, value: o[metric] }))
    .slice(-20)
}

const formatMs = (v: number): string => `${Math.round(v * 100) / 100}ms`
const formatPct = (v: number): string => `${Math.round(v * 100) / 100}%`
const formatBitrate = (bps: number): string => {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} Kbps`
  return `${bps.toFixed(0)} bps`
}

const makeSparkline = (
  points: { timestamp: number; value: number }[],
  label: string,
  color: string,
) => ({
  labels: points.map((p) => new Date(p.timestamp).toLocaleTimeString()),
  datasets: [
    {
      label,
      data: points.map((p) => p.value),
      borderColor: color,
      backgroundColor: color + "20",
      borderWidth: 1,
      pointRadius: 0,
      fill: true,
      tension: 0.3,
    },
  ],
})
</script>
