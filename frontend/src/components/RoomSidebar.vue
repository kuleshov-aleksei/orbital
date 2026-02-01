<template>
  <div
     class="room-sidebar"
     :class="{
       'w-60 bg-gray-800 flex flex-col': !isMobileView,
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
      <p class="text-sm text-gray-400 mt-1">{{ rooms.length }} room{{ rooms.length !== 1 ? 's' : '' }}</p>
    </div>

    <!-- Room Categories and List -->
    <div class="flex-1 overflow-y-auto">
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
            v-for="room in category.rooms"
            :key="room.id"
            :room="room"
            :is-active="room.id === activeRoomId"
            @click="$emit('room-selected', room.id)"
            @show-context-menu="showRoomContextMenu" />
        </div>
      </div>
    </div>

    <!-- Create Room Button -->
    <div class="p-3 border-t border-gray-700">
      <button
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
        class="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
        @click="handleCreateRoomInCategory">
        <div class="flex items-center gap-2">
          <PhPlus class="w-4 h-4" />
          <span>Create Room</span>
        </div>
      </button>
      <button
        class="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
        @click="handleRenameCategory">
        <div class="flex items-center gap-2">
          <PhPencil class="w-4 h-4" />
          <span>Rename</span>
        </div>
      </button>
      <div class="border-t border-gray-700 my-1"></div>
      <button
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
        class="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
        @click="handleEditRoom">
        <div class="flex items-center gap-2">
          <PhPencil class="w-4 h-4" />
          <span>Properties</span>
        </div>
      </button>

      <div class="border-t border-gray-700 my-1"></div>
      <button
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
import RoomCard from '@/components/RoomCard.vue'
import { PhCaretDown, PhPlus, PhDotsThree, PhPencil, PhTrash, PhArrowsLeftRight } from '@phosphor-icons/vue'
import type { Category, Room } from '@/types'

interface CategorizedRoom {
  id: string
  name: string
  rooms: Room[]
}

interface Props {
  rooms: Room[]
  categories: Category[]
  activeRoomId: string | null
  isMobileView?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isMobileView: false,
})

const emit = defineEmits<{
  'room-selected': [roomId: string]
  'create-room': []
  'create-room-in-category': [categoryId: string, categoryName: string]
  'rename-category': [categoryId: string, currentName: string]
  'delete-category': [categoryId: string, categoryName: string]
  'move-room': [roomId: string, currentCategoryId: string]
  'edit-room': [roomId: string, currentName: string, currentMaxUsers: number]
  'delete-room': [roomId: string, roomName: string, userCount: number]
  'close-mobile-sidebar': []
}>()

const isHidden = computed(() => {
  return props.rooms.length === 0
})

const expandedCategories = ref(new Set<string>())

const categorizedRooms = computed(() => {
  const categories: CategorizedRoom[] = []
  const categoryRoomMap = new Map<string, { id: string; name: string; rooms: Room[] }>()

  // Group rooms by category ID
  props.rooms.forEach((room) => {
    const categoryId = room.category
    // Look up category name from the categories list
    const category = props.categories.find((c) => c.id === categoryId)
    const categoryName = category?.name || room.categoryName || categoryId

    if (!categoryRoomMap.has(categoryId)) {
      categoryRoomMap.set(categoryId, { id: categoryId, name: categoryName, rooms: [] })
    }
    categoryRoomMap.get(categoryId)!.rooms.push(room)
  })

  // Convert to array format and expand all categories by default
  categoryRoomMap.forEach((categoryData) => {
    categories.push(categoryData)
    expandedCategories.value.add(categoryData.name)
  })

  // Also add empty categories from the categories list
  props.categories.forEach((category) => {
    const exists = categories.some((c) => c.id === category.id)
    if (!exists) {
      categories.push({ id: category.id, name: category.name, rooms: [] })
      expandedCategories.value.add(category.name)
    }
  })

  return categories
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
    emit('create-room-in-category', contextMenu.value.category.id, contextMenu.value.category.name)
  }
  closeContextMenu()
}

const handleRenameCategory = () => {
  if (contextMenu.value.category) {
    // Use the category ID and name directly from the context menu
    emit('rename-category', contextMenu.value.category.id, contextMenu.value.category.name)
  }
  closeContextMenu()
}

const handleDeleteCategory = () => {
  if (contextMenu.value.category) {
    // Use the category ID and name directly from the context menu
    emit('delete-category', contextMenu.value.category.id, contextMenu.value.category.name)
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
  if (!roomContextMenu.value.room) return props.categories
  return props.categories.filter(cat => cat.id !== roomContextMenu.value.room?.category)
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
    emit('move-room', roomContextMenu.value.room.id, targetCategoryId)
  }
  closeRoomContextMenu()
}

const handleEditRoom = () => {
  if (roomContextMenu.value.room) {
    emit('edit-room', roomContextMenu.value.room.id, roomContextMenu.value.room.name, roomContextMenu.value.room.maxUsers)
  }
  closeRoomContextMenu()
}

const handleDeleteRoom = () => {
  if (roomContextMenu.value.room) {
    emit('delete-room', roomContextMenu.value.room.id, roomContextMenu.value.room.name, roomContextMenu.value.room.userCount)
  }
  closeRoomContextMenu()
}
</script>
