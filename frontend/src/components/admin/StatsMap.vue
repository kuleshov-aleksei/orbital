<template>
  <div
    ref="containerRef"
    class="relative w-full bg-gray-900 rounded-xl border border-gray-700"
    :style="{ aspectRatio: '1 / 1', maxWidth: '650px', width: '100%' }">
    <!-- SVG connection lines (viewBox matches svgSize coordinate space) -->
    <svg
      class="absolute inset-0 w-full h-full pointer-events-none"
      :viewBox="`0 0 ${svgSize} ${svgSize}`">
      <g v-for="(line, idx) in connectionLines" :key="idx">
        <line
          :x1="line.x1"
          :y1="line.y1"
          :x2="line.x2"
          :y2="line.y2"
          :stroke="line.highlighted ? '#818cf8' : '#374151'"
          :stroke-width="line.highlighted ? 2 : 1"
          :opacity="line.highlighted ? 1 : 0.3"
          class="transition-all duration-300" />
        <text
          v-if="line.bitrateAtoB > 0 || line.bitrateBtoA > 0"
          :x="(line.x1 + line.x2) / 2"
          :y="(line.y1 + line.y2) / 2 - 10"
          text-anchor="middle"
          :fill="line.highlighted ? '#d1d5db' : '#6b7280'"
          font-size="12"
          font-family="monospace"
          :opacity="line.highlighted ? 1 : 0.4"
          class="pointer-events-none select-none">
          {{ line.shortA }}→{{ line.shortB }}: {{ formatBitrate(line.bitrateAtoB) }}
        </text>
        <text
          v-if="line.bitrateAtoB > 0 || line.bitrateBtoA > 0"
          :x="(line.x1 + line.x2) / 2"
          :y="(line.y1 + line.y2) / 2 + 6"
          text-anchor="middle"
          :fill="line.highlighted ? '#d1d5db' : '#6b7280'"
          font-size="12"
          font-family="monospace"
          :opacity="line.highlighted ? 1 : 0.4"
          class="pointer-events-none select-none">
          {{ line.shortB }}→{{ line.shortA }}: {{ formatBitrate(line.bitrateBtoA) }}
        </text>
      </g>
    </svg>

    <!-- Avatar nodes (positioned using % relative to container, matching SVG viewBox scale) -->
    <div
      v-for="node in avatarNodes"
      :key="node.userId"
      class="absolute cursor-pointer transition-transform duration-300 z-10"
      :class="{
        'scale-110 z-20': activeUserId === node.userId,
        'z-30': pinnedUserId === node.userId,
      }"
      :style="{
        left: `calc(${pct(node.x)}% - ${avatarSize / 2}px)`,
        top: `calc(${pct(node.y)}% - ${avatarSize / 2}px)`,
      }"
      @mouseenter="onAvatarEnter(node.userId)"
      @mouseleave="onAvatarLeave"
      @click.stop="onAvatarClick(node.userId)">
      <UserAvatar :user-id="node.userId" :size="avatarSize" :show-status="false" />
      <div class="text-center mt-1">
        <div class="text-xs text-gray-400 truncate max-w-[64px]">
          {{ getNickname(node.userId) }}
        </div>
      </div>
    </div>

    <!-- Stats popup -->
    <StatsPopup
      v-if="showPopup && activeUserId"
      :reports="reports"
      :hovered-user-id="activeUserId"
      :all-user-ids="allUserIds"
      :get-latest-rtt="getLatestRtt" />

    <!-- Empty state -->
    <div v-if="allUserIds.length === 0" class="absolute inset-0 flex items-center justify-center">
      <div class="text-center">
        <div class="text-gray-400 text-sm">No participants</div>
        <div class="text-gray-500 text-xs mt-1">Waiting for stats reports...</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, useTemplateRef } from "vue"
import type { ClientStatsBatch } from "@/types"
import UserAvatar from "@/components/UserAvatar.vue"
import StatsPopup from "./StatsPopup.vue"
import { useUsersStore } from "@/stores"

const props = defineProps<{
  reports: Record<string, ClientStatsBatch>
  getLatestRtt: (userId: string) => number
}>()

