<template>
  <div
    class="auth-view fixed inset-0 safe-area-pad bg-theme-bg-primary flex items-start lg:items-center justify-center overflow-y-auto z-50">
    <div class="max-w-md lg:max-w-5xl w-full px-5 lg:px-4 pt-10 pb-8 lg:py-0">
      <div class="lg:flex lg:items-center lg:justify-center lg:gap-16">
        <!-- Desktop brand panel -->
        <div v-if="!isMobile" class="text-center mb-8 lg:mb-0 lg:flex-shrink-0">
          <div
            class="w-20 h-20 lg:w-28 lg:h-28 bg-theme-accent rounded-2xl flex items-center justify-center mx-auto mb-4">
            <img
              src="/orbital-logo.png"
              alt="Orbital Logo"
              class="w-16 h-16 lg:w-24 lg:h-24 object-contain" />
          </div>

          <h1 class="text-3xl lg:text-4xl font-bold text-theme-text-primary mb-2">
            Welcome to Orbital
          </h1>
          <p class="text-theme-text-muted text-lg">Voice chat for my dudes</p>

          <!-- Landing actions: GitHub + Download (web only) -->
          <div v-if="!isElectron()" class="mt-6 flex items-center justify-center gap-3">
            <a
              href="https://github.com/kuleshov-aleksei/orbital"
              target="_blank"
              rel="noopener"
              data-testid="landing-github-button"
              class="flex items-center gap-2 px-4 py-2.5 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-lg transition-colors duration-200 font-medium text-sm">
              <PhGithubLogo class="w-5 h-5" />
              <span>GitHub</span>
            </a>

            <router-link
              to="/download"
              data-testid="landing-download-button"
              class="flex items-center gap-2 px-4 py-2.5 bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent rounded-lg transition-colors duration-200 font-medium text-sm">
              <PhDownloadSimple class="w-5 h-5" />
              <span>Download</span>
            </router-link>
          </div>
        </div>

        <!-- Auth card: a plain column on mobile, a card on desktop -->
        <div
          class="lg:bg-theme-bg-secondary lg:rounded-xl lg:p-8 lg:shadow-xl lg:w-[420px]"
          data-testid="auth-card">
          <!-- QR view (desktop only: the QR is scanned by a signed-in phone) -->
          <div v-if="view === 'qr'">
            <button
              type="button"
              data-testid="auth-qr-back"
              class="mb-4 flex items-center gap-1.5 text-sm text-theme-text-muted hover:text-theme-text-primary transition-colors"
              @click="view = 'form'">
              <PhArrowLeft class="w-4 h-4" />
              Back to sign in
            </button>
            <QRLoginPanel />
          </div>

          <template v-else>
            <!-- Heading -->
            <div class="text-center mb-6">
              <img
                v-if="isMobile"
                src="/orbital-logo.png"
                alt="Orbital Logo"
                class="w-14 h-14 object-contain mx-auto mb-3" />
              <h2 class="text-2xl font-bold text-theme-text-primary">
                {{ isRegisterMode ? "Create an account" : "Welcome back!" }}
              </h2>
              <p class="mt-1 text-theme-text-muted">
                {{ isRegisterMode ? "Join Orbital in a few seconds" : "Sign in to Orbital" }}
              </p>
            </div>

            <!-- Session expired notice -->
            <div
              v-if="userStore.sessionExpired"
              data-testid="session-expired-notice"
              class="mb-4 p-3 bg-amber-500/20 border border-amber-500 rounded-lg text-amber-200 text-sm">
              Your session expired. Please sign in again.
            </div>

            <!-- Error Message -->
            <div
              v-if="errorMessage"
              class="mb-4 p-3 bg-red-500/20 border border-red-500 rounded-lg text-red-300 text-sm">
              {{ errorMessage }}
            </div>

            <form data-testid="auth-form" @submit.prevent="handlePasswordSubmit">
              <!-- Nickname (only in register mode) -->
              <div v-if="isRegisterMode" class="mb-3">
                <label class="block text-theme-text-muted text-sm mb-1" for="nickname"
                  >Nickname</label
                >
                <input
                  id="nickname"
                  v-model="nickname"
                  type="text"
                  autocomplete="username"
                  autocapitalize="off"
                  :class="[inputClass, nicknameError ? 'border-red-500' : 'border-theme-border']"
                  placeholder="Choose a nickname"
                  required
                  @input="handleNicknameInput"
                  @blur="nicknameTouched = true" />
                <p v-if="nicknameTouched && !nickname" class="text-red-400 text-xs mt-1">
                  Nickname is required
                </p>
              </div>

              <!-- Email (only in register mode) -->
              <div v-if="isRegisterMode" class="mb-3">
                <label class="block text-theme-text-muted text-sm mb-1" for="email">Email</label>
                <input
                  id="email"
                  v-model="email"
                  type="email"
                  autocomplete="email"
                  :class="[inputClass, emailError ? 'border-red-500' : 'border-theme-border']"
                  placeholder="your@email.com"
                  required
                  @input="handleEmailInput"
                  @blur="emailTouched = true" />
                <p v-if="emailTouched && !email" class="text-red-400 text-xs mt-1">
                  Email is required
                </p>
                <p
                  v-else-if="emailTouched && email && !isEmailValid"
                  class="text-red-400 text-xs mt-1">
                  Please enter a valid email like name@example.com
                </p>
              </div>

              <!-- Login (email or nickname) - only in login mode -->
              <div v-if="!isRegisterMode" class="mb-3">
                <label class="block text-theme-text-muted text-sm mb-1" for="login"
                  >Email or nickname</label
                >
                <input
                  id="login"
                  v-model="login"
                  type="text"
                  autocomplete="username"
                  autocapitalize="off"
                  :class="[inputClass, 'border-theme-border']"
                  placeholder="Enter your email or nickname"
                  required
                  @input="handleLoginInput" />
              </div>

              <!-- Password -->
              <div class="mb-3 relative">
                <label class="block text-theme-text-muted text-sm mb-1" for="password"
                  >Password</label
                >
                <div class="relative">
                  <input
                    id="password"
                    v-model="password"
                    :type="showPassword ? 'text' : 'password'"
                    :autocomplete="isRegisterMode ? 'new-password' : 'current-password'"
                    :class="[
                      inputClass,
                      'pr-11',
                      passwordError ? 'border-red-500' : 'border-theme-border',
                    ]"
                    :placeholder="isRegisterMode ? 'Create a password' : 'Enter your password'"
                    required
                    @input="handlePasswordInput"
                    @focus="showPasswordTooltip = true"
                    @blur="handlePasswordBlur" />
                  <button
                    type="button"
                    :aria-label="showPassword ? 'Hide password' : 'Show password'"
                    class="absolute right-3 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text-primary"
                    @click="showPassword = !showPassword">
                    <PhEye v-if="!showPassword" class="w-5 h-5" />
                    <PhEyeSlash v-else class="w-5 h-5" />
                  </button>
                </div>

                <!-- Password Requirements Tooltip -->
                <div
                  v-if="isRegisterMode && showPasswordTooltip"
                  class="absolute z-10 left-0 right-0 -top-1 translate-y-[-100%] p-3 bg-theme-bg-tertiary border border-theme-border rounded-lg shadow-lg">
                  <p class="text-theme-text-muted text-xs mb-1">Password must contain:</p>
                  <ul class="text-xs space-y-0.5">
                    <li :class="passwordLengthValid ? 'text-green-400' : 'text-theme-text-muted'">
                      {{ passwordLengthValid ? "✓" : "○" }} At least 8 characters
                    </li>
                    <li :class="passwordNumberValid ? 'text-green-400' : 'text-theme-text-muted'">
                      {{ passwordNumberValid ? "✓" : "○" }} At least 1 number
                    </li>
                    <li :class="passwordSpecialValid ? 'text-green-400' : 'text-theme-text-muted'">
                      {{ passwordSpecialValid ? "✓" : "○" }} At least 1 special character
                    </li>
                  </ul>
                </div>
                <p
                  v-if="isRegisterMode && passwordTouched && !isPasswordValid && password"
                  class="text-red-400 text-xs mt-1">
                  Password does not meet requirements
                </p>
              </div>

              <!-- Confirm Password (only in register mode) -->
              <div v-if="isRegisterMode" class="mb-3">
                <label class="block text-theme-text-muted text-sm mb-1" for="confirmPassword"
                  >Confirm password</label
                >
                <div class="relative">
                  <input
                    id="confirmPassword"
                    v-model="confirmPassword"
                    :type="showConfirmPassword ? 'text' : 'password'"
                    autocomplete="new-password"
                    :class="[
                      inputClass,
                      'pr-11',
                      confirmPasswordError ? 'border-red-500' : 'border-theme-border',
                    ]"
                    placeholder="Confirm your password"
                    required
                    @input="handleConfirmPasswordInput"
                    @blur="confirmPasswordTouched = true" />
                  <button
                    type="button"
                    :aria-label="showConfirmPassword ? 'Hide password' : 'Show password'"
                    class="absolute right-3 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text-primary"
                    @click="showConfirmPassword = !showConfirmPassword">
                    <PhEye v-if="!showConfirmPassword" class="w-5 h-5" />
                    <PhEyeSlash v-else class="w-5 h-5" />
                  </button>
                </div>
                <p
                  v-if="confirmPasswordTouched && confirmPassword && password !== confirmPassword"
                  class="text-red-400 text-xs mt-1">
                  Passwords do not match
                </p>
              </div>

              <!-- Submit Button -->
              <button
                type="submit"
                class="mt-2 w-full py-3 bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent rounded-lg font-semibold transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="isLoading || (isRegisterMode && !canSubmit)">
                <span v-if="isLoading">Please wait...</span>
                <span v-else>{{ isRegisterMode ? "Create account" : "Log In" }}</span>
              </button>
            </form>

            <!-- Other ways to sign in (login mode only) -->
            <template v-if="!isRegisterMode">
              <div class="my-5 flex items-center gap-3" aria-hidden="true">
                <div class="flex-1 border-t border-theme-border" />
                <span class="text-xs font-semibold tracking-wider text-theme-text-muted">OR</span>
                <div class="flex-1 border-t border-theme-border" />
              </div>

              <div class="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  data-testid="auth-oauth-discord"
                  class="flex items-center justify-center gap-2 px-3 py-3 bg-[#5865F2] hover:bg-[#4752C4] text-white rounded-lg transition-colors duration-200 font-medium"
                  @click="handleLoginWithDiscord">
                  <DiscordIcon class="w-5 h-5" />
                  Discord
                </button>
                <button
                  type="button"
                  data-testid="auth-oauth-google"
                  class="flex items-center justify-center gap-2 px-3 py-3 bg-theme-text-primary hover:bg-theme-text-secondary text-theme-bg-primary rounded-lg transition-colors duration-200 font-medium"
                  @click="handleLoginWithGoogle">
                  <GoogleIcon class="w-5 h-5" />
                  Google
                </button>
              </div>

              <button
                type="button"
                data-testid="auth-guest"
                class="mt-2 w-full flex items-center justify-center gap-2 px-4 py-3 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-lg transition-colors duration-200 font-medium"
                @click="handleContinueAsGuest">
                <PhUser class="w-5 h-5" />
                Continue as guest
              </button>
              <p class="mt-2 text-center text-xs text-theme-text-muted">
                Guests can join voice rooms but can't share their screen.
              </p>

              <p v-if="!isMobile" class="mt-4 text-center text-sm text-theme-text-muted">
                Signed in on another device?
                <button
                  type="button"
                  data-testid="auth-qr-link"
                  class="text-theme-accent hover:text-theme-accent-hover font-medium"
                  @click="view = 'qr'">
                  Use a QR code
                </button>
              </p>
            </template>

            <!-- Login / Register switch -->
            <p class="mt-5 text-center text-sm text-theme-text-muted">
              {{ isRegisterMode ? "Already have an account?" : "Don't have an account?" }}
              <button
                type="button"
                data-testid="auth-register-toggle"
                class="text-theme-accent hover:text-theme-accent-hover font-medium ml-1"
                @click="isRegisterMode ? switchToLogin() : switchToRegister()">
                {{ isRegisterMode ? "Log in" : "Register" }}
              </button>
            </p>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue"
