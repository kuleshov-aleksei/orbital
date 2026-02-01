<template>
  <!-- Error Message -->
  <div 
    v-if="appStore.errorMessage" 
    class="fixed top-4 left-1/2 transform -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded-lg z-50 max-w-md text-center"
  >
    {{ appStore.errorMessage }}
  </div>

  <!-- Loading Overlay -->
  <div 
    v-if="appStore.isLoading" 
    class="fixed inset-0 bg-black bg-opacity-50 z-40 flex items-center justify-center"
  >
    <div class="bg-gray-800 rounded-lg p-6 flex items-center space-x-3">
      <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-t-2 border-white"></div>

      <span class="text-white">Loading...</span>
    </div>
  </div>

  <!-- Mobile Overlay -->
  <div 
    v-if="appStore.mobileSidebarOpen || appStore.mobileUserSidebarOpen"
    class="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-30"
    @click="appStore.closeAllMobileSidebars()"
  ></div>
</template>

<script setup lang="ts">
import { useAppStore } from '@/stores'

const appStore = useAppStore()
</script>
