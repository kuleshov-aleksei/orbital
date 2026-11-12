<template>
  <PhLock v-if="isPrivate" aria-label="Private channel" data-testid="text-channel-icon-private" />
  <PhGlobe v-else aria-label="Public channel" data-testid="text-channel-icon-public" />
</template>

<script setup lang="ts">
import { computed } from "vue"
import { PhGlobe, PhLock } from "@phosphor-icons/vue"
import { usePermissionsStore } from "@/stores/permissions"

// Public: default permissions. Private: any permission customization (the
// room's own overwrites, or its category's while synced). Size it with class.
const props = defineProps<{ roomId: string | null | undefined }>()

const permissionsStore = usePermissionsStore()
const isPrivate = computed(() => !!props.roomId && permissionsStore.isPrivateRoom(props.roomId))
</script>
