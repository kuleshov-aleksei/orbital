<template>
  <div
    class="legal-view h-full overflow-y-auto bg-theme-bg-primary text-theme-text-primary p-4 lg:p-8"
    data-testid="legal-view">
    <div class="w-full max-w-3xl mx-auto">
      <router-link
        to="/"
        class="inline-flex items-center gap-1.5 text-sm text-theme-text-muted hover:text-theme-text-primary transition-colors">
        <PhArrowLeft class="w-4 h-4" />
        <span>Back to Orbital</span>
      </router-link>

      <nav class="mt-6 flex gap-1 bg-theme-bg-secondary rounded-lg p-1 w-fit">
        <router-link
          v-for="(info, id) in LEGAL_DOCS"
          :key="id"
          :to="`/legal/${id}`"
          class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
          :class="
            doc === id
              ? 'bg-theme-bg-tertiary text-theme-text-primary'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          ">
          {{ info.title }}
        </router-link>
      </nav>

      <h1 class="mt-6 mb-1 text-3xl font-bold text-theme-text-primary">
        {{ LEGAL_DOCS[doc].title }}
      </h1>
      <LegalDocument :doc="doc" class="pb-8" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watchEffect } from "vue"
import { useRoute } from "vue-router"
import { PhArrowLeft } from "@phosphor-icons/vue"
import LegalDocument from "@/components/legal/LegalDocument.vue"
import { LEGAL_DOCS, isLegalDocId, type LegalDocId } from "@/components/legal/legal"

const route = useRoute()
// The route only matches "terms" or "privacy"; fall back defensively anyway.
const doc = computed<LegalDocId>(() =>
  isLegalDocId(route.params.doc) ? route.params.doc : "terms",
)

watchEffect(() => {
  document.title = `${LEGAL_DOCS[doc.value].title} · Orbital`
})
</script>
