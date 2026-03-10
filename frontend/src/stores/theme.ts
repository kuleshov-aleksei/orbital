import { defineStore } from "pinia"
import { ref } from "vue"

export type Theme = "default" | "true-black" | "retrowave" | "catppuccin" | "solarized"

const THEME_STORAGE_KEY = "orbital_theme"

function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (
      stored === "default" ||
      stored === "true-black" ||
      stored === "retrowave" ||
      stored === "catppuccin" ||
      stored === "solarized"
    ) {
      return stored
    }
  } catch (e) {
    console.warn("Failed to load theme from localStorage:", e)
  }
  return "default"
}

function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch (e) {
    console.warn("Failed to save theme to localStorage:", e)
  }
}

export const useThemeStore = defineStore("theme", () => {
  const currentTheme = ref<Theme>(getStoredTheme())

  function setTheme(theme: Theme) {
    currentTheme.value = theme
    saveTheme(theme)
  }

  return {
    currentTheme,
    setTheme,
  }
})
