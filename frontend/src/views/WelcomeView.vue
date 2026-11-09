<template>
  <div
    class="welcome-view flex-1 flex flex-col px-4 py-6 lg:p-8 overflow-y-auto"
    data-testid="welcome-view">
    <div class="w-full max-w-5xl mx-auto">
      <!-- Header -->
      <header class="mb-6">
        <h2 class="text-2xl font-semibold text-theme-text-primary">
          Hey, {{ userStore.nickname }}
        </h2>
        <p class="text-sm text-theme-text-muted mt-1">{{ subtitle }}</p>
      </header>

      <div class="space-y-8">
        <!-- Active now -->
        <section v-if="lobby.active.length > 0" data-testid="lobby-active">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-theme-text-secondary mb-3">
            Active now
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ActiveRoomCard
              v-for="room in lobby.active"
              :key="room.id"
              :room="room"
              @select="$emit('room-selected', $event)" />
          </div>
        </section>

        <!-- Online, not in voice -->
        <section v-if="idleUsers.length > 0" data-testid="lobby-online">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-theme-text-secondary mb-3">
            Online, not in voice
            <span class="text-theme-text-muted font-normal">— {{ idleUsers.length }}</span>
          </h3>
          <ul class="flex flex-wrap gap-2">
            <li
              v-for="user in idleUsers"
              :key="user.id"
              class="flex items-center gap-2 max-w-full pl-1 pr-3 py-1 rounded-full bg-theme-bg-secondary border border-theme-border">
              <UserAvatar
                :user-id="user.id"
                :nickname="user.nickname"
                :avatar-url="user.avatar_url"
                :size="24"
                :show-status="false" />
              <span
                class="text-sm text-theme-text-primary truncate"
                :style="permissionsStore.nameStyleOf(user.id)"
                >{{ user.nickname }}</span
              >
              <span
                v-if="user.custom_status || user.custom_status_emoji"
                class="text-xs text-theme-text-muted truncate max-w-48"
                :title="user.custom_status">
                <EmojiGlyph
                  v-if="user.custom_status_emoji"
                  :emoji-ref="user.custom_status_emoji"
                  :size="12"
                  class="mr-0.5" />{{ user.custom_status }}
              </span>
            </li>
          </ul>
        </section>

        <!-- Remaining (empty) rooms -->
        <section v-if="lobby.idle.length > 0" data-testid="lobby-rooms">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-theme-text-secondary mb-3">
            {{ lobby.active.length > 0 ? "Other rooms" : "Rooms" }}
          </h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            <button
              v-for="room in lobby.idle"
              :key="room.id"
              type="button"
              :data-testid="`room-card-${room.id}`"
              class="group flex items-center gap-3 px-3 py-2.5 rounded-lg bg-theme-bg-secondary border border-theme-border hover:border-theme-accent hover:bg-theme-bg-hover transition-colors text-left cursor-pointer"
              @click="$emit('room-selected', room.id)">
              <component
                :is="room.type === 'spatial_audio' ? PhGlobe : PhSpeakerHigh"
                class="w-4 h-4 shrink-0 text-theme-text-muted" />
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-medium text-theme-text-primary truncate">
                  <EmojiText :text="room.name" />
                </span>
                <span
                  v-if="room.category_name || room.category"
                  class="block text-xs text-theme-text-muted truncate">
                  {{ room.category_name || room.category }}
                </span>
              </span>
              <span
                class="text-xs font-medium text-theme-accent opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
                Join
              </span>
            </button>
          </div>
        </section>

        <!-- No rooms at all -->
        <div
          v-if="rooms.length === 0"
          class="flex flex-col items-center justify-center py-16 px-4 rounded-xl border border-dashed border-theme-border">
          <div
            class="w-16 h-16 bg-theme-bg-secondary rounded-full flex items-center justify-center mb-5">
            <PhMicrophone class="w-8 h-8 text-theme-text-muted" />
          </div>
          <h3 class="text-lg font-semibold text-theme-text-primary mb-2">No rooms yet</h3>
          <p class="text-theme-text-muted text-center max-w-sm mb-6 text-sm">
            Create a room to start talking with your squad.
          </p>
          <button
            v-if="canManageAnyRooms"
            type="button"
            data-testid="create-room-empty"
            class="px-5 py-2.5 bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent rounded-lg transition-colors duration-200 font-medium cursor-pointer"
            @click="$emit('create-room')">
            Create First Room
          </button>
          <p v-else class="text-theme-text-muted text-sm">Ask an admin to create a room</p>
        </div>

        <!-- Mic check -->
        <MicCheckCard />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import EmojiText from "@/components/common/EmojiText.vue"
import { computed } from "vue"
import { storeToRefs } from "pinia"
import { PhGlobe, PhMicrophone, PhSpeakerHigh } from "@phosphor-icons/vue"
import { useRoomStore, usePermissionsStore, useUsersStore, useUserStore } from "@/stores"
import UserAvatar from "@/components/UserAvatar.vue"
import EmojiGlyph from "@/components/EmojiGlyph.vue"
import ActiveRoomCard from "@/components/lobby/ActiveRoomCard.vue"
import MicCheckCard from "@/components/lobby/MicCheckCard.vue"
import { inVoiceUserIds, onlineIdleUsers, partitionRooms } from "@/components/lobby/lobby"

defineEmits<{
  "room-selected": [roomId: string]
  "create-room": []
}>()

const roomStore = useRoomStore()
const usersStore = useUsersStore()
const userStore = useUserStore()
const { rooms } = storeToRefs(roomStore)
const permissionsStore = usePermissionsStore()
const { canManageAnyRooms } = storeToRefs(permissionsStore)

const lobby = computed(() => partitionRooms(rooms.value ?? []))
const inVoice = computed(() => inVoiceUserIds(rooms.value ?? []))
const idleUsers = computed(() =>
  onlineIdleUsers(usersStore.sortedUsers, inVoice.value, userStore.userId),
)

const subtitle = computed(() => {
  const n = inVoice.value.size
  if (n === 0) return "It's quiet right now. Start a conversation."
  return n === 1 ? "1 person is in voice." : `${n} people are in voice.`
})
</script>