import { storeToRefs } from "pinia"
import { useUserStore, useAppStore } from "@/stores"
import {
  PhUser,
  PhEye,
  PhEyeSlash,
  PhArrowLeft,
  PhGithubLogo,
  PhDownloadSimple,
} from "@phosphor-icons/vue"
import { isElectron } from "@/services/electron"
import DiscordIcon from "~icons/simple-icons/discord"
import GoogleIcon from "~icons/logos/google-icon"
import QRLoginPanel from "@/components/auth/QRLoginPanel.vue"

const userStore = useUserStore()
const appStore = useAppStore()
const { isMobile } = storeToRefs(appStore)

const inputClass =
  "w-full px-4 py-2.5 bg-theme-bg-tertiary border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:border-theme-accent"

// The QR code is shown on the device that wants to sign in and scanned by a
// signed-in phone, so the QR view only exists on the desktop layout.
const view = ref<"form" | "qr">("form")
watch(isMobile, (mobile) => {
  if (mobile) view.value = "form"
})

const isRegisterMode = ref(false)
const isLoading = ref(false)
const errorMessage = ref("")

const login = ref("")
const password = ref("")
const confirmPassword = ref("")
const email = ref("")
const nickname = ref("")
const showPasswordTooltip = ref(false)
const showPassword = ref(false)
const showConfirmPassword = ref(false)
const nicknameTouched = ref(false)
const emailTouched = ref(false)
const passwordTouched = ref(false)
const confirmPasswordTouched = ref(false)

