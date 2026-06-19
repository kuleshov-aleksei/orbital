<template>
  <div>
    <!-- Category Context Menu -->
    <div
      v-if="categoryMenu.visible"
      class="fixed bg-theme-bg-secondary border border-theme-border rounded-lg shadow-xl z-[9999] py-1 min-w-[160px]"
      :style="{ top: categoryMenu.y + 'px', left: categoryMenu.x + 'px' }"
      @click.stop>
      <button
        v-if="isAdmin"
        type="button"
        class="w-full px-4 py-2 text-left text-sm text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary transition-colors"
        @click="emitCreateRoom">
        <div class="flex items-center gap-2">
          <PhPlus class="w-4 h-4" />
          <span>Create Room</span>
        </div>
      </button>
      <button
        v-if="isAdmin"
        type="button"
        class="w-full px-4 py-2 text-left text-sm text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary transition-colors"
        @click="emitRenameCategory">
        <div class="flex items-center gap-2">
          <PhPencil class="w-4 h-4" />
          <span>Rename</span>
        </div>
      </button>
      <div v-if="isAdmin" class="border-t border-theme-border my-1"></div>
      <button
        v-if="isAdmin"
        type="button"
        class="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-theme-bg-hover hover:text-red-300 transition-colors"
        @click="emitDeleteCategory">
        <div class="flex items-center gap-2">
          <PhTrash class="w-4 h-4" />
          <span>Delete</span>
        </div>
      </button>
      <div v-if="!isAdmin" class="px-4 py-2 text-sm text-theme-text-muted">
        No actions available
      </div>
    </div>

    <!-- Room Context Menu -->
    <div
      v-if="roomMenu.visible"
      class="fixed bg-theme-bg-secondary border border-theme-border rounded-lg shadow-xl z-[9999] py-1 min-w-[200px]"
      :style="{ top: roomMenu.y + 'px', left: roomMenu.x + 'px' }"
      @click.stop>
      <div v-if="isAdmin" class="relative group">
        <button
          type="button"
          class="w-full px-4 py-2 text-left text-sm text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary transition-colors flex items-center justify-between"
          @mouseenter="onMoveButtonEnter"
          @mouseleave="onMoveButtonLeave">
          <div class="flex items-center gap-2">
            <PhArrowsLeftRight class="w-4 h-4" />
            <span>Move to Category</span>
          </div>
          <PhCaretDown class="w-3 h-3 transform -rotate-90" />
        </button>
        <div
          v-if="showMoveSubmenu"
          class="absolute left-full top-0 w-8 h-full -ml-4 z-[9999]"
          @mouseenter="onBridgeEnter"
          @mouseleave="onBridgeLeave"></div>
        <div
          v-if="showMoveSubmenu"
          class="absolute left-full top-0 ml-2 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-xl z-[9999] py-1 min-w-[160px]"
          @mouseenter="onSubmenuEnter"
          @mouseleave="onSubmenuLeave">
          <button
            v-for="category in availableCategories"
            :key="category.id"
            type="button"
            class="w-full px-4 py-2 text-left text-sm text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary transition-colors"
            @click="onMoveCategorySelect(category.id)">
            {{ category.name }}
          </button>
          <div
            v-if="availableCategories.length === 0"
            class="px-4 py-2 text-sm text-theme-text-muted">
            No other categories
          </div>
        </div>
      </div>
      <button
        v-if="isAdmin"
        type="button"
        class="w-full px-4 py-2 text-left text-sm text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary transition-colors"
        @click="emitEditRoom">
        <div class="flex items-center gap-2">
          <PhPencil class="w-4 h-4" />
          <span>Properties</span>
        </div>
      </button>
      <div v-if="isAdmin" class="border-t border-theme-border my-1"></div>
      <button
        v-if="isAdmin"
        type="button"
        class="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-theme-bg-hover hover:text-red-300 transition-colors"
        @click="emitDeleteRoom">
        <div class="flex items-center gap-2">
          <PhTrash class="w-4 h-4" />
          <span>Delete</span>
        </div>
      </button>
      <div v-if="!isAdmin" class="px-4 py-2 text-sm text-theme-text-muted">
        No actions available
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue"
import { PhPlus, PhPencil, PhTrash, PhArrowsLeftRight, PhCaretDown } from "@phosphor-icons/vue"
import type { Room, Category } from "@/types"

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
}

interface CategoryMenuState extends ContextMenuState {
  categoryId: string
  categoryName: string
}

interface RoomMenuState extends ContextMenuState {
  room: Room | null
}

const props = defineProps<{
  isAdmin: boolean
  categories: Category[]
}>()

const emit = defineEmits<{
  "create-room-in-category": [payload: { categoryId: string; categoryName: string }]
  "rename-category": [payload: { categoryId: string; categoryName: string }]
  "delete-category": [payload: { categoryId: string; categoryName: string }]
  "move-room": [payload: { roomId: string; targetCategoryId: string }]
  "edit-room": [
    payload: { roomId: string; roomName: string; maxUsers: number; type: string; world: string },
  ]
  "delete-room": [payload: { roomId: string; roomName: string; userCount: number }]
}>()

