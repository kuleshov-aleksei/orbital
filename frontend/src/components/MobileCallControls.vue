<template>
  <div data-testid="audio-controls" class="mobile-call-controls relative w-full">
    <!-- Backdrop: dims the call while the sheet is (partly) open; tap to close -->
    <div
      v-if="bodyHeight > 0"
      class="sheet-backdrop fixed inset-0 bg-black/50"
      :style="{ opacity: backdropOpacity }"
      @click="close" />

    <div
      ref="panelRef"
      class="relative rounded-t-2xl bg-theme-bg-secondary border-t border-x border-theme-border/60 shadow-[0_-8px_24px_rgba(0,0,0,0.3)]">
      <!-- Header: drag handle + main controls. Dragging anywhere here moves the sheet. -->
      <div
        ref="headerRef"
        class="sheet-header"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @click.capture="suppressClickAfterDrag">
        <button
          type="button"
          class="w-full flex justify-center pt-2 pb-1.5"
          :aria-expanded="isOpen"
          :aria-label="isOpen ? 'Hide call settings' : 'Show call settings'"
          @click="toggle">
          <span class="block w-10 h-1 rounded-full bg-theme-text-muted/50" />
        </button>

        <div class="flex items-center justify-between gap-2 px-4 pb-3">
          <MicMuteButton v-model="isMuted" size="lg" />
          <AudioDeafenButton v-model="isDeafened" size="lg" />
          <CameraButton
            v-if="!isSpatialRoom"
            v-model="isCameraEnabled"
            size="lg"
            @toggle-camera="$emit('toggle-camera', $event)"
            @auth-required="$emit('auth-required')" />
          <SoundboardButton full-width @open-change="onSoundboardOpenChange" />

          <button
            v-if="callStore.watchingUserIds.size > 0"
            type="button"
            class="control-button rounded-lg bg-amber-600 hover:bg-amber-700"
            title="Stop watching"
            @click="callStore.triggerStopWatching()">
            <PhImageBroken class="w-5 h-5" />
          </button>
          <button
            v-else
            type="button"
            class="control-button rounded-lg bg-red-600 hover:bg-red-700"
            title="Leave Room"
            @click="$emit('leave-room')">
            <PhSignOut class="w-5 h-5" />
          </button>
        </div>
      </div>

      <!-- Body: stays mounted while collapsed (height 0) so ScreenShareButton's
           confirmStartScreenShare keeps working after the quality modal. -->
      <div
        class="sheet-body overflow-hidden"
        :class="{ 'sheet-body--animate': !isDragging }"
        :style="{ height: `${bodyHeight}px` }"
        :aria-hidden="!isOpen"
        :inert="!isOpen">
        <div
          class="h-full"
          :class="isOpen ? 'overflow-y-auto overscroll-contain' : 'overflow-hidden'">
          <div ref="contentRef" class="px-4 pb-4 space-y-4">
            <!-- Call actions (screen share, switch camera) -->
            <div
              v-if="hasCallActions"
              class="rounded-xl bg-theme-bg-tertiary overflow-hidden divide-y divide-theme-border/60">
              <button
                v-if="showScreenShare"
                type="button"
                class="sheet-row"
                @click="screenShareButtonRef?.toggle()">
                <ScreenShareButton
                  ref="screenShareButtonRef"
                  v-model="isScreenSharing"
                  size="md"
                  class="pointer-events-none shrink-0"
                  @start-screen-share="onStartScreenShare"
                  @auth-required="$emit('auth-required')" />
                <span class="flex-1 text-left">{{
                  isScreenSharing ? "Stop sharing" : "Share screen"
                }}</span>
              </button>
              <button
                v-if="showFlipCamera"
                type="button"
                class="sheet-row"
                @click="handleFlipCamera">
                <span class="sheet-row-icon">
                  <PhArrowsClockwise class="w-5 h-5" />
                </span>
                <span class="flex-1 text-left">Switch camera</span>
              </button>
            </div>

            <!-- Voice -->
            <section>
              <h3
                class="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-theme-text-muted">
                Voice
              </h3>
              <div class="rounded-xl bg-theme-bg-tertiary overflow-hidden">
                <AudioQuickSettings variant="sheet" />
              </div>
            </section>

            <!-- Full settings -->
            <button
              type="button"
              class="sheet-row rounded-xl bg-theme-bg-tertiary"
              @click="openSettings">
              <span class="sheet-row-icon">
                <PhGearSix class="w-5 h-5" />
              </span>
              <span class="flex-1 min-w-0 text-left">
                <span class="block">Settings</span>
                <span class="block text-xs text-theme-text-muted">
                  Devices, volume, keybinds and more
                </span>
              </span>
              <PhCaretRight class="w-4 h-4 text-theme-text-muted shrink-0" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from "vue"
