import { useModalStore } from '@/stores'

export function useModalManager() {
  const modalStore = useModalStore()

  return {
    // State
    activeModal: modalStore.activeModal,
    modalData: modalStore.modalData,
    isModalOpen: modalStore.isModalOpen,
    isCreateRoomModal: modalStore.isCreateRoomModal,
    isEditRoomModal: modalStore.isEditRoomModal,
    isDeleteRoomModal: modalStore.isDeleteRoomModal,
    isCreateCategoryModal: modalStore.isCreateCategoryModal,
    isRenameCategoryModal: modalStore.isRenameCategoryModal,
    isDeleteCategoryModal: modalStore.isDeleteCategoryModal,
    modalTitle: modalStore.modalTitle,
    submitButtonText: modalStore.submitButtonText,
    createRoomCategoryName: modalStore.createRoomCategoryName,
    
    // Actions
    closeModal: modalStore.closeModal,
    openCreateRoomModal: modalStore.openCreateRoomModal,
    openEditRoomModal: modalStore.openEditRoomModal,
    openDeleteRoomModal: modalStore.openDeleteRoomModal,
    openCreateCategoryModal: modalStore.openCreateCategoryModal,
    openRenameCategoryModal: modalStore.openRenameCategoryModal,
    openDeleteCategoryModal: modalStore.openDeleteCategoryModal
  }
}
