<template>
  <div
    class="room-sidebar"
    :class="{
      'w-72 bg-theme-bg-secondary flex flex-col min-h-0': !isMobileView,
      'flex-1 flex flex-col bg-theme-bg-primary': isMobileView,
      'fixed lg:relative inset-y-0 left-0 z-40 transform -translate-x-full lg:translate-x-0 transition-transform duration-300':
        !isMobileView,
      'translate-x-0': !isHidden && !isMobileView,
    }">
    <div v-if="!isMobileView" class="hidden h-16 lg:flex p-4 border-b border-theme-border">
      <h2 class="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider">
        Rooms
      </h2>
    </div>

    <div v-if="isMobileView" class="p-4 border-b border-theme-border">
      <h2 class="text-xl font-semibold text-theme-text-primary">Available Rooms</h2>
      <p class="text-sm text-theme-text-muted mt-1">
        {{ rooms?.length || 0 }} room{{ (rooms?.length || 0) !== 1 ? "s" : "" }}
      </p>
    </div>

    <div class="flex-1 overflow-y-auto min-h-0">
      <div
        v-if="catDrag.draggedCategory.value"
        class="h-2 rounded transition-all duration-200"
        :class="{
          'bg-purple-500/50 h-4': catDrag.activeCategoryDropZone.value?.position === 'before-first',
        }"
        @dragover.prevent="catDrag.handleCategoryDropZoneDragOver($event, 'before-first')"
        @drop="catDrag.handleCategoryDropZoneDrop($event, 0)" />

      <template v-for="(category, categoryIndex) in categorizedRooms" :key="category.id">
        <div class="mb-4">
          <div class="px-2 py-1">
            <div
              class="w-full flex items-center justify-between px-2 py-1 text-xs font-medium text-theme-text-muted hover:text-theme-text-primary transition-colors duration-200 cursor-pointer group"
              :class="{
                'ring-2 ring-purple-400 ring-offset-2 ring-offset-theme-bg-primary':
                  catDrag.draggedCategory.value?.id === category.id,
              }"
              v-bind="isDraggable ? { draggable: true } : {}"
              @click="toggleCategory(category.name)"
              @contextmenu.prevent="contextMenuRef.showCategoryMenu($event, category)"
              @dragstart="catDrag.handleCategoryDragStart($event, category)"
              @dragend="catDrag.handleCategoryDragEnd">
              <span>{{ category.name }}</span>
              <div class="flex items-center gap-1">
                <PhDotsThree
                  class="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity"
                  @click.stop="contextMenuRef.showCategoryMenu($event, category)" />
                <PhCaretDown
                  class="w-3 h-3 transition-transform duration-200"
                  :class="{ 'rotate-180': expandedCategories.has(category.name) }" />
              </div>
            </div>
          </div>

          <div v-show="expandedCategories.has(category.name)" class="px-2">
            <div
              v-if="roomDrag.draggedRoom.value"
              class="h-2 rounded transition-all duration-200"
              :class="{
                'bg-indigo-500/50 h-8':
                  roomDrag.activeDropZone.value?.categoryId === category.id &&
                  roomDrag.activeDropZone.value?.position === 'before-first',
              }"
              @dragover.prevent="
                roomDrag.handleDropZoneDragOver($event, category.id, 'before-first')
              "
              @drop="roomDrag.handleDropZoneDrop($event, category.id, 0)" />

            <template v-for="(room, index) in category.rooms" :key="room.id">
              <RoomCard
                :room="room"
                :is-active="room.id === props.activeRoomId"
                :is-dragging="roomDrag.draggedRoom.value?.id === room.id"
                :is-draggable="isDraggable"
                @click="handleRoomClick(room)"
                @show-context-menu="(e: MouseEvent) => contextMenuRef.showRoomMenu(e, room)"
                @dragstart="roomDrag.handleDragStart($event, room, category.id)"
                @dragend="roomDrag.handleDragEnd" />

              <div
                v-if="roomDrag.draggedRoom.value && index < category.rooms.length - 1"
                class="h-2 rounded transition-all duration-200"
                :class="{
                  'bg-indigo-500/50 h-8':
                    roomDrag.activeDropZone.value?.categoryId === category.id &&
                    roomDrag.activeDropZone.value?.position === index,
                }"
                @dragover.prevent="roomDrag.handleDropZoneDragOver($event, category.id, index)"
                @drop="roomDrag.handleDropZoneDrop($event, category.id, index + 1)" />
            </template>

            <div
              v-if="roomDrag.draggedRoom.value"
              class="h-2 rounded transition-all duration-200"
              :class="{
                'bg-indigo-500/50 h-8':
                  roomDrag.activeDropZone.value?.categoryId === category.id &&
                  roomDrag.activeDropZone.value?.position === 'after-last',
              }"
              @dragover.prevent="roomDrag.handleDropZoneDragOver($event, category.id, 'after-last')"
              @drop="roomDrag.handleDropZoneDrop($event, category.id, category.rooms.length)" />

            <div
              v-if="
                roomDrag.draggedRoom.value && roomDrag.draggedRoom.value.category !== category.id
              "
              class="h-8 rounded-lg border-2 border-dashed border-indigo-400 bg-indigo-500/10 flex items-center justify-center text-xs text-indigo-300"
              @dragover.prevent="roomDrag.handleCategoryDragOver($event, category.id)"
              @drop="roomDrag.handleCategoryDrop($event, category.id)">
              Drop here to move to {{ category.name }}
            </div>
          </div>
        </div>

        <div
          v-if="catDrag.draggedCategory.value && categoryIndex < categorizedRooms.length - 1"
          class="h-2 rounded transition-all duration-200"
          :class="{
            'bg-purple-500/50 h-4':
              catDrag.activeCategoryDropZone.value?.position === categoryIndex,
          }"
          @dragover.prevent="catDrag.handleCategoryDropZoneDragOver($event, categoryIndex)"
          @drop="catDrag.handleCategoryDropZoneDrop($event, categoryIndex + 1)" />
      </template>

      <div
        v-if="catDrag.draggedCategory.value"
        class="h-2 rounded transition-all duration-200"
        :class="{
          'bg-purple-500/50 h-4': catDrag.activeCategoryDropZone.value?.position === 'after-last',
        }"
        @dragover.prevent="catDrag.handleCategoryDropZoneDragOver($event, 'after-last')"
        @drop="catDrag.handleCategoryDropZoneDrop($event, categorizedRooms.length)" />
    </div>

    <div v-if="isAdmin" class="p-3 border-t border-theme-border">
      <button
        type="button"
        data-testid="create-room-sidebar"
        class="w-full flex items-center justify-center px-3 py-2 bg-theme-accent hover:bg-theme-accent-hover rounded-lg transition-colors duration-200"
        @click="$emit('create-room')">
        <PhPlus class="w-4 h-4 mr-2 text-theme-text-on-accent" />
        <span class="text-sm font-medium text-theme-text-on-accent">Create Room</span>
      </button>
    </div>

    <SidebarContextMenu
      ref="contextMenuRef"
      :is-admin="isAdmin"
      :categories="categories"
      @create-room-in-category="emit('create-room-in-category', $event)"
      @rename-category="emit('rename-category', $event)"
      @delete-category="emit('delete-category', $event)"
      @move-room="handleMovedRoom"
      @edit-room="emit('edit-room', $event)"
      @delete-room="emit('delete-room', $event)" />

    <div
      v-if="contextMenuRef?.isAnyMenuOpen?.value"
      class="fixed inset-0 z-40"
      @click="contextMenuRef.closeAll()"
      @contextmenu.prevent="contextMenuRef.closeAll()"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, useTemplateRef } from "vue"
