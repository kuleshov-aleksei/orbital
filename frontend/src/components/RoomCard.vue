<template>
  <div
    class="room-card px-2 py-1.5 mb-0.5 rounded-md cursor-pointer transition-all duration-200 group"
    :class="{
      'bg-theme-accent text-white': isActive,
      'bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-secondary hover:text-theme-text-primary':
        !isActive,
      'opacity-50': isDragging,
    }"
    v-bind="isDraggable ? { draggable: true } : {}"
    @click="$emit('click')"
    @contextmenu.prevent="showContextMenu"
    @dragstart="$emit('dragstart', $event)"
    @dragend="$emit('dragend', $event)"
    @dragover.prevent="$emit('dragover', $event)"
    @drop="$emit('drop', $event)"
    @dragenter.prevent="$emit('dragenter', $event)"
    @dragleave="$emit('dragleave', $event)">
    <!-- Room Header -->
    <div class="flex items-center">
      <!-- Room Icon -->
      <div class="mr-2">
        <div
          class="w-7 h-7 rounded-md flex items-center justify-center"
          :class="{
            'bg-theme-accent/80': isActive,
            'bg-theme-bg-hover group-hover:bg-theme-border': !isActive,
          }">
          <PhWaveform class="w-4 h-4" />
        </div>
      </div>

      <!-- Room Info -->
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between">
          <div class="font-medium text-sm truncate">{{ room.name }}</div>

          <div class="text-xs opacity-70 ml-2 flex-shrink-0">
            {{ room.user_count }}/{{ room.max_users }}
          </div>
        </div>
      </div>
    </div>

    <!-- Users List -->
    <div v-if="room.users && room.users.length > 0" class="mt-1 pl-9">
      <div class="space-y-0.5">
        <div
          v-for="user in room.users"
          :key="user.id"
          class="flex items-center justify-between text-xs py-0.5 pr-1 rounded hover:bg-theme-bg-hover"
          @contextmenu="showUserContextMenu($event, user.id)">
          <div class="flex items-center min-w-0">
            <!-- Avatar -->
            <UserAvatar
              :user-id="user.id"
              :nickname="user.nickname"
              :size="24"
              :show-status="false"
              class="mr-2 flex-shrink-0" />

            <!-- Nickname -->
            <span class="truncate opacity-90">{{ user.nickname }}</span>
          </div>

          <!-- Status Icons (right side) -->
          <div class="flex items-center gap-1 flex-shrink-0">
            <PhMicrophone
              v-if="
                !getGlobalUserAudioState(user.id).is_muted &&
                !getGlobalUserAudioState(user.id).is_deafened
              "
              class="w-3.5 h-3.5 text-green-400" />

            <PhMicrophoneSlash
              v-if="getGlobalUserAudioState(user.id).is_muted"
              class="w-3.5 h-3.5 text-red-400" />

            <PhHeadphones
              v-if="getGlobalUserAudioState(user.id).is_deafened"
              class="w-3.5 h-3.5 text-red-400" />

            <PhMonitor v-if="user.is_screen_sharing" class="w-3.5 h-3.5 text-blue-400" />
          </div>
        </div>
      </div>
    </div>

    <!-- User Context Menu -->
    <UserContextMenu ref="userContextMenuRef" />
  </div>
</template>

<script setup lang="ts">
import { useTemplateRef } from "vue"
import {
  PhWaveform,
  PhMicrophone,
  PhHeadphones,
  PhMicrophoneSlash,
  PhMonitor,
} from "@phosphor-icons/vue"
import UserAvatar from "./UserAvatar.vue"
import UserContextMenu from "./UserContextMenu.vue"
import { useUserStore } from "@/stores"

// Use snake_case to match backend API and global types
interface RoomPreviewUser {
  id: string
  nickname: string
  role: string
  is_muted: boolean
  is_deafened: boolean
  is_speaking: boolean
  is_screen_sharing?: boolean
}

interface Room {
  id: string
  name: string
  user_count: number
  max_users: number
  category: string
  sort_order: number
  users?: RoomPreviewUser[]
}

interface Props {
  room: Room
  isActive: boolean
  isDragging?: boolean
  isDraggable?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isDraggable: true,
})
const emit = defineEmits<{
  click: []
  "show-context-menu": [event: MouseEvent, room: Room]
  dragstart: [event: DragEvent]
  dragend: [event: DragEvent]
  dragover: [event: DragEvent]
  drop: [event: DragEvent]
  dragenter: [event: DragEvent]
  dragleave: [event: DragEvent]
}>()

const showContextMenu = (event: MouseEvent) => {
  emit("show-context-menu", event, props.room)
}

const userStore = useUserStore()
const getGlobalUserAudioState = userStore.getGlobalUserAudioState

const userContextMenuRef =
  useTemplateRef<InstanceType<typeof UserContextMenu>>("userContextMenuRef")

const showUserContextMenu = (event: MouseEvent, userId: string) => {
  event.preventDefault()
  event.stopPropagation()
  userContextMenuRef.value?.show(event, userId)
}
</script>
