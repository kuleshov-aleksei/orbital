<template>
  <div
     class="room-sidebar"
     :class="{
        'w-72 bg-gray-800 flex flex-col min-h-0': !isMobileView,
       'flex-1 flex flex-col bg-gray-900': isMobileView,
       'fixed lg:relative inset-y-0 left-0 z-40 transform -translate-x-full lg:translate-x-0 transition-transform duration-300': !isMobileView,
       'translate-x-0': !isHidden && !isMobileView
     }">
    <!-- Desktop Header (only when not in mobile view mode) -->
    <div v-if="!isMobileView" class="hidden lg:flex p-4 border-b border-gray-700">
      <h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wider">Rooms</h2>
    </div>

    <!-- Mobile Full-screen Header -->
    <div v-if="isMobileView" class="p-4 border-b border-gray-800">
      <h2 class="text-xl font-semibold text-white">Available Rooms</h2>

      <p class="text-sm text-gray-400 mt-1">{{ rooms?.length || 0 }} room{{ (rooms?.length || 0) !== 1 ? 's' : '' }}</p>
    </div>

    <!-- Room Categories and List -->
    <div class="flex-1 overflow-y-auto min-h-0">
      <div v-for="category in categorizedRooms" :key="category.id" class="mb-4">
        <div class="px-2 py-1">
          <div
            class="w-full flex items-center justify-between px-2 py-1 text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors duration-200 cursor-pointer group"
            @click="toggleCategory(category.name)"
            @contextmenu.prevent="showContextMenu($event, category)">
            <span>{{ category.name }}</span>

            <div class="flex items-center gap-1">
              <PhDotsThree
                class="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity"
                @click.stop="showContextMenu($event, category)" />

              <PhCaretDown
                class="w-3 h-3 transition-transform duration-200"
                :class="{ 'rotate-180': expandedCategories.has(category.name) }" />
            </div>
          </div>
        </div>

        <div v-show="expandedCategories.has(category.name)" class="px-2">
          <RoomCard
            v-for="(room, index) in getSortedRooms(category.rooms)"
            :key="room.id"
            :room="room"
            :is-active="room.id === activeRoomId"
            :is-dragging="draggedRoom?.id === room.id"
            @click="$emit('room-selected', room.id)"
            @show-context-menu="showRoomContextMenu"
            @dragstart="handleDragStart($event, room, category.id)"
            @dragend="handleDragEnd"
            @dragover="handleDragOver($event, room, category.id, index)"
            @drop="handleDrop($event, room, category.id, index)"
            @dragenter="handleDragEnter($event, room, category.id)"
            @dragleave="handleDragLeave" />
          
          <!-- Drop zone at the end of category -->
          <div
            v-if="draggedRoom && draggedRoom.category !== category.id"
            class="h-8 rounded-lg border-2 border-dashed border-indigo-400 bg-indigo-500/10 flex items-center justify-center text-xs text-indigo-300"
            @dragover.prevent="handleCategoryDragOver($event, category.id)"
            @drop="handleCategoryDrop($event, category.id)">
            Drop here to move to {{ category.name }}
          </div>
        </div>
      </div>
    </div>

    <!-- Create Room Button -->
    <div class="p-3 border-t border-gray-700">
      <button
        type="button"
        data-testid="create-room-sidebar"
        class="w-full flex items-center justify-center px-3 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors duration-200"
        @click="$emit('create-room')">
        <PhPlus class="w-4 h-4 mr-2" />

        <span class="text-sm font-medium">Create Room</span>
      </button>
    </div>

    <!-- Category Context Menu -->
    <div
      v-if="contextMenu.visible"
      class="fixed bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-[9999] py-1 min-w-[160px]"
      :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
      @click.stop>
      <button
        type="button"
        class="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
        @click="handleCreateRoomInCategory">
        <div class="flex items-center gap-2">
          <PhPlus class="w-4 h-4" />

          <span>Create Room</span>
        </div>
      </button>

      <button
        type="button"
        class="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
        @click="handleRenameCategory">
        <div class="flex items-center gap-2">
          <PhPencil class="w-4 h-4" />

          <span>Rename</span>
        </div>
      </button>

      <div class="border-t border-gray-700 my-1"></div>

      <button
        type="button"
        class="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-gray-700 hover:text-red-300 transition-colors"
        @click="handleDeleteCategory">
        <div class="flex items-center gap-2">
          <PhTrash class="w-4 h-4" />

          <span>Delete</span>
        </div>
      </button>
    </div>

    <!-- Room Context Menu -->
    <div
      v-if="roomContextMenu.visible"
      class="fixed bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-[9999] py-1 min-w-[200px]"
      :style="{ top: roomContextMenu.y + 'px', left: roomContextMenu.x + 'px' }"
      @click.stop>
      <!-- Move to Category - With Submenu -->
      <div class="relative group">
        <button
          type="button"
          class="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors flex items-center justify-between"
          @mouseenter="onMoveButtonEnter"
          @mouseleave="onMoveButtonLeave">
          <div class="flex items-center gap-2">
            <PhArrowsLeftRight class="w-4 h-4" />

            <span>Move to Category</span>
          </div>

          <PhCaretDown class="w-3 h-3 transform -rotate-90" />
        </button>
        
        <!-- Invisible bridge to prevent menu from closing when moving cursor -->
        <div
          v-if="showMoveSubmenu"
          class="absolute left-full top-0 w-8 h-full -ml-4 z-[9999]"
          @mouseenter="onBridgeEnter"
          @mouseleave="onBridgeLeave">
        </div>
        
        <!-- Move Submenu -->
        <div
          v-if="showMoveSubmenu"
          class="absolute left-full top-0 ml-2 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-[9999] py-1 min-w-[160px]"
          @mouseenter="onSubmenuEnter"
          @mouseleave="onSubmenuLeave">
          <button
            v-for="category in availableCategoriesForMove"
            :key="category.id"
            type="button"
            class="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
            @click="onMoveCategorySelect(category.id)">
            {{ category.name }}
          </button>

          <div v-if="availableCategoriesForMove.length === 0" class="px-4 py-2 text-sm text-gray-500">
            No other categories
          </div>
        </div>
      </div>

      <button
        type="button"
        class="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
        @click="handleEditRoom">
        <div class="flex items-center gap-2">
          <PhPencil class="w-4 h-4" />

          <span>Properties</span>
        </div>
      </button>

      <div class="border-t border-gray-700 my-1"></div>

      <button
        type="button"
        class="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-gray-700 hover:text-red-300 transition-colors"
        @click="handleDeleteRoom">
        <div class="flex items-center gap-2">
          <PhTrash class="w-4 h-4" />

          <span>Delete</span>
        </div>
      </button>
    </div>

    <!-- Click outside to close context menu -->
    <div
      v-if="contextMenu.visible || roomContextMenu.visible"
      class="fixed inset-0 z-40"
      @click="closeAllContextMenus"
      @contextmenu.prevent="closeAllContextMenus"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import RoomCard from '@/components/RoomCard.vue'