const usersStore = useUsersStore()

const containerRef = useTemplateRef<HTMLDivElement>("containerRef")
const hoveredUserId = ref<string | null>(null)
const pinnedUserId = ref<string | null>(null)
const showPopup = ref(false)

const activeUserId = computed(() => pinnedUserId.value || hoveredUserId.value)

const avatarSize = 48
const svgSize = 600
const padding = 60

const allUserIds = computed(() => Object.keys(props.reports))

const pct = (v: number) => (v / svgSize) * 100

const avatarNodes = computed(() => {
  const ids = allUserIds.value
  const n = ids.length
  const cx = svgSize / 2
  const cy = svgSize / 2
  const radius = Math.min(cx, cy) - padding - avatarSize

  return ids.map((userId, i) => {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2
    return {
      userId,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    }
  })
})

const getCombinedBitrate = (fromId: string, toId: string): number => {
  const batch = props.reports[fromId]
  if (!batch) return 0
  const observations = batch.observations[toId]
  if (!observations || observations.length === 0) return 0

  const WINDOW = 5
  const byType = new Map<string, number[]>()
  for (const obs of observations) {
    const arr = byType.get(obs.track_type)
    if (arr) {
      arr.push(obs.bitrate)
    } else {
      byType.set(obs.track_type, [obs.bitrate])
    }
  }

  let total = 0
  for (const bitrates of byType.values()) {
    const recent = bitrates.slice(-WINDOW)
    total += recent.reduce((a, b) => a + b, 0) / recent.length
  }
  return total
}

const formatBitrate = (bps: number): string => {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} Kbps`
  return `${bps.toFixed(0)} bps`
}

const getShortLabel = (userId: string): string => {
  const user = usersStore.allUsers.find((u) => u.id === userId)
  const name = user?.nickname ?? `User_${userId.slice(0, 4)}`
  return name.length > 6 ? name.slice(0, 5) + "…" : name
}

const connectionLines = computed(() => {
  const nodes = avatarNodes.value
  const lines: {
    x1: number
    y1: number
    x2: number
    y2: number
    highlighted: boolean
    bitrateAtoB: number
    bitrateBtoA: number
    shortA: string
    shortB: string
  }[] = []

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const highlighted =
        activeUserId.value === nodes[i].userId || activeUserId.value === nodes[j].userId
      const bitrateAtoB = getCombinedBitrate(nodes[j].userId, nodes[i].userId)
      const bitrateBtoA = getCombinedBitrate(nodes[i].userId, nodes[j].userId)
      lines.push({
        x1: nodes[i].x,
        y1: nodes[i].y,
        x2: nodes[j].x,
        y2: nodes[j].y,
        highlighted,
        bitrateAtoB,
        bitrateBtoA,
        shortA: getShortLabel(nodes[i].userId),
        shortB: getShortLabel(nodes[j].userId),
      })
    }
  }
  return lines
})

const getNickname = (userId: string): string => {
  const user = usersStore.allUsers.find((u) => u.id === userId)
  return user?.nickname ?? `User_${userId.slice(0, 6)}`
}

const onAvatarEnter = (userId: string) => {
  hoveredUserId.value = userId
}

const onAvatarLeave = () => {
  hoveredUserId.value = null
}

const onAvatarClick = (userId: string) => {
  if (pinnedUserId.value === userId) {
    pinnedUserId.value = null
    showPopup.value = false
  } else {
    pinnedUserId.value = userId
    showPopup.value = true
  }
}

const onDocumentClick = (e: MouseEvent) => {
  if (!pinnedUserId.value) return
  const target = e.target as Node
  const popupEl = (containerRef.value?.querySelector(".stats-popup") as HTMLElement) || null
  if (popupEl && !popupEl.contains(target)) {
    pinnedUserId.value = null
    if (!hoveredUserId.value) {
      showPopup.value = false
    }
  }
}

onMounted(() => {
  document.addEventListener("click", onDocumentClick)
})

onUnmounted(() => {
  document.removeEventListener("click", onDocumentClick)
})
</script>
