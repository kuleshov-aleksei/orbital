<template>
  <div class="flex flex-col items-start gap-2" data-testid="command-wheel">
    <div class="relative" :style="{ width: `${SIZE}px`, height: `${SIZE}px` }">
      <svg
        :width="SIZE"
        :height="SIZE"
        :viewBox="`${-R - 2} ${-R - 2} ${2 * R + 4} ${2 * R + 4}`"
        class="wheel"
        :class="{ animated }"
        :style="{ transform: `rotate(${rotation}deg)` }"
        role="img"
        :aria-label="`Wheel of fortune with ${labels.length} options`"
        @transitionend="onStopped">
        <g v-for="(label, i) in labels" :key="i">
          <path
            :d="segmentPath(i)"
            :fill="segmentColor(i)"
            stroke="var(--color-theme-bg-primary)"
            stroke-width="1.5" />
          <text
            :transform="`rotate(${(i + 0.5) * step - 90})`"
            :x="R * 0.58"
            y="0"
            text-anchor="middle"
            dominant-baseline="central"
            fill="#fff"
            :font-size="fontSize"
            font-weight="600">
            {{ shorten(label) }}
          </text>
        </g>
        <circle r="10" fill="var(--color-theme-bg-secondary)" stroke="var(--color-theme-border)" />
      </svg>
      <!-- Pointer at the top -->
      <svg
        class="absolute left-1/2 -translate-x-1/2 -top-1 drop-shadow"
        width="18"
        height="20"
        viewBox="0 0 18 20"
        aria-hidden="true">
        <path d="M1 1 H17 L9 19 Z" fill="var(--color-theme-text-primary)" />
      </svg>
    </div>
    <div class="flex items-center gap-2 text-sm min-h-6">
      <template v-if="!spinning">
        <span class="text-theme-text-muted">Landed on</span>
        <span class="font-semibold text-theme-text-primary" data-testid="command-result">{{
          labels[resultIndex]
        }}</span>
        <button
          type="button"
          class="ml-1 p-1 rounded text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover"
          title="Spin again (replay)"
          aria-label="Replay the spin"
          @click="spin">
          <PhArrowCounterClockwise class="w-4 h-4" />
        </button>
      </template>
      <span v-else class="text-theme-text-muted italic">Spinning…</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue"
import { PhArrowCounterClockwise } from "@phosphor-icons/vue"

const props = defineProps<{
  labels: string[]
  resultIndex: number
  /** Stable seed (the message id): every viewer stops at the same spot. */
  seed: string
  /** Spin on mount (the message just arrived) or show the final position. */
  animate: boolean
}>()

const SIZE = 220
const R = 100
const TURNS = 6
const SPIN_MS = 4800

const step = computed(() => 360 / props.labels.length)
const fontSize = computed(() => (props.labels.length > 16 ? 9 : props.labels.length > 10 ? 11 : 13))
const maxChars = computed(() => (props.labels.length > 16 ? 9 : 12))

// Where inside the winning segment the pointer stops (15–85 %), from the seed.
const offset = computed(() => {
  let h = 2166136261
  for (let i = 0; i < props.seed.length; i++) {
    h ^= props.seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return 0.15 + (((h >>> 0) % 1000) / 1000) * 0.7
})

// The wheel turns clockwise; the pointer sits at the top, so it points at
// wheel angle -rotation. Stop with the result's segment under it.
const finalRotation = computed(() => TURNS * 360 - (props.resultIndex + offset.value) * step.value)

const rotation = ref(0)
/** Shows "Spinning…" instead of the result. */
const spinning = ref(props.animate)
/** The CSS transition is on (off while jumping back for a replay). */
const animated = ref(false)

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
}

async function spin() {
  if (reducedMotion()) {
    rotation.value = finalRotation.value
    spinning.value = false
    return
  }
  // Jump back to the start without a transition, then spin.
  spinning.value = true
  animated.value = false
  rotation.value = 0
  await nextTick()
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      animated.value = true
      rotation.value = finalRotation.value
      // transitionend can be lost (tab hidden): stop anyway.
      clearTimeout(stopTimer)
      stopTimer = setTimeout(onStopped, SPIN_MS + 200)
    })
  })
}

let stopTimer: ReturnType<typeof setTimeout> | undefined

function onStopped() {
  clearTimeout(stopTimer)
  spinning.value = false
}

onBeforeUnmount(() => clearTimeout(stopTimer))

onMounted(() => {
  if (props.animate) void spin()
  else rotation.value = finalRotation.value
})

function point(angle: number, r: number): string {
  const rad = (angle * Math.PI) / 180
  return `${(r * Math.sin(rad)).toFixed(3)} ${(-r * Math.cos(rad)).toFixed(3)}`
}

function segmentPath(i: number): string {
  const a0 = i * step.value
  const a1 = (i + 1) * step.value
  const large = step.value > 180 ? 1 : 0
  return `M0 0 L${point(a0, R)} A${R} ${R} 0 ${large} 1 ${point(a1, R)} Z`
}

function segmentColor(i: number): string {
  const n = props.labels.length
  // Even hue spread; neighbours alternate lightness so equal hues never touch.
  const hue = Math.round((i * 360) / n + 250) % 360
  return `hsl(${hue} 55% ${i % 2 ? 38 : 46}%)`
}

function shorten(label: string): string {
  const chars = Array.from(label)
  return chars.length > maxChars.value ? `${chars.slice(0, maxChars.value - 1).join("")}…` : label
}
</script>

<style scoped>
.wheel.animated {
  transition: transform 4.8s cubic-bezier(0.12, 0.8, 0.2, 1);
}
</style>
