import { apiRequest } from "./client"
import type { Category, CreateCategoryData, RenameCategoryData, DeleteCategoryData } from "@/types"

export function getCategories(): Promise<Category[]> {
  return apiRequest<Category[]>("/categories")
}

export function createCategory(data: CreateCategoryData): Promise<Category> {
  return apiRequest<Category>("/categories", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export function renameCategory(categoryId: string, data: RenameCategoryData): Promise<Category> {
  return apiRequest<Category>(`/categories/${categoryId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

export function deleteCategory(
  categoryId: string,
  data: DeleteCategoryData,
): Promise<{ status: string }> {
  return apiRequest<{ status: string }>(`/categories/${categoryId}`, {
    method: "DELETE",
    body: JSON.stringify(data),
  })
}

export function updateCategoryOrder(orders: Record<string, number>): Promise<{ status: string }> {
  return apiRequest<{ status: string }>("/categories/reorder", {
    method: "PUT",
    body: JSON.stringify({ orders }),
  })
}