const nicknameError = computed(() => nicknameTouched.value && !nickname.value)
const emailError = computed(() => emailTouched.value && !email.value)
const passwordError = computed(
  () => passwordTouched.value && !isPasswordValid.value && password.value,
)
const confirmPasswordError = computed(
  () =>
    confirmPasswordTouched.value &&
    confirmPassword.value &&
    password.value !== confirmPassword.value,
)

const isEmailValid = computed(() => {
  if (!email.value) return false
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email.value)
})

const passwordsMatch = computed(() => password.value === confirmPassword.value)

const canSubmit = computed(() => {
  return (
    nickname.value &&
    email.value &&
    isEmailValid.value &&
    isPasswordValid.value &&
    passwordsMatch.value
  )
})

const passwordLengthValid = computed(() => password.value.length >= 8)
const passwordNumberValid = computed(() => /\d/.test(password.value))
const specialChars = "!@#$%^&*()_+=[]{}|;:,.<>?"
const passwordSpecialValid = computed(() =>
  [...specialChars].some((char) => password.value.includes(char)),
)

const isPasswordValid = computed(() => {
  return passwordLengthValid.value && passwordNumberValid.value && passwordSpecialValid.value
})

const handleLoginWithDiscord = () => {
  userStore.loginWithProvider("discord")
}

