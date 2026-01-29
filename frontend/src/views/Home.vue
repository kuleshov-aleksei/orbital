<template>
  <div class="text-center">
    <h2 class="text-3xl font-bold mb-8">Welcome to The Orbital</h2>
    <p class="text-lg mb-4">Voice chat for 5-10 people</p>
    <div class="space-y-4">
      <button class="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg">
        Create Room
      </button>
      <div>
        <input 
          type="text" 
          placeholder="Enter room code" 
          class="bg-gray-800 px-4 py-2 rounded-lg mr-2"
        />
        <button class="bg-green-600 hover:bg-green-700 px-6 py-2 rounded-lg">
          Join Room
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({
  name: 'HomeView'
})
</script>