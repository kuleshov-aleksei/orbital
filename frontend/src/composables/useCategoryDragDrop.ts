import { ref } from "vue"
import { apiService } from "@/services/api"
import { useCategoryStore } from "@/stores"
import type { Category } from "@/types"

export function useCategoryDragDrop() {
  const categoryStore = useCategoryStore()
  const draggedCategory = ref<Category | null>(null)
  const activeCategoryDropZone = ref<{
    position: number | "before-first" | "after-last"
  } | null>(null)

  const handleCategoryDragStart = (event: DragEvent, category: Category) => {
    draggedCategory.value = category
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move"
      event.dataTransfer.setData("text/plain", category.id)
      const target = event.target as HTMLElement
      if (target) event.dataTransfer.setDragImage(target, 0, 0)
    }
  }

  const handleCategoryDragEnd = () => {
    draggedCategory.value = null
    activeCategoryDropZone.value = null
  }

  const handleCategoryDropZoneDragOver = (
    event: DragEvent,
    position: number | "before-first" | "after-last",
  ) => {
    event.preventDefault()
    if (!draggedCategory.value) return
    activeCategoryDropZone.value = { position }
    event.dataTransfer!.dropEffect = "move"
  }

  const reorderCategories = async (sourceCategory: Category, targetIndex: number) => {
    const sortedCategories = [...categoryStore.categories].sort(
      (a, b) => (a.sort_order || 0) - (b.sort_order || 0),
    )

    const sourceIndex = sortedCategories.findIndex((c) => c.id === sourceCategory.id)
    if (sourceIndex === -1) {
      console.error("Source category not found:", sourceCategory.id)
      return
    }

    if (sourceIndex === targetIndex || sourceIndex === targetIndex - 1) return

    const [movedCategory] = sortedCategories.splice(sourceIndex, 1)
    let adjustedTargetIndex = targetIndex
    if (sourceIndex < targetIndex) adjustedTargetIndex = targetIndex - 1
    sortedCategories.splice(adjustedTargetIndex, 0, movedCategory)

    const updates: Record<string, number> = {}
    sortedCategories.forEach((category, index) => {
      updates[category.id] = index + 1
    })

    const newCategoriesOrder = sortedCategories.map((cat, index) => ({
      ...cat,
      sort_order: index + 1,
    }))

    categoryStore.setCategories(newCategoriesOrder)
    await apiService.updateCategoryOrder(updates)
  }

  const handleCategoryDropZoneDrop = async (event: DragEvent, targetIndex: number) => {
    event.preventDefault()
    event.stopPropagation()

    if (!draggedCategory.value) {
      handleCategoryDragEnd()
      return
    }

    try {
      await reorderCategories(draggedCategory.value, targetIndex)
    } catch (error) {
      console.error("Failed to update category order:", error)
    } finally {
      handleCategoryDragEnd()
    }
  }

  return {
    draggedCategory,
    activeCategoryDropZone,
    handleCategoryDragStart,
    handleCategoryDragEnd,
    handleCategoryDropZoneDragOver,
    handleCategoryDropZoneDrop,
  }
}