import { PhCaretDown, PhPlus, PhDotsThree, PhPencil, PhTrash, PhArrowsLeftRight } from '@phosphor-icons/vue'
import { useRoomStore, useCategoryStore } from '@/stores'
import { apiService } from '@/services/api'
import type { Room } from '@/types'

interface CategorizedRoom {
  id: string
  name: string
  rooms: Room[]
}

interface Props {
  activeRoomId: string | null
  isMobileView?: boolean
}

const { activeRoomId, isMobileView = false } = defineProps<Props>()

const emit = defineEmits<{
  'room-selected': [roomId: string]
  'create-room': []
  'create-room-in-category': [payload: { categoryId: string, categoryName: string }]
  'rename-category': [payload: { categoryId: string, categoryName: string }]
  'delete-category': [payload: { categoryId: string, categoryName: string }]
  'move-room': [payload: { roomId: string, targetCategoryId: string }]
  'edit-room': [payload: { roomId: string, roomName: string, maxUsers: number }]
  'delete-room': [payload: { roomId: string, roomName: string, userCount: number }]
  'close-mobile-sidebar': []
  'room-order-updated': [payload: { orders: Record<string, number> }]
}>()
// Use stores directly for reactivity
const roomStore = useRoomStore()
const categoryStore = useCategoryStore()
const { rooms } = storeToRefs(roomStore)
const { categories } = storeToRefs(categoryStore)

