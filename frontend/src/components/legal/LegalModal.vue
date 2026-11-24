<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 bg-theme-backdrop flex items-center justify-center z-[60] p-4"
      data-testid="legal-modal"
      @click.self="emit('close')">
      <div
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        class="bg-theme-bg-secondary border border-theme-border rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div
          class="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-theme-border">
          <div class="flex gap-1 bg-theme-bg-tertiary rounded-lg p-1" role="tablist">
            <button
              v-for="(info, id) in LEGAL_DOCS"
              :key="id"
              type="button"
              role="tab"
              :aria-selected="current === id"
              :data-testid="`legal-tab-${id}`"
              class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
              :class="
                current === id
                  ? 'bg-theme-bg-secondary text-theme-text-primary'
                  : 'text-theme-text-muted hover:text-theme-text-primary'
              "
              @click="current = id">
              {{ info.title }}
            </button>
          </div>
          <button
            type="button"
            class="text-theme-text-muted hover:text-theme-text-primary"
            title="Close"
            data-testid="legal-modal-close"
            @click="emit('close')">
            <PhX class="w-5 h-5" />
          </button>
        </div>

        <div ref="scrollEl" class="overflow-y-auto px-5 py-4">
          <h1 :id="titleId" class="text-xl font-bold text-theme-text-primary mb-1">
            {{ LEGAL_DOCS[current].title }}
          </h1>
          <LegalDocument :doc="current" />
        </div>

        <div class="px-5 py-3 border-t border-theme-border flex justify-end">
          <button
            type="button"
            class="px-4 py-2 bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent rounded-lg font-medium text-sm transition-colors"
            @click="emit('close')">
            Close
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, useTemplateRef } from "vue"
import { PhX } from "@phosphor-icons/vue"
import LegalDocument from "./LegalDocument.vue"
import { LEGAL_DOCS, type LegalDocId } from "./legal"

const props = defineProps<{ doc: LegalDocId }>()
const emit = defineEmits<{ close: [] }>()

const titleId = "legal-modal-title"
const current = ref<LegalDocId>(props.doc)
const scrollEl = useTemplateRef<HTMLElement>("scrollEl")

watch(current, () => {
  scrollEl.value?.scrollTo({ top: 0 })
})

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close")
}

onMounted(() => window.addEventListener("keydown", onKeydown))
onUnmounted(() => window.removeEventListener("keydown", onKeydown))
</script>