const handleLoginWithGoogle = () => {
  userStore.loginWithProvider("google")
}

const handleContinueAsGuest = async () => {
  try {
    await userStore.continueAsGuest()
  } catch (error: unknown) {
    const err = error as Error
    errorMessage.value = err.message || "Guest login failed. Please try again."
  }
}

const handleNicknameInput = () => {
  nickname.value = nickname.value.replace(/\s/g, "")
  nicknameTouched.value = true
}

const handleEmailInput = () => {
  email.value = email.value.replace(/\s/g, "")
  emailTouched.value = true
}

const handleLoginInput = () => {
  login.value = login.value.replace(/\s/g, "")
}

const handlePasswordInput = () => {
  passwordTouched.value = true
}

const handlePasswordBlur = () => {
  showPasswordTooltip.value = false
  passwordTouched.value = true
}

const handleConfirmPasswordInput = () => {
  confirmPasswordTouched.value = true
}

const handlePasswordSubmit = async () => {
  errorMessage.value = ""

  if (isRegisterMode.value) {
    if (password.value !== confirmPassword.value) {
      errorMessage.value = "Passwords do not match"
      return
    }
    if (!isPasswordValid.value) {
      errorMessage.value = "Password does not meet requirements"
      return
    }
    if (!email.value || !nickname.value) {
      errorMessage.value = "Please fill in all fields"
      return
    }

    isLoading.value = true
    try {
      await userStore.register(email.value, nickname.value, password.value)
    } catch (error: unknown) {
      const err = error as Error
      errorMessage.value = err.message || "Registration failed. Please try again."
    } finally {
      isLoading.value = false
    }
  } else {
    if (!login.value || !password.value) {
      errorMessage.value = "Please enter your email/nickname and password"
      return
    }

    isLoading.value = true
    try {
      await userStore.loginWithPassword(login.value, password.value)
    } catch (error: unknown) {
      const err = error as Error
      errorMessage.value = err.message || "Invalid credentials. Please try again."
    } finally {
      isLoading.value = false
    }
  }
}

const switchToRegister = () => {
  // Move login value to appropriate field
  if (login.value) {
    if (login.value.includes("@")) {
      email.value = login.value.trim()
    } else {
      nickname.value = login.value.trim()
    }
    // Clear login only, preserve password
    login.value = ""
  }
  isRegisterMode.value = true
}

const switchToLogin = () => {
  // Move email/nickname back to login field if switching back
  if (email.value || nickname.value) {
    if (email.value) {
      login.value = email.value
    } else if (nickname.value) {
      login.value = nickname.value
    }
    // Clear email/nickname only, preserve password
    email.value = ""
    nickname.value = ""
  }
  isRegisterMode.value = false
}
</script>
