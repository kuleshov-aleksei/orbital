<template>
  <div
    class="stats-popup fixed z-50 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl p-4 pointer-events-auto"
    :style="{
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      width: POPUP_WIDTH + 'px',
      maxHeight: POPUP_HEIGHT + 'px',
    }"
    @mouseenter="$emit('popup-enter')"
    @mouseleave="$emit('popup-leave')">
    <div class="overflow-y-auto space-y-4" :style="{ maxHeight: POPUP_HEIGHT - 32 + 'px' }">
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
          <template v-for="direction in ['outbound', 'inbound']" :key="direction">
            <div class="min-w-0">
              <div class="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 text-center">
                <template v-if="direction === 'inbound'">
                  {{ getUserDisplay(hoveredUserId).nickname }} &rarr;
                  {{ getUserDisplay(otherId).nickname }}
                </template>
                <template v-else>
                  {{ getUserDisplay(otherId).nickname }} &rarr;
                  {{ getUserDisplay(hoveredUserId).nickname }}
                </template>
              </div>

              <template
                v-if="
                  getObservations(
                    direction === 'outbound' ? hoveredUserId : otherId,
                    direction === 'outbound' ? otherId : hoveredUserId,
                  ).length > 0
                ">
                <div
                  v-for="obs in getLatestPerTrack(
                    getObservations(
                      direction === 'outbound' ? hoveredUserId : otherId,
                      direction === 'outbound' ? otherId : hoveredUserId,
                    ),
                  )"
                  :key="obs.track_type"
                  class="bg-gray-700/40 rounded-lg p-2 mb-1.5"
                  :class="isScreenShare(obs.track_type) ? 'col-span-2' : ''">
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
                      <span class="text-white font-mono block">{{
                        formatPct(obs.packet_loss)
                      }}</span>
                    </div>
                    <div>
                      <span class="text-gray-500">Bitrate</span>
                      <span class="text-white font-mono block">{{
                        formatBitrate(obs.bitrate)
                      }}</span>
                    </div>
                  </div>
                  <div v-if="obs.resolution" class="text-[10px] text-gray-500 mb-1">
                    {{ obs.resolution }}{{ obs.fps ? ` @ ${obs.fps}fps` : "" }}
                  </div>
                  <div class="grid grid-cols-3 gap-1">
                    <div class="p-0.5 bg-gray-800 rounded overflow-hidden">
                      <LineChart
                        v-if="
                          getMetricHistory(
                            direction === 'outbound' ? hoveredUserId : otherId,
                            direction === 'outbound' ? otherId : hoveredUserId,
                            obs.track_type,
                            'jitter',
                          ).length > 1
                        "
                        :data="
                          makeSparkline(
                            getMetricHistory(
                              direction === 'outbound' ? hoveredUserId : otherId,
                              direction === 'outbound' ? otherId : hoveredUserId,
                              obs.track_type,
                              'jitter',
                            ),
                            'Jitter',
                            '#f59e0b',
                          )
                        "
                        :height="CHART_HEIGHT" />
                    </div>
                    <div class="p-0.5 bg-gray-800 rounded overflow-hidden">
                      <LineChart
                        v-if="
                          getMetricHistory(
                            direction === 'outbound' ? hoveredUserId : otherId,
                            direction === 'outbound' ? otherId : hoveredUserId,
                            obs.track_type,
                            'packet_loss',
                          ).length > 1
                        "
                        :data="
                          makeSparkline(
                            getMetricHistory(
                              direction === 'outbound' ? hoveredUserId : otherId,
                              direction === 'outbound' ? otherId : hoveredUserId,
                              obs.track_type,
                              'packet_loss',
                            ),
                            'Loss',
                            '#ef4444',
                          )
                        "
                        :height="CHART_HEIGHT" />
                    </div>
                    <div class="p-0.5 bg-gray-800 rounded overflow-hidden">
                      <LineChart
                        v-if="
                          getBitrateChartData(
                            direction === 'outbound' ? hoveredUserId : otherId,
                            direction === 'outbound' ? otherId : hoveredUserId,
                            obs.track_type,
                          ).length > 0
                        "
                        :data="
                          makeSparkline(
                            getBitrateChartData(
                              direction === 'outbound' ? hoveredUserId : otherId,
                              direction === 'outbound' ? otherId : hoveredUserId,
                              obs.track_type,
                            ),
                            'Bitrate',
                            '#22c55e',
                          )
                        "
                        :height="CHART_HEIGHT"
                        value-suffix=" kbps" />
                    </div>
                  </div>
                  <!-- Extra charts for screen share (full width) -->
                  <div class="grid grid-cols-2 gap-1 text-[10px] mb-1">
                    <div v-if="obs.fps">
                      <span class="text-gray-500">FPS</span>
                      <span class="text-white font-mono block">{{ formatFps(obs.fps) }}</span>
                    </div>
                    <div v-if="obs.dropped_frames">
                      <span class="text-gray-500">Dropped frames</span>
                      <span class="text-white font-mono block">{{
                        formatDroppedFrames(obs.dropped_frames)
                      }}</span>
                    </div>
                  </div>
                  <div
                    v-if="
                      isScreenShare(obs.track_type) &&
                      (obs.fps !== undefined || obs.dropped_frames !== undefined)
                    "
                    class="grid grid-cols-2 gap-1 mt-1">
                    <div class="p-0.5 bg-gray-800 rounded overflow-hidden">
                      <LineChart
                        v-if="obs.fps !== undefined"
                        :data="
                          makeSparkline(
                            getMetricHistory(
                              direction === 'outbound' ? hoveredUserId : otherId,
                              direction === 'outbound' ? otherId : hoveredUserId,
                              obs.track_type,
                              'fps',
                            ),
                            'FPS',
                            '#a78bfa',
                          )
                        "
                        :height="CHART_HEIGHT" />
                    </div>
                    <div class="p-0.5 bg-gray-800 rounded overflow-hidden">
                      <LineChart
                        v-if="obs.dropped_frames !== undefined"
                        :data="
                          makeSparkline(
                            getDroppedFramesHistory(
                              direction === 'outbound' ? hoveredUserId : otherId,
                              direction === 'outbound' ? otherId : hoveredUserId,
                              obs.track_type,
                            ),
                            'Dropped',
                            '#f97316',
                          )
                        "
                        :height="CHART_HEIGHT" />
                    </div>
                  </div>
                </div>
              </template>
              <div v-else class="text-[10px] text-gray-500 italic text-center py-2">No data</div>
            </div>
          </template>
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
import { POPUP_WIDTH, POPUP_HEIGHT, CHART_HEIGHT } from "./statsConstants"

