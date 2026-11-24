import type { Component } from "vue"
import TermsOfService from "./TermsOfService.vue"
import PrivacyPolicy from "./PrivacyPolicy.vue"

export { LEGAL } from "./legalInfo"

export type LegalDocId = "terms" | "privacy"

export const LEGAL_DOCS: Record<LegalDocId, { title: string; component: Component }> = {
  terms: { title: "Terms of Service", component: TermsOfService },
  privacy: { title: "Privacy Policy", component: PrivacyPolicy },
}

export function isLegalDocId(value: unknown): value is LegalDocId {
  return value === "terms" || value === "privacy"
}
