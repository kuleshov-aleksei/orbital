<template>
  <div
    ref="rootEl"
    class="floating-self-view absolute z-20 select-none touch-none cursor-grab active:cursor-grabbing w-40 lg:w-52 max-h-[45vh] overflow-hidden rounded-xl shadow-2xl ring-1 ring-black/40"
    :class="{
      'right-3': !position,
      'bottom-3': !position && !isFullscreen,
      'bottom-[10%]': !position && isFullscreen,
    }"
    :style="position ? { left: `${position.x}px`, top: `${position.y}px` } : undefined"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp">
    <CameraStream
      :user-id="userId"
      :user-nickname="userNickname"
      :video-track="videoTrack"
      :connection-state="connectionState"
      :is-self-view="true"
      :is-compact="true"
      :show-pip-button="false"
      :show-fullscreen-button="false"
      class="shadow-2xl" />
  </div>
</template>

<script setup lang="ts">
import { useTemplateRef } from "vue"
import CameraStream from "./CameraStream.vue"
import type { RemoteVideoTrack, LocalVideoTrack } from "livekit-client"

export interface SelfViewPosition {
  x: number
  y: number
}

interface Props {
  userId: string
  userNickname: string
  videoTrack: RemoteVideoTrack | LocalVideoTrack | null
  connectionState?: string
  position?: SelfViewPosition | null
  isFullscreen?: boolean
}

withDefaults(defineProps<Props>(), {
  connectionState: "connecting",
  position: null,
  isFullscreen: false,
})

const emit = defineEmits<{
  "update:position": [value: SelfViewPosition]
  focus: []
}>()

const rootEl = useTemplateRef<HTMLDivElement>("rootEl")

interface DragState {
  pointerId: number
  pointerX: number
  pointerY: number
  offsetLeft: number
  offsetTop: number
}

let drag: DragState | null = null
let moved = false

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

const onPointerDown = (event: PointerEvent) => {
  // Let the PiP/fullscreen buttons inside CameraStream handle their own clicks
  if ((event.target as HTMLElement).closest("button")) return

  const el = rootEl.value
  const container = el?.parentElement
  if (!el || !container) return

  const rect = el.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()

  drag = {
    pointerId: event.pointerId,
    pointerX: event.clientX,
    pointerY: event.clientY,
    offsetLeft: rect.left - containerRect.left,
    offsetTop: rect.top - containerRect.top,
  }
  moved = false
  el.setPointerCapture(event.pointerId)
}

const onPointerMove = (event: PointerEvent) => {
  if (!drag || event.pointerId !== drag.pointerId) return

  const dx = event.clientX - drag.pointerX
  const dy = event.clientY - drag.pointerY
  if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return
  moved = true

  const el = rootEl.value
  const container = el?.parentElement
  if (!el || !container) return

  const containerRect = container.getBoundingClientRect()
  const x = clamp(drag.offsetLeft + dx, 0, Math.max(0, containerRect.width - el.offsetWidth))
  const y = clamp(drag.offsetTop + dy, 0, Math.max(0, containerRect.height - el.offsetHeight))
  emit("update:position", { x, y })
}

const onPointerUp = (event: PointerEvent) => {
  if (!drag || event.pointerId !== drag.pointerId) return
  drag = null

  const el = rootEl.value
  if (el?.hasPointerCapture(event.pointerId)) {
    el.releasePointerCapture(event.pointerId)
  }

  // A click (no drag) maximizes the self-view into the main area
  if (!moved) {
    emit("focus")
  }
}
</script>
