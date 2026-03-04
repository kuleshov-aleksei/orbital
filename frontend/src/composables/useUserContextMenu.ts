import { ref } from "vue"

const isUserContextMenuOpen = ref(false)

export function useUserContextMenu() {
  const openContextMenu = () => {
    isUserContextMenuOpen.value = true
  }

  const closeContextMenu = () => {
    isUserContextMenuOpen.value = false
  }

  return {
    isUserContextMenuOpen,
    openContextMenu,
    closeContextMenu,
  }
}
