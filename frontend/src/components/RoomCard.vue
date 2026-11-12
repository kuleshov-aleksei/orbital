<template>
  <div
    class="room-card px-2 py-1.5 mb-0.5 rounded-md cursor-pointer transition-all duration-200 group"
    :class="{
      'bg-theme-accent text-theme-text-on-accent': isActive,
      'bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-secondary hover:text-theme-text-primary':
        !isActive && !isLocked,
      'bg-theme-bg-tertiary text-theme-text-muted opacity-60 cursor-not-allowed':
        isLocked && !isActive,
      'opacity-50': isDragging,
    }"
    :title="isLocked ? 'You don\'t have permission to join this room' : undefined"
    :data-locked="isLocked || undefined"
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
          <TextChannelIcon v-if="room.type === 'text'" :room-id="room.id" class="w-4 h-4" />
          <PhWaveform v-else-if="room.type !== 'spatial_audio'" class="w-4 h-4" />
          <PhGameController v-else class="w-4 h-4" />
        </div>
      </div>

      <!-- Room Info -->
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5 min-w-0">
            <EmojiText
              :text="room.name"
              pausable
              class="text-sm truncate"
              :class="[
                isUnread && !isActive ? 'font-bold text-theme-text-primary' : 'font-medium',
                notifyMode === 'muted' && !isActive ? 'opacity-50' : '',
              ]" />
            <PhBellSlash
              v-if="notifyMode === 'muted'"
              class="w-3 h-3 flex-shrink-0 opacity-70"
              aria-label="Muted"
              data-testid="text-channel-muted" />
            <PhBellSimpleSlash
              v-else-if="notifyMode === 'no_mentions'"
              class="w-3 h-3 flex-shrink-0 opacity-70"
              aria-label="Mentions off" />
            <PhLock
              v-if="isLocked"
              class="w-3 h-3 flex-shrink-0"
              aria-label="No permission to join" />
            <span
              v-if="room.type === 'spatial_audio'"
              class="text-[10px] px-1.5 py-0.5 rounded-full bg-theme-accent/20 text-theme-accent font-medium flex-shrink-0">
              Spatial
            </span>
          </div>

          <span
            v-if="room.type === 'text' && mentionCount > 0"
            class="ml-2 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0"
            data-testid="text-channel-mentions"
            :aria-label="`${mentionCount} unread ${mentionCount === 1 ? 'mention' : 'mentions'}`"
            >{{ mentionCount > 99 ? "99+" : mentionCount }}</span
          >
          <span
            v-else-if="room.type === 'text'"
            v-show="isUnread && !isActive"
            class="ml-2 w-2 h-2 rounded-full bg-theme-text-primary flex-shrink-0"
            data-testid="text-channel-unread"
            aria-label="Unread messages" />
          <div v-else class="text-xs opacity-70 ml-2 flex-shrink-0">
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
            <span class="truncate opacity-90" :style="permissionsStore.nameStyleOf(user.id)">{{
              user.nickname
            }}</span>
          </div>

          <!-- Status Icons (right side) -->
          <div class="flex items-center gap-1 flex-shrink-0">
            <PhMicrophone
              v-if="!user.is_muted && !user.is_deafened"
              class="w-3.5 h-3.5 text-green-400" />

            <PhMicrophoneSlash v-if="user.is_muted" class="w-3.5 h-3.5 text-red-400" />

            <PhHeadphones v-if="user.is_deafened" class="w-3.5 h-3.5 text-red-400" />

            <PhVideoCamera
              v-if="user.is_camera_enabled"
              class="w-3.5 h-3.5 text-blue-400"
              aria-label="Camera on" />

            <PhMonitor
              v-if="user.is_screen_sharing"
              class="w-3.5 h-3.5 text-blue-400"
              aria-label="Sharing screen" />
          </div>
        </div>
      </div>
    </div>

    <!-- User Context Menu -->
    <UserContextMenu ref="userContextMenuRef" :room-id="room.id" />
  </div>
</template>

<script setup lang="ts">
import TextChannelIcon from "@/components/textchat/TextChannelIcon.vue"
import EmojiText from "@/components/common/EmojiText.vue"
import { useTemplateRef } from "vue"
import {
  PhWaveform,
  PhGameController,
  PhMicrophone,
  PhHeadphones,
  PhMicrophoneSlash,
  PhMonitor,
  PhVideoCamera,
  PhLock,
  PhBellSlash,
  PhBellSimpleSlash,
} from "@phosphor-icons/vue"
import UserAvatar from "./UserAvatar.vue"
import UserContextMenu from "./UserContextMenu.vue"
import { usePermissionsStore } from "@/stores"
import type { Room } from "@/types"

const props = withDefaults(defineProps<Props>(), {
  isDraggable: true,
  isLocked: false,
  isUnread: false,
  notifyMode: "all",
  mentionCount: 0,
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

const permissionsStore = usePermissionsStore()

interface Props {
  room: Room
  isActive: boolean
  isDragging?: boolean
  isDraggable?: boolean
  /** The user can see but not join (no Connect): rendered grayed out with a lock. */
  isLocked?: boolean
  /** Text channel with messages newer than the read position. */
  isUnread?: boolean
  notifyMode?: "all" | "no_mentions" | "muted"
  mentionCount?: number
}

const showContextMenu = (event: MouseEvent) => {
  emit("show-context-menu", event, props.room)
}

const userContextMenuRef =
  useTemplateRef<InstanceType<typeof UserContextMenu>>("userContextMenuRef")

const showUserContextMenu = (event: MouseEvent, userId: string) => {
  event.preventDefault()
  event.stopPropagation()
  userContextMenuRef.value?.show(event, userId)
}
</script>
