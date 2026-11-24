<template>
  <component :is="LEGAL_DOCS[doc].component" />
</template>

<script setup lang="ts">
import { LEGAL_DOCS, type LegalDocId } from "./legal"

defineProps<{ doc: LegalDocId }>()
</script>

<style>
/* Not scoped: the rules style the markup of the child document components. */
.legal-doc {
  color: var(--color-text-secondary);
  font-size: 0.9375rem;
  line-height: 1.65;
}
.legal-doc h2 {
  color: var(--color-text-primary);
  font-size: 1.125rem;
  font-weight: 600;
  margin: 1.75rem 0 0.5rem;
}
.legal-doc h3 {
  color: var(--color-text-primary);
  font-size: 1rem;
  font-weight: 600;
  margin: 1.25rem 0 0.375rem;
}
.legal-doc p {
  margin: 0 0 0.75rem;
}
.legal-doc ul,
.legal-doc ol {
  margin: 0 0 0.75rem;
  padding-left: 1.5rem;
}
.legal-doc ul {
  list-style: disc;
}
.legal-doc ol {
  list-style: decimal;
}
.legal-doc li {
  margin-bottom: 0.375rem;
}
.legal-doc strong {
  color: var(--color-text-primary);
  font-weight: 600;
}
.legal-doc a {
  color: var(--color-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
  overflow-wrap: anywhere;
}
.legal-doc a:hover {
  color: var(--color-accent-hover);
}
.legal-doc .legal-meta {
  color: var(--color-text-muted);
  font-size: 0.8125rem;
}
.legal-doc .legal-summary {
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  padding: 0.875rem 1rem 0.25rem;
  margin-bottom: 1rem;
}
</style>
