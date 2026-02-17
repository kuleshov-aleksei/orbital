import { useCategoryStore, useRoomStore, useAppStore } from "@/stores"
import { apiService } from "@/services/api"
import type { CreateCategoryData } from "@/types"

export function useCategoryManager() {
  const categoryStore = useCategoryStore()
  const roomStore = useRoomStore()
  const appStore = useAppStore()

  const loadCategories = async () => {
    try {
      const categories = await apiService.getCategories()
      categoryStore.setCategories(categories)
    } catch (error) {
      console.error("Failed to load categories:", error)
    }
  }

  const createCategory = async (name: string) => {
    try {
      appStore.setLoading(true)
      appStore.clearError()

      const data: CreateCategoryData = { name }
      await apiService.createCategory(data)
    } catch (error) {
      console.error("Failed to create category:", error)
      appStore.setError("Failed to create category. Please try again.")
      throw error
    } finally {
      appStore.setLoading(false)
    }
  }

  const renameCategory = async (categoryId: string, name: string) => {
    try {
      appStore.setLoading(true)
      appStore.clearError()

      const oldCategory = categoryStore.getCategoryById(categoryId)
      if (!oldCategory) throw new Error("Category not found")

      await apiService.renameCategory(categoryId, { name })

      // Update category in store
      categoryStore.updateCategory(categoryId, { name })

      // Update all rooms that use this category name
      roomStore.rooms.forEach((room, index) => {
        if (room.category === oldCategory.name) {
          roomStore.rooms[index].category = name
        }
      })
    } catch (error) {
      console.error("Failed to rename category:", error)
      appStore.setError("Failed to rename category. Please try again.")
      throw error
    } finally {
      appStore.setLoading(false)
    }
  }

  const deleteCategory = async (
    categoryId: string,
    deleteRooms: boolean,
    targetCategoryId?: string,
  ) => {
    try {
      appStore.setLoading(true)
      appStore.clearError()

      const deletedCategory = categoryStore.getCategoryById(categoryId)
      if (!deletedCategory) throw new Error("Category not found")

      await apiService.deleteCategory(categoryId, {
        delete_rooms: deleteRooms,
        target_category_id: targetCategoryId,
      })

      if (deleteRooms) {
        // Remove all rooms that were in this category
        const roomsToRemove = roomStore.rooms.filter((r) => r.category === deletedCategory.name)
        roomsToRemove.forEach((room) => {
          roomStore.removeRoom(room.id)
        })
      } else if (targetCategoryId) {
        // Update rooms to new category
        const targetCategory = categoryStore.getCategoryById(targetCategoryId)
        if (targetCategory) {
          roomStore.rooms.forEach((room, index) => {
            if (room.category === deletedCategory.name) {
              roomStore.rooms[index].category = targetCategory.name
            }
          })
        }
      }

      categoryStore.removeCategory(categoryId)
    } catch (error) {
      console.error("Failed to delete category:", error)
      appStore.setError("Failed to delete category. Please try again.")
      throw error
    } finally {
      appStore.setLoading(false)
    }
  }

  const countRoomsInCategory = (categoryId: string): number => {
    const category = categoryStore.getCategoryById(categoryId)
    if (!category) return 0

    return roomStore.rooms.filter((r) => r.category === category.name).length
  }

  return {
    categories: categoryStore.categories,
    generalCategoryId: categoryStore.generalCategoryId,
    loadCategories,
    createCategory,
    renameCategory,
    deleteCategory,
    countRoomsInCategory,
  }
}
