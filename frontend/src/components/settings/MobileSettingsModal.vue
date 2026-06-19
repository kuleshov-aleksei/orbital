<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 bg-theme-backdrop flex items-center justify-center z-50"
    @click.self="close">
    <div
      class="bg-theme-bg-secondary rounded-xl shadow-xl w-full mx-4 overflow-hidden flex flex-col"
      style="max-height: 90vh; height: 90vh">
      <!-- Header -->
      <div
        class="px-4 py-4 border-b border-theme-border flex items-center justify-between flex-shrink-0">
        <div class="flex items-center gap-2">
          <button
            v-if="currentTab"
            type="button"
            class="p-1 -ml-1 text-theme-text-muted hover:text-theme-text-primary transition-colors"
            @click="currentTab = undefined">
            <PhCaretLeft class="w-5 h-5" />
          </button>
          <h2 class="text-lg font-semibold text-theme-text-primary flex items-center gap-2">
            <component :is="currentTabIcon" class="w-5 h-5 text-theme-accent" />
            {{ currentTab ? currentTabLabel : "Settings" }}
          </h2>
        </div>
        <button
          type="button"
          class="p-2 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover rounded-lg transition-colors"
          @click="close">
          <PhX class="w-5 h-5" />
        </button>
      </div>

      <!-- Content Area -->
      <div class="flex-1 overflow-y-auto p-2">
        <!-- Main List View -->
        <div v-if="!currentTab" class="space-y-1">
          <button
            v-for="tab in visibleTabs"
            :key="tab.id"
            type="button"
            class="w-full flex items-center justify-between px-3 py-3 rounded-lg text-left transition-colors duration-200"
            :class="
              tab.id === 'account'
                ? 'bg-theme-accent text-theme-text-on-accent'
                : 'text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary'
            "
            @click="currentTab = tab.id">
            <div class="flex items-center gap-3">
              <component :is="tab.icon" class="w-5 h-5" />
              <span class="font-medium">{{ tab.label }}</span>
            </div>
            <PhCaretRight class="w-5 h-5" />
          </button>
        </div>

        <!-- Settings Content View -->
        <div v-else class="space-y-4 pb-4">
          <component :is="currentTabComponent" :hide-header="true" @logout="close" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue"
import { useModalStore } from "@/stores/modal"
import { SETTINGS_TABS } from "@/composables/useSettingsTabs"
import { PhCaretRight, PhCaretLeft, PhX } from "@phosphor-icons/vue"

const modalStore = useModalStore()

const visibleTabs = SETTINGS_TABS.filter((t) => t.id !== "application")

const currentTab = ref<string | undefined>(undefined)

const currentTabData = computed(() =>
  currentTab.value ? SETTINGS_TABS.find((t) => t.id === currentTab.value) : undefined,
)

const currentTabIcon = computed(() => currentTabData.value?.icon)
const currentTabLabel = computed(() => currentTabData.value?.label ?? "")
const currentTabComponent = computed(() => currentTabData.value?.component)

const isOpen = computed(() => modalStore.isUserSettingsModal)

function close() {
  modalStore.closeModal()
  currentTab.value = undefined
}
</script>