import { storeToRefs } from "pinia"
import RoomCard from "@/components/RoomCard.vue"
import SidebarContextMenu from "@/components/SidebarContextMenu.vue"
import { PhCaretDown, PhPlus, PhDotsThree } from "@phosphor-icons/vue"
import { useRoomStore, useCategoryStore, useUserStore } from "@/stores"
import { useUserContextMenu } from "@/composables/useUserContextMenu"
import { useRoomDragDrop } from "@/composables/useRoomDragDrop"
import { useCategoryDragDrop } from "@/composables/useCategoryDragDrop"
import type { Room } from "@/types"

interface CategorizedRoom {
  id: string
  name: string
  rooms: Room[]
}

interface Props {
  activeRoomId: string | null
  isMobileView?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  "room-selected": [roomId: string]
  "create-room": []
  "create-room-in-category": [payload: { categoryId: string; categoryName: string }]
  "rename-category": [payload: { categoryId: string; categoryName: string }]
  "delete-category": [payload: { categoryId: string; categoryName: string }]
  "move-room": [payload: { roomId: string; targetCategoryId: string }]
  "edit-room": [
    payload: { roomId: string; roomName: string; maxUsers: number; type: string; world: string },
  ]
  "delete-room": [payload: { roomId: string; roomName: string; userCount: number }]
  "close-mobile-sidebar": []
  "room-order-updated": [payload: { orders: Record<string, number> }]
}>()

