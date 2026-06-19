<template>
  <div
    class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-4 py-3 transition-opacity duration-200"
    :class="dynamicClasses">
    <div class="flex items-center justify-between">
      <!-- Left: Focus Button or Volume -->
      <div v-if="!fullscreen">
        <div v-if="!isFocused && showFocusButton">
          <button
            type="button"
            class="px-3 py-1.5 bg-theme-bg-tertiary/80 hover:bg-theme-bg-hover rounded-lg text-theme-text-primary text-sm flex items-center transition-colors"
            @click="$emit('make-focused')">
            <PhArrowsOut class="w-4 h-4 mr-1" />
            Focus
          </button>
        </div>
        <div v-else />
      </div>

      <div v-else class="flex items-center space-x-2">
        <VolumeSlider
          :volume="localVolume"
          :is-muted="isMuted"
          :accent="fullscreenAccent"
          @update:volume="$emit('volume-change', $event, true)"
          @toggle-mute="$emit('toggle-mute')" />
      </div>

      <!-- Right: Controls -->
      <div v-if="!fullscreen" class="flex items-center space-x-2">
        <VolumeSlider
          :volume="localVolume"
          :is-muted="isMuted"
          :accent="normalAccent"
          @update:volume="$emit('volume-change', $event, true)"
          @toggle-mute="$emit('toggle-mute')" />

        <button
          type="button"
          class="p-2 bg-red-600/80 hover:bg-red-600 rounded-lg text-theme-text-primary text-xs flex items-center gap-1.5 transition-colors"
          :title="stopLabel"
          @click="handleStop">
          <PhImageBroken class="w-4 h-4" />
          Stop
        </button>

        <button
          type="button"
          class="p-2 bg-theme-bg-tertiary/80 hover:bg-theme-bg-hover rounded-lg text-theme-text-primary transition-colors"
          title="Fullscreen"
          @click="$emit('toggle-fullscreen')">
          <PhArrowsOut class="w-4 h-4" />
        </button>

        <button
          type="button"
          class="p-2 bg-theme-bg-tertiary/80 hover:bg-theme-bg-hover rounded-lg text-theme-text-primary transition-colors"
          title="Picture in Picture"
          @click="$emit('toggle-pip')">
          <PhPictureInPicture class="w-4 h-4" />
        </button>
      </div>

      <div v-else class="flex items-center space-x-3">
        <button
          type="button"
          class="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
          :class="callMuteButtonClass"
          :title="isCallMuted ? 'Unmute' : 'Mute'"
          @click="$emit('toggle-call-mute')">
          <PhMicrophoneSlash v-if="isCallMuted" class="w-4 h-4" />
          <PhMicrophone v-else class="w-4 h-4" />
        </button>

        <button
          type="button"
          class="w-9 h-9 rounded-full flex items-center justify-center transition-colors relative"
          :class="callDeafenButtonClass"
          :title="isCallDeafened ? 'Undeafen' : 'Deafen'"
          @click="$emit('toggle-call-deafen')">
          <div class="relative">
            <PhHeadphones class="w-4 h-4" />
            <div v-if="isCallDeafened" class="absolute inset-0 flex items-center justify-center">
              <div class="w-5 h-0.5 bg-current rotate-45" />
            </div>
          </div>
        </button>

        <div class="w-px h-6 bg-white/20" />

        <button
          type="button"
          class="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition-colors"
          title="Exit Fullscreen"
          @click="$emit('toggle-fullscreen')">
          <PhArrowsIn class="w-5 h-5" />
        </button>

        <button
          type="button"
          class="p-2 bg-red-600/80 hover:bg-red-600 rounded-lg text-white text-xs font-medium flex items-center gap-1.5 transition-colors"
          :title="stopLabel"
          @click="handleStop">
          <PhImageBroken class="w-5 h-5" />
          Stop
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import {
  PhArrowsOut,
  PhPictureInPicture,
  PhImageBroken,
  PhArrowsIn,
  PhMicrophone,
  PhMicrophoneSlash,
  PhHeadphones,
} from "@phosphor-icons/vue"
import VolumeSlider from "./VolumeSlider.vue"

const props = defineProps<{
  fullscreen?: boolean
  isHovered?: boolean
  isFocused?: boolean
  showFocusButton?: boolean
  isSelfView?: boolean
  localVolume: number
  isMuted: boolean
  isCallMuted?: boolean
  isCallDeafened?: boolean
}>()

const emit = defineEmits<{
  "make-focused": []
  "volume-change": [volume: number, isScreenShare: boolean]
  "toggle-mute": []
  "toggle-fullscreen": []
  "toggle-pip": []
  "toggle-call-mute": []
  "toggle-call-deafen": []
  unsubscribe: []
  "stop-own-screen-share": []
}>()

const normalAccent = "accent-theme-accent"
const fullscreenAccent = "accent-white"

const dynamicClasses = computed(() => {
  if (props.fullscreen) {
    return {
      "opacity-100": props.isHovered,
      "opacity-0": !props.isHovered,
    }
  }
  return {
    "opacity-100": props.isHovered,
    "opacity-0": !props.isHovered,
  }
})

const stopLabel = computed(() => (props.isSelfView ? "Stop sharing" : "Stop watching"))

const callMuteButtonClass = computed(() => {
  return props.isCallMuted
    ? "bg-red-600 hover:bg-red-700 text-white"
    : "bg-white/10 hover:bg-white/20 text-white"
})

const callDeafenButtonClass = computed(() => {
  return props.isCallDeafened
    ? "bg-red-600 hover:bg-red-700 text-white"
    : "bg-white/10 hover:bg-white/20 text-white"
})

const handleStop = () => {
  if (props.isSelfView) {
    emit("stop-own-screen-share")
  } else {
    emit("unsubscribe")
  }
}
</script>
