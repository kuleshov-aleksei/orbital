<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 bg-theme-backdrop flex items-center justify-center z-50"
    @click.self="close">
    <div
      class="bg-theme-bg-secondary rounded-xl shadow-xl w-full max-w-2xl mx-4 overflow-hidden flex"
      style="max-height: 80vh">
      <!-- Sidebar Tabs -->
      <div class="w-48 bg-theme-bg-tertiary border-r border-theme-border flex flex-col">
        <!-- Header -->
        <div class="px-4 py-4 border-b border-theme-border">
          <h2 class="text-lg font-semibold text-theme-text-primary flex items-center gap-2">
            <PhGearSix class="w-5 h-5 text-theme-accent" />
            Settings
          </h2>
        </div>

        <!-- Tab Buttons -->
        <div class="flex-1 p-2 space-y-1">
          <button
            v-for="tab in visibleTabs"
            :key="tab.id"
            type="button"
            class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors duration-200"
            :class="
              currentTab === tab.id
                ? 'bg-theme-accent text-theme-text-on-accent'
                : 'text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary'
            "
            @click="currentTab = tab.id">
            <component :is="tab.icon" class="w-5 h-5" />
            <span class="font-medium">{{ tab.label }}</span>
          </button>
        </div>

        <!-- Close Button at Bottom -->
        <div class="p-2 border-t border-theme-border">
          <button
            type="button"
            class="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover transition-colors duration-200"
            @click="close">
            <PhX class="w-4 h-4" />
            <span class="text-sm">Close</span>
          </button>
        </div>
      </div>

      <!-- Content Area -->
      <div class="flex-1 overflow-y-auto">
        <div class="p-6">
          <component :is="currentTabComponent" @logout="close" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue"
import { useModalStore } from "@/stores/modal"
import { isElectron } from "@/services/electron"
import { SETTINGS_TABS } from "@/composables/useSettingsTabs"
import { PhGearSix, PhX } from "@phosphor-icons/vue"

const modalStore = useModalStore()
const isElectronApp = isElectron()
const currentTab = ref("account")

const visibleTabs = computed(() =>
  SETTINGS_TABS.filter((t) => t.id !== "application" || isElectronApp),
)

const currentTabComponent = computed(
  () => SETTINGS_TABS.find((t) => t.id === currentTab.value)?.component,
)

const isOpen = computed(() => modalStore.isUserSettingsModal)

function close() {
  modalStore.closeModal()
  currentTab.value = "account"
}
</script>
