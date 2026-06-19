<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="show"
        ref="tooltipElement"
        class="fixed z-[9999] bg-theme-bg-primary border border-theme-border rounded-lg p-3 w-52 shadow-xl pointer-events-none"
        :style="tooltipStyle">
        <div
          class="text-xs font-medium text-theme-text-secondary mb-2 border-b border-theme-border pb-1">
          Connection Stats
        </div>

        <div class="space-y-2">
          <div class="flex justify-between text-xs">
            <span class="text-theme-text-muted">Ping:</span>
            <span class="text-green-400">{{ formatNumber(stats.ping) }}ms</span>
          </div>

          <template v-if="stats.audio">
            <div
              class="text-xs font-medium text-theme-text-muted mt-2 pt-1 border-t border-theme-border/50">
              Audio
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-theme-text-muted">Jitter:</span>
              <span class="text-blue-400">{{ formatNumber(stats.audio.jitter) }}ms</span>
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-theme-text-muted">Packet Loss:</span>
              <span :class="getPacketLossClass(stats.audio.packetLoss)">
                {{ formatNumber(stats.audio.packetLoss) }}%
              </span>
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-theme-text-muted">Bitrate:</span>
              <span class="text-purple-400">{{ formatBitrate(stats.audio.bitrate) }}</span>
            </div>
          </template>

          <template v-if="stats.video">
            <div
              class="text-xs font-medium text-theme-text-muted mt-2 pt-1 border-t border-theme-border/50">
              Camera
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-theme-text-muted">Resolution:</span>
              <span class="text-purple-400">{{ stats.video.resolution || "–" }}</span>
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-theme-text-muted">Frame Rate:</span>
              <span class="text-purple-400">{{ formatNumber(stats.video.fps || 0) }} fps</span>
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-theme-text-muted">Codec:</span>
              <span class="text-purple-400">{{ stats.video.codec || "–" }}</span>
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-gray-500">Jitter:</span>
              <span class="text-blue-400">{{ formatNumber(stats.video.jitter) }}ms</span>
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-gray-500">Packet Loss:</span>
              <span :class="getPacketLossClass(stats.video.packetLoss)">
                {{ formatNumber(stats.video.packetLoss) }}%
              </span>
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-gray-500">Bitrate:</span>
              <span class="text-purple-400">{{ formatBitrate(stats.video.bitrate) }}</span>
            </div>
            <div
              v-if="
                stats.video.qualityLimitationReason &&
                stats.video.qualityLimitationReason !== 'none'
              "
              class="flex justify-between text-xs">
              <span class="text-gray-500">Quality:</span>
              <span class="text-yellow-400">{{ stats.video.qualityLimitationReason }}</span>
            </div>
          </template>

          <template v-if="stats.localVideo">
            <div class="text-xs font-medium text-amber-400 mt-2 pt-1 border-t border-amber-700/50">
              My Camera
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-gray-500">Resolution:</span>
              <span class="text-amber-400">{{ stats.localVideo.resolution || "–" }}</span>
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-gray-500">Frame Rate:</span>
              <span class="text-amber-400">{{ formatNumber(stats.localVideo.fps || 0) }} fps</span>
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-gray-500">Codec:</span>
              <span class="text-amber-400">{{ stats.localVideo.codec || "–" }}</span>
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-gray-500">Bitrate:</span>
              <span class="text-amber-400">{{ formatBitrate(stats.localVideo.bitrate) }}</span>
            </div>
          </template>

          <template v-if="stats.screenShare">
            <div
              class="text-xs font-medium text-indigo-300 mt-2 pt-1 border-t border-indigo-700/50">
              Screen Share
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-gray-500">Resolution:</span>
              <span class="text-indigo-400">{{ stats.screenShare.resolution || "–" }}</span>
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-gray-500">Frame Rate:</span>
              <span class="text-indigo-400"
                >{{ formatNumber(stats.screenShare.fps || 0) }} fps</span
              >
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-gray-500">Codec:</span>
              <span class="text-indigo-400">{{ stats.screenShare.codec || "–" }}</span>
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-gray-500">Jitter:</span>
              <span class="text-blue-400">{{ formatNumber(stats.screenShare.jitter) }}ms</span>
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-gray-500">Packet Loss:</span>
              <span :class="getPacketLossClass(stats.screenShare.packetLoss)">
                {{ formatNumber(stats.screenShare.packetLoss) }}%
              </span>
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-gray-500">Bitrate:</span>
              <span class="text-purple-400">{{ formatBitrate(stats.screenShare.bitrate) }}</span>
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-gray-500">Frames:</span>
              <span class="text-green-400">
                {{ stats.screenShare.framesDecoded || 0 }}
                <span class="text-gray-500">/</span>
                <span
                  :class="
                    stats.screenShare.framesDropped && stats.screenShare.framesDropped > 0
                      ? 'text-red-400'
                      : 'text-green-400'
                  ">
                  {{ stats.screenShare.framesDropped || 0 }}
                </span>
              </span>
            </div>
            <div
              v-if="
                stats.screenShare.qualityLimitationReason &&
                stats.screenShare.qualityLimitationReason !== 'none'
              "
              class="flex justify-between text-xs">
              <span class="text-gray-500">Quality:</span>
              <span class="text-yellow-400">{{ stats.screenShare.qualityLimitationReason }}</span>
            </div>
            <div
              v-if="
                stats.screenShare.nackCount ||
                stats.screenShare.pliCount ||
                stats.screenShare.firCount
              "
              class="flex justify-between text-xs">
              <span class="text-gray-500">Recovery:</span>
              <span class="text-orange-400">
                N:{{ stats.screenShare.nackCount || 0 }} P:{{
                  stats.screenShare.pliCount || 0
                }}
                F:{{ stats.screenShare.firCount || 0 }}
              </span>
            </div>
          </template>

          <template v-if="stats.screenShareAudio">
            <div class="text-xs font-medium text-cyan-300 mt-2 pt-1 border-t border-cyan-700/50">
              Screen Share Audio
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-gray-500">Codec:</span>
              <span class="text-cyan-400">{{ stats.screenShareAudio.codec || "–" }}</span>
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-gray-500">Jitter:</span>
              <span class="text-blue-400">{{ formatNumber(stats.screenShareAudio.jitter) }}ms</span>
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-gray-500">Packet Loss:</span>
              <span :class="getPacketLossClass(stats.screenShareAudio.packetLoss)">
                {{ formatNumber(stats.screenShareAudio.packetLoss) }}%
              </span>
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-gray-500">Bitrate:</span>
              <span class="text-cyan-400">{{ formatBitrate(stats.screenShareAudio.bitrate) }}</span>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { useTemplateRef, computed } from "vue"
