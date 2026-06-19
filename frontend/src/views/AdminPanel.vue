<template>
  <div class="admin-panel p-4 lg:p-8 overflow-y-auto h-full">
    <div class="max-w-4xl mx-auto">
      <div class="flex items-center justify-between mb-8">
        <div>
          <h1 class="text-2xl font-bold text-white">Admin Panel</h1>
          <p class="text-gray-400 mt-1">Manage users and system settings</p>
        </div>
        <div class="flex items-center gap-2">
          <span class="px-3 py-1 bg-indigo-600 text-white text-sm rounded-full">
            {{ currentUserRole === "super_admin" ? "Super Admin" : "Admin" }}
          </span>
        </div>
      </div>

      <div class="flex border-b border-gray-700 mb-6">
        <button
          v-for="tab in visibleTabs"
          :key="tab.id"
          type="button"
          class="px-4 py-2 text-sm font-medium transition-colors"
          :class="
            tab === activeTab
              ? 'text-white border-b-2 border-indigo-500'
              : 'text-gray-400 hover:text-gray-200'
          "
          @click="activeTab = tab">
          {{ tab.label }}
        </button>
      </div>

      <component :is="activeTab.component" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue"
import { storeToRefs } from "pinia"
import { useUserStore } from "@/stores"
import AdminUsersTab from "@/components/admin/AdminUsersTab.vue"
import AdminLogsTab from "@/components/admin/AdminLogsTab.vue"
import AdminAudioTab from "@/components/admin/AdminAudioTab.vue"
import AdminStatsTab from "@/components/admin/AdminStatsTab.vue"

const userStore = useUserStore()
const { currentUser, isSuperAdmin } = storeToRefs(userStore)
const currentUserRole = computed(() => currentUser.value?.role)

interface TabDefinition {
  id: string
  label: string
  component: object
}

const allTabs: TabDefinition[] = [
  { id: "users", label: "Users", component: AdminUsersTab },
  { id: "logs", label: "Debug Logs", component: AdminLogsTab },
  { id: "audio", label: "Audio", component: AdminAudioTab },
  { id: "stats", label: "Stats", component: AdminStatsTab },
]

const visibleTabs = computed(() =>
  allTabs.filter((t) => t.id === "users" || t.id === "audio" || isSuperAdmin.value),
)

const activeTab = ref<TabDefinition>(allTabs[0])
</script>