import {
  PhArrowsClockwise,
  PhCaretRight,
  PhGearSix,
  PhImageBroken,
  PhSignOut,
} from "@phosphor-icons/vue"
import MicMuteButton from "@/components/MicMuteButton.vue"
import AudioDeafenButton from "@/components/AudioDeafenButton.vue"
import CameraButton from "@/components/CameraButton.vue"
import ScreenShareButton from "@/components/ScreenShareButton.vue"
import AudioQuickSettings from "@/components/AudioQuickSettings.vue"
import SoundboardButton from "@/components/soundboard/SoundboardButton.vue"
import { useScreenShareSupport } from "@/composables/useScreenShareSupport"
import { useCallStore, useModalStore } from "@/stores"

interface Props {
  muted: boolean
  deafened: boolean
  screenSharing: boolean
  cameraEnabled: boolean
  isSpatialRoom: boolean
  hasMultipleCameras: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  "update:muted": [value: boolean]
  "update:deafened": [value: boolean]
  "update:screenSharing": [value: boolean]
  "update:cameraEnabled": [value: boolean]
  "start-screen-share": []
  "toggle-camera": [enabled: boolean]
  "flip-camera": []
  "auth-required": []
  "leave-room": []
}>()

const callStore = useCallStore()
const modalStore = useModalStore()
const { isScreenShareSupported } = useScreenShareSupport()

const isMuted = computed({
  get: () => props.muted,
  set: (value) => emit("update:muted", value),
})
const isDeafened = computed({
  get: () => props.deafened,
  set: (value) => emit("update:deafened", value),
})
const isScreenSharing = computed({
  get: () => props.screenSharing,
  set: (value) => emit("update:screenSharing", value),
})
const isCameraEnabled = computed({
  get: () => props.cameraEnabled,
  set: (value) => emit("update:cameraEnabled", value),
})

const showScreenShare = computed(() => !props.isSpatialRoom && isScreenShareSupported.value)
const showFlipCamera = computed(() => !props.isSpatialRoom && props.hasMultipleCameras)
const hasCallActions = computed(() => showScreenShare.value || showFlipCamera.value)

const screenShareButtonRef = useTemplateRef<{
  confirmStartScreenShare: () => void
  toggle: () => void
}>("screenShareButtonRef")
const contentRef = useTemplateRef<HTMLElement>("contentRef")
const headerRef = useTemplateRef<HTMLElement>("headerRef")

// ---------------------------------------------------------------------------
// Sheet state. The body's height is the single source of truth for the
// animation: 0 when collapsed, maxBodyHeight when open, follows the finger
// while dragging.
// ---------------------------------------------------------------------------
const isOpen = ref(false)
const isDragging = ref(false)
const dragHeight = ref(0)
const maxBodyHeight = ref(0)

const bodyHeight = computed(() => {
  if (isDragging.value) return dragHeight.value
  return isOpen.value ? maxBodyHeight.value : 0
})

const backdropOpacity = computed(() =>
  maxBodyHeight.value > 0 ? Math.min(1, bodyHeight.value / maxBodyHeight.value) : 0,
)

// Open height: the content's natural height, capped so the sheet covers at most
// ~75% of the screen (the rest scrolls inside the body).
function measureMaxBodyHeight() {
  const contentHeight = contentRef.value?.scrollHeight ?? 0
  const headerHeight = headerRef.value?.offsetHeight ?? 0
  const cap = Math.max(0, window.innerHeight * 0.75 - headerHeight)
  maxBodyHeight.value = Math.min(contentHeight, cap)
}

function open() {
  measureMaxBodyHeight()
  isOpen.value = true
}

function close() {
  isOpen.value = false
}

function toggle() {
  if (isOpen.value) close()
  else open()
}