const categoryMenu = ref<CategoryMenuState>({
  visible: false,
  x: 0,
  y: 0,
  categoryId: "",
  categoryName: "",
})

const roomMenu = ref<RoomMenuState>({
  visible: false,
  x: 0,
  y: 0,
  room: null,
})

const showMoveSubmenu = ref(false)
const isHoveringSubmenu = ref(false)
let submenuHideTimeout: ReturnType<typeof setTimeout> | null = null

const availableCategories = computed(() => {
  if (!roomMenu.value.room) return props.categories
  return props.categories.filter((cat) => cat.id !== roomMenu.value.room?.category)
})

const SUBMENU_HIDE_DELAY = 400

const onMoveButtonEnter = () => {
  if (submenuHideTimeout) {
    clearTimeout(submenuHideTimeout)
    submenuHideTimeout = null
  }
  showMoveSubmenu.value = true
}

const onMoveButtonLeave = () => {
  submenuHideTimeout = setTimeout(() => {
    if (!isHoveringSubmenu.value) showMoveSubmenu.value = false
  }, SUBMENU_HIDE_DELAY)
}

const onBridgeEnter = () => {
  isHoveringSubmenu.value = true
  if (submenuHideTimeout) {
    clearTimeout(submenuHideTimeout)
    submenuHideTimeout = null
  }
}

const onBridgeLeave = () => {
  submenuHideTimeout = setTimeout(() => {
    isHoveringSubmenu.value = false
    showMoveSubmenu.value = false
  }, 100)
}

const onSubmenuEnter = () => {
  isHoveringSubmenu.value = true
  if (submenuHideTimeout) {
    clearTimeout(submenuHideTimeout)
    submenuHideTimeout = null
  }
}

const onSubmenuLeave = () => {
  submenuHideTimeout = setTimeout(() => {
    isHoveringSubmenu.value = false
    showMoveSubmenu.value = false
  }, SUBMENU_HIDE_DELAY)
}

const onMoveCategorySelect = (targetCategoryId: string) => {
  if (submenuHideTimeout) {
    clearTimeout(submenuHideTimeout)
    submenuHideTimeout = null
  }
  isHoveringSubmenu.value = false
  showMoveSubmenu.value = false
  if (roomMenu.value.room) {
    emit("move-room", {
      roomId: roomMenu.value.room.id,
      targetCategoryId,
    })
  }
  closeRoomMenu()
}

const emitCreateRoom = () => {
  emit("create-room-in-category", {
    categoryId: categoryMenu.value.categoryId,
    categoryName: categoryMenu.value.categoryName,
  })
  closeCategoryMenu()
}

const emitRenameCategory = () => {
  emit("rename-category", {
    categoryId: categoryMenu.value.categoryId,
    categoryName: categoryMenu.value.categoryName,
  })
  closeCategoryMenu()
}

const emitDeleteCategory = () => {
  emit("delete-category", {
    categoryId: categoryMenu.value.categoryId,
    categoryName: categoryMenu.value.categoryName,
  })
  closeCategoryMenu()
}

const emitEditRoom = () => {
  if (roomMenu.value.room) {
    emit("edit-room", {
      roomId: roomMenu.value.room.id,
      roomName: roomMenu.value.room.name,
      maxUsers: roomMenu.value.room.max_users,
      type: roomMenu.value.room.type,
      world: roomMenu.value.room.world,
    })
  }
  closeRoomMenu()
}

const emitDeleteRoom = () => {
  if (roomMenu.value.room) {
    emit("delete-room", {
      roomId: roomMenu.value.room.id,
      roomName: roomMenu.value.room.name,
      userCount: roomMenu.value.room.user_count,
    })
  }
  closeRoomMenu()
}

const closeCategoryMenu = () => {
  categoryMenu.value.visible = false
  categoryMenu.value.categoryId = ""
  categoryMenu.value.categoryName = ""
}

const closeRoomMenu = () => {
  roomMenu.value.visible = false
  roomMenu.value.room = null
  showMoveSubmenu.value = false
  isHoveringSubmenu.value = false
  if (submenuHideTimeout) {
    clearTimeout(submenuHideTimeout)
    submenuHideTimeout = null
  }
}

const showCategoryMenu = (event: MouseEvent, category: { id: string; name: string }) => {
  closeRoomMenu()
  categoryMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    categoryId: category.id,
    categoryName: category.name,
  }
}

const showRoomMenu = (event: MouseEvent, room: Room) => {
  closeCategoryMenu()
  roomMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    room,
  }
}

const isAnyMenuOpen = computed(() => categoryMenu.value.visible || roomMenu.value.visible)

const closeAll = () => {
  closeCategoryMenu()
  closeRoomMenu()
}

defineExpose({ showCategoryMenu, showRoomMenu, isAnyMenuOpen, closeAll })
</script>