import type { ConnectionStats } from "@/types"

const props = withDefaults(defineProps<{
  stats: ConnectionStats
  show: boolean
  mouseX: number
  mouseY: number
}>(), {
  show: false,
  mouseX: 0,
  mouseY: 0,
})

const tooltipElement = useTemplateRef<HTMLDivElement>("tooltipElement")
const tooltipOffset = { x: 16, y: 16 }

const tooltipStyle = computed(() => {
  if (typeof window === "undefined") {
    return { left: "0px", top: "0px" }
  }

  const tooltipWidth = 208
  const tooltipHeight = tooltipElement.value?.offsetHeight || 200
  const padding = 8

  let left = props.mouseX + tooltipOffset.x
  let top = props.mouseY + tooltipOffset.y

  if (left + tooltipWidth > window.innerWidth - padding) {
    left = props.mouseX - tooltipWidth - tooltipOffset.x
  }

  if (top + tooltipHeight > window.innerHeight - padding) {
    top = props.mouseY - tooltipHeight - tooltipOffset.y
  }

  left = Math.max(padding, Math.min(left, window.innerWidth - tooltipWidth - padding))
  top = Math.max(padding, Math.min(top, window.innerHeight - tooltipHeight - padding))

  return {
    left: `${left}px`,
    top: `${top}px`,
  }
})

const formatNumber = (value: number): string => {
  if (value === 0) return "–"
  return value.toFixed(1)
}

const formatBitrate = (value: number): string => {
  if (value === 0) return "–"
  if (value < 1000) return `${value.toFixed(0)} bps`
  if (value < 1000000) return `${(value / 1000).toFixed(1)} kbps`
  return `${(value / 1000000).toFixed(2)} mbps`
}

const getPacketLossClass = (value: number): string => {
  if (value === 0) return "text-green-400"
  if (value < 1) return "text-yellow-400"
  return "text-red-400"
}
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