interface TrackGroup {
  track_type: string
  jitter: number
  packet_loss: number
  bitrate: number
  codec?: string
  resolution?: string
  fps?: number
  dropped_frames?: number
}

const props = defineProps<{
  reports: Record<string, ClientStatsBatch>
  hoveredUserId: string
  allUserIds: string[]
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

const isScreenShare = (trackType: string): boolean =>
  trackType === "screen_share" || trackType === "screen_share_audio"

const getMetricHistory = (
  fromId: string,
  toId: string,
  trackType: string,
  metric: "jitter" | "packet_loss" | "bitrate" | "fps",
): { timestamp: number; value: number }[] => {
  const observations = getObservations(fromId, toId)
  return observations
    .filter((o) => o.track_type === trackType)
    .map((o) => ({ timestamp: o.timestamp, value: o[metric] ?? 0 }))
    .slice(-20)
}

const getBitrateChartData = (
  fromId: string,
  toId: string,
  trackType: string,
): { timestamp: number; value: number }[] => {
  const observations = getObservations(fromId, toId)
  return observations
    .filter((o) => o.track_type === trackType && o.bitrate > 0)
    .map((o) => ({ timestamp: o.timestamp, value: o.bitrate / 1000 }))
    .slice(-20)
}

const getDroppedFramesHistory = (
  fromId: string,
  toId: string,
  trackType: string,
): { timestamp: number; value: number }[] => {
  const observations = getObservations(fromId, toId)
  const entries = observations
    .filter((o) => o.track_type === trackType && o.dropped_frames !== undefined)
    .slice(-20)
  if (entries.length < 2) return []
  return entries.slice(1).map((o, i) => ({
    timestamp: o.timestamp,
    value: Math.max(0, (o.dropped_frames ?? 0) - (entries[i].dropped_frames ?? 0)),
  }))
}

const formatMs = (v: number): string => `${Math.round(v * 100) / 100}ms`
const formatPct = (v: number): string => `${Math.round(v * 100) / 100}%`
const formatFps = (v: number): string => `${v} frames per second`
const formatDroppedFrames = (v: number): string => `${v} frames dropped`
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
      pointRadius: 2,
      pointHitRadius: 10,
      fill: true,
      tension: 0.3,
    },
  ],
})
</script>