const isHidden = computed(() => {
  return !rooms.value || rooms.value.length === 0
})

const expandedCategories = ref(new Set<string>())

const categorizedRooms = computed(() => {
  const result: CategorizedRoom[] = []
  const categoryRoomMap = new Map<string, { id: string; name: string; rooms: Room[] }>()

  // Group rooms by category ID
  rooms.value?.forEach((room) => {
    const categoryId = room.category
    // Look up category name from the categories list
    const category = categories.value?.find((c) => c.id === categoryId)
    const categoryName = category?.name || room.category_name || categoryId

    if (!categoryRoomMap.has(categoryId)) {
      categoryRoomMap.set(categoryId, { id: categoryId, name: categoryName, rooms: [] })
    }
    categoryRoomMap.get(categoryId)!.rooms.push(room)
  })

  // Convert to array format, sort rooms by sort_order, and expand all categories by default
  categoryRoomMap.forEach((categoryData) => {
    // Sort rooms by sort_order
    categoryData.rooms.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    result.push(categoryData)
    expandedCategories.value.add(categoryData.name)
  })

  // Also add empty categories from the categories list
  categories.value?.forEach((category) => {
    const exists = result.some((c) => c.id === category.id)
    if (!exists) {
      result.push({ id: category.id, name: category.name, rooms: [] })
      expandedCategories.value.add(category.name)
    }
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

// Context Menu State
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  category: null as CategorizedRoom | null,
})

const showContextMenu = (event: MouseEvent, category: CategorizedRoom) => {
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    category,
  }
}

const closeContextMenu = () => {
  contextMenu.value.visible = false
  contextMenu.value.category = null
}

const handleCreateRoomInCategory = () => {
  if (contextMenu.value.category) {
    // Use the category ID and name directly from the context menu
    // categorizedRooms now properly stores the category ID from room.category
    emit('create-room-in-category', { categoryId: contextMenu.value.category.id, categoryName: contextMenu.value.category.name })
  }
  closeContextMenu()
}

const handleRenameCategory = () => {
  if (contextMenu.value.category) {
    // Use the category ID and name directly from the context menu
    emit('rename-category', { categoryId: contextMenu.value.category.id, categoryName: contextMenu.value.category.name })
  }
  closeContextMenu()
}

const handleDeleteCategory = () => {
  if (contextMenu.value.category) {
    // Use the category ID and name directly from the context menu
    emit('delete-category', { categoryId: contextMenu.value.category.id, categoryName: contextMenu.value.category.name })
  }
  closeContextMenu()
}

// Room Context Menu State
const roomContextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  room: null as Room | null,
})

const showMoveSubmenu = ref(false)
const isHoveringSubmenu = ref(false)
let submenuHideTimeout: ReturnType<typeof setTimeout> | null = null

// Get available categories for moving (exclude current room's category)
const availableCategoriesForMove = computed(() => {
  if (!roomContextMenu.value.room) return categories.value || []
  return (categories.value || []).filter(cat => cat.id !== roomContextMenu.value.room?.category)
})

const showRoomContextMenu = (event: MouseEvent, room: Room) => {
  // Close category menu if open
  closeContextMenu()
  
  roomContextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    room,
  }
}

const closeRoomContextMenu = () => {
  roomContextMenu.value.visible = false
  roomContextMenu.value.room = null
  showMoveSubmenu.value = false
  isHoveringSubmenu.value = false
  // Clear any pending hide timeout
  if (submenuHideTimeout) {
    clearTimeout(submenuHideTimeout)
    submenuHideTimeout = null
  }
}

