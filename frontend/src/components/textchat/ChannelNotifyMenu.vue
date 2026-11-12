<template>
  <div ref="root" class="relative">
    <button
      type="button"
      class="w-8 h-8 flex items-center justify-center rounded text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover transition-colors"
      :class="{ 'text-theme-text-primary bg-theme-bg-hover': open }"
      :title="buttonTitle"
      :aria-label="buttonTitle"
      :aria-expanded="open"
      aria-haspopup="menu"
      data-testid="channel-notify-button"
      @click="open = !open">
      <PhBellSlash v-if="mode === 'muted'" class="w-5 h-5 text-red-400" />
      <PhBellSimpleSlash v-else-if="mode === 'no_mentions'" class="w-5 h-5" />
      <PhBell v-else class="w-5 h-5" />
    </button>
    <ChannelNotifyOptions
      v-if="open"
      class="absolute right-0 top-full mt-1 z-30"
      :room-id="roomId"
      @done="open = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue"
import { PhBell, PhBellSimpleSlash, PhBellSlash } from "@phosphor-icons/vue"
import ChannelNotifyOptions from "./ChannelNotifyOptions.vue"
import { describeMute, useTextNotifyStore } from "@/stores/textNotify"

const props = defineProps<{ roomId: string }>()

const notifyStore = useTextNotifyStore()
const open = ref(false)
const root = useTemplateRef<HTMLDivElement>("root")

const mode = computed(() => notifyStore.modeOf(props.roomId))
const buttonTitle = computed(() => {
  if (mode.value === "muted") return describeMute(notifyStore.settingOf(props.roomId))
  if (mode.value === "no_mentions") return "Mentions are off for this channel"
  return "Notification settings"
})

function onPointerDown(event: PointerEvent) {
  if (open.value && root.value && !root.value.contains(event.target as Node)) open.value = false
}

onMounted(() => document.addEventListener("pointerdown", onPointerDown))
onBeforeUnmount(() => document.removeEventListener("pointerdown", onPointerDown))
</script>
