<template>
  <!-- Mobile bottom sheet; the parent fills it with rows (see `actionSheetRow`). -->
  <Teleport to="body">
    <Transition name="sheet" appear>
      <div
        v-if="open"
        class="fixed inset-0 z-[9999] flex flex-col justify-end"
        @keydown.escape.prevent.stop="$emit('close')">
        <div class="absolute inset-0 bg-black/50" @click="$emit('close')" />
        <div
          ref="panel"
          class="sheet-panel relative max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-theme-border bg-theme-bg-secondary shadow-2xl"
          role="menu"
          :aria-label="title"
          tabindex="-1"
          :data-testid="testid">
          <div class="mx-auto mt-2 mb-1 h-1 w-10 rounded-full bg-theme-border" aria-hidden="true" />
          <div
            v-if="title || $slots.title"
            class="px-5 pt-1 pb-2 text-sm font-semibold text-theme-text-primary truncate border-b border-theme-border">
            <slot name="title">{{ title }}</slot>
          </div>
          <div class="px-2 py-1">
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script lang="ts">
/** Class for a row button inside the sheet. */
export const actionSheetRow =
  "w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-[15px] text-theme-text-primary active:bg-theme-bg-hover transition-colors"
</script>

<script setup lang="ts">
import { nextTick, useTemplateRef, watch } from "vue"

const props = defineProps<{
  open: boolean
  title?: string
  testid?: string
}>()

defineEmits<{ close: [] }>()

const panel = useTemplateRef<HTMLDivElement>("panel")

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    await nextTick()
    panel.value?.focus()
  },
)
</script>

<style scoped>
.sheet-panel {
  padding-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px));
}
.sheet-panel:focus-visible {
  outline: none;
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.18s ease;
}
.sheet-enter-active .sheet-panel,
.sheet-leave-active .sheet-panel {
  transition: transform 0.18s ease;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .sheet-panel,
.sheet-leave-to .sheet-panel {
  transform: translateY(100%);
}
@media (prefers-reduced-motion: reduce) {
  .sheet-enter-active .sheet-panel,
  .sheet-leave-active .sheet-panel {
    transition: none;
  }
}
</style>
