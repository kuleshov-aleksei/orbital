import { defineStore } from "pinia"
import { ref, computed } from "vue"
import type { Category } from "@/types"

export const useCategoryStore = defineStore("category", () => {
  // State
  const categories = ref<Category[]>([])

  // Getters
  const generalCategoryId = computed(() => {
    const generalCat = categories.value.find((c) => c.name === "general")
    return generalCat?.id || ""
  })

  const getCategoryById = computed(
    () => (categoryId: string) => categories.value.find((c) => c.id === categoryId),
  )

  const getCategoryByName = computed(
    () => (name: string) => categories.value.find((c) => c.name === name),
  )

  // Actions
  function setCategories(newCategories: Category[]) {
    categories.value = newCategories
  }

  function addCategory(category: Category) {
    const existingIndex = categories.value.findIndex((c) => c.id === category.id)
    if (existingIndex === -1) {
      categories.value.push(category)
    }
  }

  function updateCategory(categoryId: string, updates: Partial<Category>) {
    const index = categories.value.findIndex((c) => c.id === categoryId)
    if (index !== -1) {
      categories.value[index] = { ...categories.value[index], ...updates }
    }
  }

  function removeCategory(categoryId: string) {
    const index = categories.value.findIndex((c) => c.id === categoryId)
    if (index !== -1) {
      categories.value.splice(index, 1)
    }
  }

  function reorderCategories(categoryOrders: Record<string, number>) {
    // Update sort_order for each category
    categories.value = categories.value.map((category) => {
      if (categoryOrders[category.id] !== undefined) {
        return { ...category, sort_order: categoryOrders[category.id] }
      }
      return category
    })
  }

  return {
    categories,
    generalCategoryId,
    getCategoryById,
    getCategoryByName,
    setCategories,
    addCategory,
    updateCategory,
    removeCategory,
    reorderCategories,
  }
})