const roomStore = useRoomStore()
const categoryStore = useCategoryStore()
const userStore = useUserStore()
const { rooms } = storeToRefs(roomStore)
const { categories } = storeToRefs(categoryStore)
const { isAdmin } = storeToRefs(userStore)
const { isUserContextMenuOpen } = useUserContextMenu()

const roomDrag = useRoomDragDrop()
const catDrag = useCategoryDragDrop()
const contextMenuRef = useTemplateRef<InstanceType<typeof SidebarContextMenu>>("contextMenuRef")

const isDraggable = computed(() => isAdmin.value && !isUserContextMenuOpen.value)

const isHidden = computed(() => !rooms.value || rooms.value.length === 0)

const expandedCategories = ref(new Set<string>())

const handleRoomClick = (room: Room) => {
  if (room.id !== props.activeRoomId) {
    emit("room-selected", room.id)
  }
}

const handleMovedRoom = (payload: { roomId: string; targetCategoryId: string }) => {
  emit("move-room", payload)
}

const categorizedRooms = computed(() => {
  const result: CategorizedRoom[] = []
  const categoryRoomMap = new Map<string, { id: string; name: string; rooms: Room[] }>()

  rooms.value?.forEach((room) => {
    const categoryId = room.category
    const category = categories.value?.find((c) => c.id === categoryId)
    const categoryName = category?.name || room.category_name || categoryId

    if (!categoryRoomMap.has(categoryId)) {
      categoryRoomMap.set(categoryId, { id: categoryId, name: categoryName, rooms: [] })
    }
    categoryRoomMap.get(categoryId)!.rooms.push(room)
  })

  categoryRoomMap.forEach((categoryData) => {
    categoryData.rooms.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    result.push(categoryData)
    expandedCategories.value.add(categoryData.name)
  })

  categories.value?.forEach((category) => {
    if (!result.some((c) => c.id === category.id)) {
      result.push({ id: category.id, name: category.name, rooms: [] })
      expandedCategories.value.add(category.name)
    }
  })

  result.sort((a, b) => {
    const catA = categories.value?.find((c) => c.id === a.id)
    const catB = categories.value?.find((c) => c.id === b.id)
    return (catA?.sort_order || 0) - (catB?.sort_order || 0)
  })

  return result
})

const toggleCategory = (categoryName: string) => {
  if (expandedCategories.value.has(categoryName)) {
    expandedCategories.value.delete(categoryName)
  } else {
    expandedCategories.value.add(categoryName)
  }
}
</script>
