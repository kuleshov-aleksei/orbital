<template>
  <div>
    <div
      class="pumpkin-strip flex items-end gap-3 px-4 py-2 rounded-2xl bg-theme-bg-secondary/70 backdrop-blur-md shadow-lg">
      <div
        v-for="pumpkin in pumpkins"
        :key="pumpkin.user_id"
        class="flex flex-col items-center group">
        <span class="text-xs font-semibold mb-1 text-theme-text-primary truncate max-w-16">
          {{ pumpkin.nickname }}
        </span>
        <div
          :class="pumpkin.isLocal ? 'cursor-pointer group-hover:scale-105' : 'cursor-default'"
          class="transition-transform"
          @click="pumpkin.isLocal && (showModal = true)">
          <PumpkinSprite :equipped="pumpkin.equipped" :size="64" />
        </div>
        <PhCaretDown v-if="pumpkin.isLocal" class="w-3 h-3 text-theme-text-muted mt-0.5" />
      </div>
    </div>

    <Teleport to="body">
      <PumpkinModal v-if="showModal" @close="showModal = false" />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { PhCaretDown } from "@phosphor-icons/vue"
import PumpkinSprite from "./PumpkinSprite.vue"
import PumpkinModal from "./PumpkinModal.vue"
import { useHalloweenStore, useUserStore } from "@/stores"
import type { User } from "@/types"

const props = defineProps<{
  users: User[]
}>()

const halloweenStore = useHalloweenStore()
const userStore = useUserStore()
const showModal = ref(false)

const pumpkins = computed(() =>
  props.users.map((user) => {
    const isLocal = user.id === userStore.userId
    const equipped = isLocal ? halloweenStore.equipped : halloweenStore.others[user.id] || {}
    return {
      user_id: user.id,
      nickname: user.nickname,
      equipped,
      isLocal,
    }
  }),
)

onMounted(() => {
  void halloweenStore.fetchConfig()
  void halloweenStore.fetchState()
})
</script>
