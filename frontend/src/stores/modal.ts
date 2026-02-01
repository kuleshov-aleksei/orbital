import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type ModalType = 
  | 'createRoom' 
  | 'editRoom' 
  | 'deleteRoom' 
  | 'createCategory' 
  | 'renameCategory' 
  | 'deleteCategory'
  | null

export interface ModalData {
  roomId?: string
  roomName?: string
  roomUserCount?: number
  roomMaxUsers?: number
  categoryId?: string
  categoryName?: string
  categoryRoomCount?: number
  targetCategoryId?: string
  initialName?: string
}

export const useModalStore = defineStore('modal', () => {
  // State
  const activeModal = ref<ModalType>(null)
  const modalData = ref<ModalData>({})
  const createRoomCategoryName = ref('')

  // Getters
  const isModalOpen = computed(() => activeModal.value !== null)
  
  const isCreateRoomModal = computed(() => activeModal.value === 'createRoom')
  const isEditRoomModal = computed(() => activeModal.value === 'editRoom')
  const isDeleteRoomModal = computed(() => activeModal.value === 'deleteRoom')
  const isCreateCategoryModal = computed(() => activeModal.value === 'createCategory')
  const isRenameCategoryModal = computed(() => activeModal.value === 'renameCategory')
  const isDeleteCategoryModal = computed(() => activeModal.value === 'deleteCategory')

  const modalTitle = computed(() => {
    switch (activeModal.value) {
      case 'createRoom': return 'Create Room'
      case 'editRoom': return 'Edit Room'
      case 'deleteRoom': return 'Delete Room'
      case 'createCategory': return 'Create Category'
      case 'renameCategory': return 'Rename Category'
      case 'deleteCategory': return 'Delete Category'
      default: return ''
    }
  })

  const submitButtonText = computed(() => {
    switch (activeModal.value) {
      case 'createRoom':
      case 'createCategory':
        return 'Create'
      case 'editRoom':
      case 'renameCategory':
        return 'Save'
      case 'deleteRoom':
      case 'deleteCategory':
        return 'Delete'
      default: return ''
    }
  })

  // Actions
  function openModal(type: ModalType, data: ModalData = {}) {
    activeModal.value = type
    modalData.value = data
  }

  function closeModal() {
    activeModal.value = null
    modalData.value = {}
    createRoomCategoryName.value = ''
  }

  function openCreateRoomModal(categoryName: string = '') {
    createRoomCategoryName.value = categoryName
    openModal('createRoom')
  }

  function openEditRoomModal(roomId: string, roomName: string, maxUsers: number) {
    openModal('editRoom', { roomId, roomName, roomMaxUsers: maxUsers })
  }

  function openDeleteRoomModal(roomId: string, roomName: string, userCount: number) {
    openModal('deleteRoom', { roomId, roomName, roomUserCount: userCount })
  }

  function openCreateCategoryModal() {
    openModal('createCategory')
  }

  function openRenameCategoryModal(categoryId: string, categoryName: string) {
    openModal('renameCategory', { categoryId, categoryName, initialName: categoryName })
  }

  function openDeleteCategoryModal(categoryId: string, categoryName: string, roomCount: number) {
    openModal('deleteCategory', { categoryId, categoryName, categoryRoomCount: roomCount })
  }

  return {
    activeModal,
    modalData,
    createRoomCategoryName,
    isModalOpen,
    isCreateRoomModal,
    isEditRoomModal,
    isDeleteRoomModal,
    isCreateCategoryModal,
    isRenameCategoryModal,
    isDeleteCategoryModal,
    modalTitle,
    submitButtonText,
    openModal,
    closeModal,
    openCreateRoomModal,
    openEditRoomModal,
    openDeleteRoomModal,
    openCreateCategoryModal,
    openRenameCategoryModal,
    openDeleteCategoryModal
  }
})
