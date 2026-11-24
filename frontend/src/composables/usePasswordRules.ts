import { computed, type Ref } from "vue"

// Same rules as the backend (service.ValidatePassword).
const SPECIAL = "!@#$%^&*()_+-=[]{}|;:,.<>?"

/** Live checklist of the password rules, for new-password forms. */
export function usePasswordRules(password: Ref<string>) {
  const rules = computed(() => [
    { label: "At least 8 characters", ok: password.value.length >= 8 },
    { label: "At least 1 number", ok: /\d/.test(password.value) },
    {
      label: "At least 1 special character",
      ok: [...SPECIAL].some((c) => password.value.includes(c)),
    },
  ])
  const passwordOk = computed(() => rules.value.every((r) => r.ok))
  return { rules, passwordOk }
}