const closeAllContextMenus = () => {
  closeContextMenu()
  closeRoomContextMenu()
}

// Smart submenu hover handlers with delay
const SUBMENU_HIDE_DELAY = 400 // Longer delay for better UX

const onMoveButtonEnter = () => {
  // Clear any pending hide timeout
  if (submenuHideTimeout) {
    clearTimeout(submenuHideTimeout)
    submenuHideTimeout = null
  }
  showMoveSubmenu.value = true
}

const onMoveButtonLeave = () => {
  // Delay hiding to allow user to move cursor to submenu or bridge
  submenuHideTimeout = setTimeout(() => {
    if (!isHoveringSubmenu.value) {
      showMoveSubmenu.value = false
    }
  }, SUBMENU_HIDE_DELAY)
}

const onBridgeEnter = () => {
  isHoveringSubmenu.value = true
  // Clear any pending hide timeout
  if (submenuHideTimeout) {
    clearTimeout(submenuHideTimeout)
    submenuHideTimeout = null
  }
}

const onBridgeLeave = () => {
  // Small delay to allow moving from bridge to submenu
  submenuHideTimeout = setTimeout(() => {
    isHoveringSubmenu.value = false
    showMoveSubmenu.value = false
  }, 100)
}

const onSubmenuEnter = () => {
  isHoveringSubmenu.value = true
  // Clear any pending hide timeout
  if (submenuHideTimeout) {
    clearTimeout(submenuHideTimeout)
    submenuHideTimeout = null
  }
}

const onSubmenuLeave = () => {
  // Delay hiding to check if user is moving back to bridge or button
  submenuHideTimeout = setTimeout(() => {
    isHoveringSubmenu.value = false
    showMoveSubmenu.value = false
  }, SUBMENU_HIDE_DELAY)
}

const onMoveCategorySelect = (targetCategoryId: string) => {
  // Clear timeout and hide immediately when selecting
  if (submenuHideTimeout) {
    clearTimeout(submenuHideTimeout)
    submenuHideTimeout = null
  }
  isHoveringSubmenu.value = false
  showMoveSubmenu.value = false
  handleMoveRoom(targetCategoryId)
}

const handleMoveRoom = (targetCategoryId: string) => {
  if (roomContextMenu.value.room) {
    emit('move-room', { roomId: roomContextMenu.value.room.id, targetCategoryId })
  }
  closeRoomContextMenu()
}

const handleEditRoom = () => {
  if (roomContextMenu.value.room) {
    emit('edit-room', {
      roomId: roomContextMenu.value.room.id,
      roomName: roomContextMenu.value.room.name,
      maxUsers: roomContextMenu.value.room.max_users
    })
  }
  closeRoomContextMenu()
}

const handleDeleteRoom = () => {
  if (roomContextMenu.value.room) {
    emit('delete-room', {
      roomId: roomContextMenu.value.room.id,
      roomName: roomContextMenu.value.room.name,
      userCount: roomContextMenu.value.room.user_count
    })
  }
  closeRoomContextMenu()
}

// Drag and Drop State
const draggedRoom = ref<Room | null>(null)
const dragOverRoom = ref<Room | null>(null)
const dragOverCategory = ref<string | null>(null)
const dragSourceCategory = ref<string | null>(null)

// Get sorted rooms for a category
const getSortedRooms = (categoryRooms: Room[]) => {
  return [...categoryRooms].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
}

// Drag Start - when user starts dragging a room
const handleDragStart = (event: DragEvent, room: Room, categoryId: string) => {
  draggedRoom.value = room
  dragSourceCategory.value = categoryId
  
  // Set drag data
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', room.id)
    
    // Set a custom drag image if needed
    const target = event.target as HTMLElement
    if (target) {
      event.dataTransfer.setDragImage(target, 0, 0)
    }
  }
  
  // Close any open context menus
  closeAllContextMenus()
}

// Drag End - cleanup after drag ends
const handleDragEnd = () => {
  draggedRoom.value = null
  dragOverRoom.value = null
  dragOverCategory.value = null
  dragSourceCategory.value = null
}

