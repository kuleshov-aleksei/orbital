<template>
  <div class="flex items-center justify-center h-full">
    <div class="text-center">
      <div class="w-20 h-20 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
        <PhMicrophone class="w-10 h-10 text-gray-600" />
      </div>
      <h3 class="text-xl font-semibold text-white mb-2">Waiting for others...</h3>
      <p class="text-gray-400">You're the first one here. Invite some friends to join!</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { PhMicrophone } from '@phosphor-icons/vue'
</script>
