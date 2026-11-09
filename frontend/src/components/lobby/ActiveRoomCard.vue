<template>
  <button
    type="button"
    :data-testid="`room-card-${room.id}`"
    class="group w-full text-left bg-theme-bg-secondary rounded-xl p-4 border border-theme-border hover:border-theme-accent hover:bg-theme-bg-hover transition-colors duration-150 cursor-pointer"
    @click="$emit('select', room.id)">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2 text-theme-text-primary">
          <component :is="typeIcon" class="w-4 h-4 shrink-0 text-theme-text-muted" />
          <h3 class="text-base font-semibold truncate"><EmojiText :text="room.name" pausable /></h3>
        </div>
        <p
          v-if="room.category_name || room.category"
          class="text-xs text-theme-text-muted mt-0.5 truncate">
          {{ room.category_name || room.category }}
        </p>
      </div>

      <div class="flex items-center gap-1.5 shrink-0">
        <span
          v-if="hasScreenShare"
          class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] font-bold uppercase tracking-wide"
          title="Someone is sharing their screen">
          <PhMonitor class="w-3 h-3" />
          Live
        </span>
        <span
          v-if="hasCamera"
          class="inline-flex items-center px-1.5 py-0.5 rounded bg-theme-bg-tertiary text-theme-text-secondary"
          title="Camera on">
          <PhVideoCamera class="w-3 h-3" />
        </span>
        <span class="text-xs text-theme-text-muted tabular-nums">
          {{ count }}/{{ room.max_users }}
        </span>
      </div>
    </div>

    <div class="mt-4 flex items-center justify-between gap-3">
      <div class="flex items-center min-w-0">
        <div class="flex -space-x-2">
          <div
            v-for="user in visibleUsers"
            :key="user.id"
            class="relative rounded-full ring-2 ring-theme-bg-secondary group-hover:ring-theme-bg-hover"
            :title="user.nickname">
            <UserAvatar
              :user-id="user.id"
              :nickname="user.nickname"
              :size="32"
              :show-status="false" />
            <span
              v-if="user.is_deafened || user.is_muted"
              class="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-theme-bg-primary flex items-center justify-center">
              <PhSpeakerSlash v-if="user.is_deafened" class="w-2.5 h-2.5 text-red-400" />
              <PhMicrophoneSlash v-else class="w-2.5 h-2.5 text-red-400" />
            </span>
          </div>
          <div
            v-if="overflow > 0"
            class="w-8 h-8 rounded-full ring-2 ring-theme-bg-secondary bg-theme-bg-tertiary text-theme-text-secondary text-xs font-semibold flex items-center justify-center">
            +{{ overflow }}
          </div>
        </div>
        <p class="ml-3 text-sm text-theme-text-secondary truncate">{{ namesLabel }}</p>
      </div>

      <span
        class="shrink-0 text-sm font-medium text-theme-accent group-hover:text-theme-accent-hover">
        Join →
      </span>
    </div>
  </button>
</template>

<script setup lang="ts">
import EmojiText from "@/components/common/EmojiText.vue"
import { computed } from "vue"
import {
  PhGlobe,
  PhMicrophoneSlash,
  PhMonitor,
  PhSpeakerHigh,
  PhSpeakerSlash,
  PhVideoCamera,
} from "@phosphor-icons/vue"
import UserAvatar from "@/components/UserAvatar.vue"
import type { Room } from "@/types"

const props = defineProps<{ room: Room }>()

defineEmits<{ select: [roomId: string] }>()

const MAX_AVATARS = 5

const users = computed(() => props.room.users ?? [])
const count = computed(() => users.value.length || props.room.user_count)
const visibleUsers = computed(() => users.value.slice(0, MAX_AVATARS))
const overflow = computed(() => Math.max(0, users.value.length - MAX_AVATARS))

const typeIcon = computed(() => (props.room.type === "spatial_audio" ? PhGlobe : PhSpeakerHigh))
const hasScreenShare = computed(() => users.value.some((u) => u.is_screen_sharing))
const hasCamera = computed(() => users.value.some((u) => u.is_camera_enabled))

const namesLabel = computed(() => {
  const names = users.value.map((u) => u.nickname)
  if (names.length <= 2) return names.join(" and ")
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`
})
</script>
