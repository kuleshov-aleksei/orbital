<template>
  <div class="auth-view fixed inset-0 bg-gray-900 flex items-center justify-center z-50">
    <div class="max-w-md lg:max-w-5xl w-full mx-4">
      <div class="lg:flex lg:items-center lg:justify-center lg:gap-16">
        <!-- Logo/Title -->
        <div class="text-center lg:text-left mb-8 lg:mb-0 lg:flex-shrink-0">
          <div
            class="w-20 h-20 lg:w-28 lg:h-28 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto lg:mx-0 mb-4">
            <img
              src="/orbital-logo.png"
              alt="Orbital Logo"
              class="w-16 h-16 lg:w-24 lg:h-24 object-contain" />
          </div>

          <h1 class="text-3xl lg:text-4xl font-bold text-white mb-2">Welcome to Orbital</h1>

          <p class="text-gray-400 text-lg">Voice chat for my dudes</p>
        </div>

        <!-- Auth Card -->
        <div class="bg-gray-800 rounded-xl p-8 shadow-xl lg:w-[420px]">
          <!-- Tabs -->
          <div class="flex border-b border-gray-700 mb-6">
            <button
              type="button"
              class="flex-1 py-2 text-center font-medium transition-colors"
              :class="
                activeTab === 'oauth'
                  ? 'text-white border-b-2 border-indigo-500'
                  : 'text-gray-400 hover:text-gray-300'
              "
              @click="activeTab = 'oauth'">
              OAuth providers
            </button>
            <button
              type="button"
              class="flex-1 py-2 text-center font-medium transition-colors"
              :class="
                activeTab === 'password'
                  ? 'text-white border-b-2 border-indigo-500'
                  : 'text-gray-400 hover:text-gray-300'
              "
              @click="activeTab = 'password'">
              {{ isRegisterMode ? "Register" : "Login" }}
            </button>
          </div>

          <!-- OAuth Providers Tab -->
          <div v-show="activeTab === 'oauth'">
            <h2 class="text-xl font-semibold text-white text-center mb-6">Choose how to join</h2>

            <!-- OAuth Provider Buttons -->
            <div class="space-y-2 mb-4">
              <!-- Discord Login -->
              <button
                type="button"
                class="w-full flex items-center justify-center px-4 py-3 bg-[#5865F2] hover:bg-[#4752C4] text-white rounded-lg transition-colors duration-200 font-medium"
                @click="handleLoginWithDiscord">
                <DiscordIcon class="w-5 h-5 mr-3" />
                Login with Discord
              </button>

              <!-- Google Login -->
              <button
                type="button"
                class="w-full flex items-center justify-center px-4 py-3 bg-white hover:bg-gray-100 text-gray-700 rounded-lg transition-colors duration-200 font-medium"
                @click="handleLoginWithGoogle">
                <GoogleIcon class="w-5 h-5 mr-3" />
                Login with Google
              </button>

              <!-- Fake gosuslugi Login -->
              <button
                type="button"
                class="w-full flex items-center justify-center px-4 py-3 bg-white hover:bg-gray-100 text-gray-700 rounded-lg transition-colors duration-200 font-medium"
                @click="handleLoginWithGosuslugi">
                Войти через <img src="/gosusligi-text.svg" class="w-28 h-7" />
              </button>
            </div>

            <!-- Divider -->
            <div class="relative mb-4">
              <div class="absolute inset-0 flex items-center">
                <div class="w-full border-t border-gray-700"></div>
              </div>

              <div class="relative flex justify-center text-sm">
                <span class="px-2 bg-gray-800 text-gray-500">or</span>
              </div>
            </div>

            <!-- Guest Option -->
            <button
              type="button"
              class="w-full flex items-center justify-center px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors duration-200 font-medium"
              @click="handleContinueAsGuest">
              <PhUser class="w-5 h-5 mr-3" />
              Continue as Guest
            </button>

            <!-- Restriction Notice -->
            <div class="mt-4 flex items-start text-sm text-gray-400">
              <PhLock class="w-4 h-4 mr-2 mt-0.5 flex-shrink-0 text-gray-500" />

              <span>Some features are restricted for guests, like screensharing</span>
            </div>
          </div>

          <!-- Password Tab -->
          <div v-show="activeTab === 'password'">
            <!-- Error Message -->
            <div
              v-if="errorMessage"
              class="mb-4 p-3 bg-red-500/20 border border-red-500 rounded-lg text-red-300 text-sm">
              {{ errorMessage }}
            </div>

            <form @submit.prevent="handlePasswordSubmit">
              <!-- Nickname (only in register mode) -->
              <div v-if="isRegisterMode" class="mb-3">
                <label class="block text-gray-400 text-sm mb-1" for="nickname">Nickname</label>
                <input
                  id="nickname"
                  v-model="nickname"
                  type="text"
                  class="w-full px-4 py-2 bg-gray-700 border rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-indigo-500"
                  :class="nicknameError ? 'border-red-500' : 'border-gray-600'"
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
                <label class="block text-gray-400 text-sm mb-1" for="email">Email</label>
                <input
                  id="email"
                  v-model="email"
                  type="email"
                  class="w-full px-4 py-2 bg-gray-700 border rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-indigo-500"
                  :class="emailError ? 'border-red-500' : 'border-gray-600'"
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
                  Invalid email format
                </p>
              </div>

              <!-- Login (email or nickname) - only in login mode -->
              <div v-if="!isRegisterMode" class="mb-3">
                <label class="block text-gray-400 text-sm mb-1" for="login"
                  >Email or Nickname</label
                >
                <input
                  id="login"
                  v-model="login"
                  type="text"
                  class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-indigo-500"
                  placeholder="Enter your email or nickname"
                  required
                  @input="handleLoginInput" />
              </div>

              <!-- Password -->
              <div class="mb-3 relative">
                <label class="block text-gray-400 text-sm mb-1" for="password">Password</label>
                <input
                  id="password"
                  v-model="password"
                  type="password"
                  class="w-full px-4 py-2 bg-gray-700 border rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-indigo-500"
                  :class="passwordError ? 'border-red-500' : 'border-gray-600'"
                  :placeholder="isRegisterMode ? 'Create a password' : 'Enter your password'"
                  required
                  @input="handlePasswordInput"
                  @focus="showPasswordTooltip = true"
                  @blur="handlePasswordBlur" />

                <!-- Password Requirements Tooltip -->
                <div
                  v-if="isRegisterMode && showPasswordTooltip"
                  class="absolute z-10 left-0 right-0 -top-1 translate-y-[-100%] p-3 bg-gray-700 border border-gray-600 rounded-lg shadow-lg">
                  <p class="text-gray-400 text-xs mb-1">Password must contain:</p>
                  <ul class="text-xs space-y-0.5">
                    <li :class="passwordLengthValid ? 'text-green-400' : 'text-gray-500'">
                      {{ passwordLengthValid ? "✓" : "○" }} At least 8 characters
                    </li>
                    <li :class="passwordNumberValid ? 'text-green-400' : 'text-gray-500'">
                      {{ passwordNumberValid ? "✓" : "○" }} At least 1 number
                    </li>
                    <li :class="passwordSpecialValid ? 'text-green-400' : 'text-gray-500'">
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
                <label class="block text-gray-400 text-sm mb-1" for="confirmPassword"
                  >Confirm Password</label
                >
                <input
                  id="confirmPassword"
                  v-model="confirmPassword"
                  type="password"
                  class="w-full px-4 py-2 bg-gray-700 border rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-indigo-500"
                  :class="confirmPasswordError ? 'border-red-500' : 'border-gray-600'"
                  placeholder="Confirm your password"
                  required
                  @input="handleConfirmPasswordInput"
                  @blur="confirmPasswordTouched = true" />
                <p
                  v-if="confirmPasswordTouched && confirmPassword && password !== confirmPassword"
                  class="text-red-400 text-xs mt-1">
                  Passwords do not match
                </p>
              </div>

              <!-- Submit Button -->
              <button
                type="submit"
                class="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="isLoading || (isRegisterMode && !canSubmit)"
                @click="handlePasswordSubmit">
                <span v-if="isLoading">Loading...</span>
                <span v-else>{{ isRegisterMode ? "Register" : "Login" }}</span>
              </button>
            </form>

            <!-- Toggle Mode Link -->
            <div class="mt-4 text-center">
              <span v-if="!isRegisterMode" class="text-gray-400">
                Don't have an account?
                <button
                  type="button"
                  class="text-indigo-400 hover:text-indigo-300 font-medium ml-1"
                  @click="switchToRegister">
                  Register
                </button>
              </span>
              <span v-else class="text-gray-400">
                Already have an account?
                <button
                  type="button"
                  class="text-indigo-400 hover:text-indigo-300 font-medium ml-1"
                  @click="switchToLogin">
                  Login
                </button>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue"
import { useUserStore } from "@/stores"
import { PhUser, PhLock } from "@phosphor-icons/vue"
import DiscordIcon from "~icons/simple-icons/discord"
import GoogleIcon from "~icons/logos/google-icon"

const userStore = useUserStore()

const activeTab = ref<"oauth" | "password">("oauth")

const isRegisterMode = ref(false)
const isLoading = ref(false)
const errorMessage = ref("")

const login = ref("")
const password = ref("")
const confirmPassword = ref("")
const email = ref("")
const nickname = ref("")
const showPasswordTooltip = ref(false)
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

const handleLoginWithGosuslugi = () => {
  window.location.href = `https://www.youtube.com/watch?v=dQw4w9WgXcQ`
}

const handleContinueAsGuest = async () => {
  await userStore.continueAsGuest()
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