// ---------------------------------------------------------------------------
// Drag. A drag only starts after the finger moves past a small threshold, so
// plain taps on the buttons still work; the click that ends a drag is swallowed.
// ---------------------------------------------------------------------------
const DRAG_THRESHOLD_PX = 6
const FLICK_VELOCITY_PX_PER_MS = 0.5

let pointerId: number | null = null
let startY = 0
let startHeight = 0
let startedOpen = false
let lastY = 0
let lastTime = 0
let velocity = 0
let swallowNextClick = false

function onPointerDown(event: PointerEvent) {
  if (event.pointerType === "mouse" && event.button !== 0) return
  pointerId = event.pointerId
  startY = lastY = event.clientY
  lastTime = event.timeStamp
  velocity = 0
  startedOpen = isOpen.value
  startHeight = bodyHeight.value
}

function onPointerMove(event: PointerEvent) {
  if (pointerId !== event.pointerId) return
  const dy = event.clientY - startY

  if (!isDragging.value) {
    if (Math.abs(dy) < DRAG_THRESHOLD_PX) return
    measureMaxBodyHeight()
    isDragging.value = true
    headerRef.value?.setPointerCapture(event.pointerId)
  }

  const dt = event.timeStamp - lastTime
  if (dt > 0) velocity = (event.clientY - lastY) / dt
  lastY = event.clientY
  lastTime = event.timeStamp

  dragHeight.value = Math.min(maxBodyHeight.value, Math.max(0, startHeight - dy))
}

function onPointerUp(event: PointerEvent) {
  if (pointerId !== event.pointerId) return
  pointerId = null
  if (!isDragging.value) return

  swallowNextClick = true
  setTimeout(() => (swallowNextClick = false), 0)

  let shouldOpen: boolean
  if (velocity < -FLICK_VELOCITY_PX_PER_MS) shouldOpen = true
  else if (velocity > FLICK_VELOCITY_PX_PER_MS) shouldOpen = false
  else {
    // Snap: switch state once the sheet moved more than a third of its range.
    const ratio = maxBodyHeight.value > 0 ? dragHeight.value / maxBodyHeight.value : 0
    shouldOpen = startedOpen ? ratio > 2 / 3 : ratio > 1 / 3
  }

  isOpen.value = shouldOpen
  isDragging.value = false
}

function suppressClickAfterDrag(event: MouseEvent) {
  if (!swallowNextClick) return
  swallowNextClick = false
  event.stopPropagation()
  event.preventDefault()
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function onSoundboardOpenChange(soundboardOpen: boolean) {
  if (soundboardOpen) close()
}

function onStartScreenShare() {
  close()
  emit("start-screen-share")
}

function handleFlipCamera() {
  emit("flip-camera")
}

function openSettings() {
  close()
  modalStore.openUserSettingsModal()
}

// Android back / Escape closes the sheet first.
function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && isOpen.value) close()
}

// Keep the open height right when the viewport changes (rotation, keyboard).
function onResize() {
  if (isOpen.value) measureMaxBodyHeight()
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown)
  window.addEventListener("resize", onResize)
})

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown)
  window.removeEventListener("resize", onResize)
})

defineExpose({
  confirmStartScreenShare: () => screenShareButtonRef.value?.confirmStartScreenShare(),
})
</script>

<style scoped>
/* One uniform 44px touch target per main-row button. Overrides the desktop
   size classes (h-10 w-14) of the shared button components on purpose. */
.sheet-header :deep(.control-button) {
  width: 2.75rem;
  height: 2.75rem;
}

.sheet-header {
  touch-action: none;
}

.sheet-body--animate {
  transition: height 220ms var(--ease-out-smooth, cubic-bezier(0.22, 1, 0.36, 1));
}

.sheet-backdrop {
  transition: opacity 220ms ease-out;
}

.sheet-row {
  display: flex;
  width: 100%;
  min-height: 3.5rem;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  color: var(--color-theme-text-primary);
  transition: background-color 150ms ease-out;
}

.sheet-row:active {
  background-color: var(--color-theme-bg-hover);
}

.sheet-row-icon {
  display: flex;
  width: 2.5rem;
  height: 2.5rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background-color: var(--color-theme-bg-secondary);
  color: var(--color-theme-text-secondary);
}

@media (prefers-reduced-motion: reduce) {
  .sheet-body--animate,
  .sheet-backdrop {
    transition: none;
  }
}
</style>
