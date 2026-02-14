<template>
  <!-- Create Room Modal -->
  <RoomModal
    v-if="modalStore.isCreateRoomModal"
    :initial-category="modalStore.createRoomCategoryName"
    @close="modalStore.closeModal()"
    @create="handleCreateRoom" />

  <!-- Edit Room Modal -->
  <EditRoomModal
    v-if="modalStore.isEditRoomModal"
    :title="modalStore.modalTitle"
    :initial-name="modalStore.modalData.roomName || ''"
    :initial-max-users="modalStore.modalData.roomMaxUsers || 10"
    @close="modalStore.closeModal()"
    @submit="handleEditRoom" />

  <!-- Delete Room Modal -->
  <ConfirmDeleteRoomModal
    v-if="modalStore.isDeleteRoomModal"
    :room-id="modalStore.modalData.roomId || ''"
    :room-name="modalStore.modalData.roomName || ''"
    :user-count="modalStore.modalData.roomUserCount || 0"
    @close="modalStore.closeModal()"
    @confirm="handleDeleteRoom" />

  <!-- Create/Rename Category Modal -->
  <CategoryModal
    v-if="modalStore.isCreateCategoryModal || modalStore.isRenameCategoryModal"
    :title="modalStore.modalTitle"
    :submit-button-text="modalStore.submitButtonText"
    :initial-name="modalStore.modalData.initialName || ''"
    @close="modalStore.closeModal()"
    @submit="handleCategorySubmit" />

  <!-- Delete Category Modal -->
  <ConfirmDeleteCategoryModal
    v-if="modalStore.isDeleteCategoryModal"
    :category-id="modalStore.modalData.categoryId || ''"
    :category-name="modalStore.modalData.categoryName || ''"
    :room-count="modalStore.modalData.categoryRoomCount || 0"
    :categories="categoryStore.categories"
    :general-category-id="categoryStore.generalCategoryId"
    @close="modalStore.closeModal()"
    @confirm="handleDeleteCategory" />

  <!-- Settings Modal -->
  <SettingsModal v-if="modalStore.isUserSettingsModal" />
</template>

<script setup lang="ts">
import { useModalStore, useCategoryStore } from "@/stores"
import { useRoomManager, useCategoryManager } from "@/composables"
import RoomModal from "@/components/RoomModal.vue"
import EditRoomModal from "@/components/EditRoomModal.vue"
import ConfirmDeleteRoomModal from "@/components/ConfirmDeleteRoomModal.vue"
import CategoryModal from "@/components/CategoryModal.vue"
import ConfirmDeleteCategoryModal from "@/components/ConfirmDeleteCategoryModal.vue"
import SettingsModal from "@/components/settings/SettingsModal.vue"

const modalStore = useModalStore()
const categoryStore = useCategoryStore()
const roomManager = useRoomManager()
const categoryManager = useCategoryManager()

const handleCreateRoom = async (
  roomName: string,
  category: string,
  maxUsers: number,
) => {
  await roomManager.createRoom(roomName, category, maxUsers)
  modalStore.closeModal()
}

const handleEditRoom = async (name: string, maxUsers: number) => {
  const roomId = modalStore.modalData.roomId
  if (roomId) {
    await roomManager.updateRoom(roomId, name, maxUsers)
    modalStore.closeModal()
  }
}

const handleDeleteRoom = async () => {
  const roomId = modalStore.modalData.roomId
  if (roomId) {
    await roomManager.deleteRoom(roomId)
    modalStore.closeModal()
  }
}

const handleCategorySubmit = async (name: string) => {
  if (modalStore.activeModal === "createCategory") {
    await categoryManager.createCategory(name)
  } else if (modalStore.activeModal === "renameCategory") {
    const categoryId = modalStore.modalData.categoryId
    if (categoryId) {
      await categoryManager.renameCategory(categoryId, name)
    }
  }
  modalStore.closeModal()
}

const handleDeleteCategory = async (
  deleteRooms: boolean,
  targetCategoryId?: string,
) => {
  const categoryId = modalStore.modalData.categoryId
  if (categoryId) {
    await categoryManager.deleteCategory(
      categoryId,
      deleteRooms,
      targetCategoryId,
    )
    modalStore.closeModal()
  }
}
</script>
