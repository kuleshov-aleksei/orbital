<template>
  <div class="mt-1 flex flex-col gap-1.5 items-start max-w-full" data-testid="message-embeds">
    <div
      v-for="embed in embeds"
      :key="embed.url"
      class="group/embed relative max-w-full w-full flex">
      <LinkEmbed :embed="embed" />
      <button
        v-if="removable"
        type="button"
        class="ml-1 self-start rounded p-1 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover focus-visible:opacity-100 transition-opacity"
        :class="isMobile ? 'opacity-70' : 'opacity-0 group-hover/embed:opacity-100'"
        title="Remove previews"
        aria-label="Remove link previews"
        data-testid="embed-remove"
        @click="$emit('remove')">
        <PhX class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from "pinia"
import { PhX } from "@phosphor-icons/vue"
import LinkEmbed from "./LinkEmbed.vue"
import { useAppStore } from "@/stores/app"
import type { TextEmbed } from "@/types/textChat"

defineProps<{
  embeds: TextEmbed[]
  /** The viewer is the author or may manage messages. */
  removable?: boolean
}>()
defineEmits<{ remove: [] }>()

const { isMobile } = storeToRefs(useAppStore())
</script>