// Drag Over - when dragging over a room (for reordering within same category)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const handleDragOver = (event: DragEvent, room: Room, categoryId: string, index: number) => {
  event.preventDefault()

  if (!draggedRoom.value || draggedRoom.value.id === room.id) return

  dragOverRoom.value = room

  // Only allow reordering if in the same category
  if (draggedRoom.value.category === categoryId) {
    event.dataTransfer!.dropEffect = 'move'
  }
}

// Drag Enter
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const handleDragEnter = (event: DragEvent, room: Room, categoryId: string) => {
  event.preventDefault()
}

// Drag Leave
const handleDragLeave = () => {
  dragOverRoom.value = null
}

// Drop - handle the actual drop action
const handleDrop = async (event: DragEvent, targetRoom: Room, categoryId: string, targetIndex: number) => {
  event.preventDefault()
  event.stopPropagation()
  
  if (!draggedRoom.value || draggedRoom.value.id === targetRoom.id) {
    handleDragEnd()
    return
  }
  
  const sourceRoom = draggedRoom.value
  const isSameCategory = sourceRoom.category === categoryId
  
  try {
    if (isSameCategory) {
      // Reordering within the same category
      await reorderRoomsInCategory(categoryId, sourceRoom, targetRoom, targetIndex)
    } else {
      // Moving to a different category
      await moveRoomToCategory(sourceRoom, categoryId)
    }
  } catch (error) {
    console.error('Failed to update room order:', error)
  }
  
  handleDragEnd()
}

// Handle drag over category drop zone
const handleCategoryDragOver = (event: DragEvent, categoryId: string) => {
  event.preventDefault()
  dragOverCategory.value = categoryId
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

// Handle drop on category drop zone
const handleCategoryDrop = async (event: DragEvent, categoryId: string) => {
  event.preventDefault()
  event.stopPropagation()
  
  if (!draggedRoom.value || draggedRoom.value.category === categoryId) {
    handleDragEnd()
    return
  }
  
  try {
    await moveRoomToCategory(draggedRoom.value, categoryId)
  } catch (error) {
    console.error('Failed to move room to category:', error)
  }
  
  handleDragEnd()
}

// Reorder rooms within the same category
const reorderRoomsInCategory = async (categoryId: string, sourceRoom: Room, targetRoom: Room, targetIndex: number) => {
  // Get all rooms in this category
  const categoryRooms = rooms.value
    .filter(r => r.category === categoryId)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  
  const sourceIndex = categoryRooms.findIndex(r => r.id === sourceRoom.id)
  if (sourceIndex === -1) return
  
  // Reorder the array
  const [movedRoom] = categoryRooms.splice(sourceIndex, 1)
  const adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
  categoryRooms.splice(adjustedTargetIndex, 0, movedRoom)
  
  // Assign new sort orders
  const updates: Record<string, number> = {}
  categoryRooms.forEach((room, index) => {
    updates[room.id] = index + 1
  })
  
  // Update local state immediately for responsiveness
  roomStore.reorderRooms(updates)
  
  // Update backend
  await apiService.updateRoomOrder(updates)
}

// Move room to a different category
const moveRoomToCategory = async (room: Room, targetCategoryId: string) => {
  // Find the highest sort_order in the target category
  const targetCategoryRooms = rooms.value.filter(r => r.category === targetCategoryId)
  const maxSortOrder = targetCategoryRooms.reduce((max, r) => Math.max(max, r.sort_order || 0), 0)
  
  // Update room category via existing API
  await apiService.updateRoom(room.id, { category: targetCategoryId })
  
  // Update sort order in new category
  const updates: Record<string, number> = {
    [room.id]: maxSortOrder + 1
  }
  
  // Update local state
  roomStore.moveRoomToCategory(room.id, targetCategoryId)
  roomStore.reorderRooms(updates)
  
  // Update backend sort order
  await apiService.updateRoomOrder(updates)
  
  // Emit event for parent component
  emit('move-room', { roomId: room.id, targetCategoryId })
}
</script>
