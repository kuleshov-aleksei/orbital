<template>
  <div
    class="download-view min-h-screen bg-theme-bg-primary text-theme-text-primary flex flex-col p-4 lg:p-8"
    data-testid="download-view">
    <!-- Back to app -->
    <router-link
      to="/"
      class="inline-flex items-center gap-1.5 self-start text-sm text-theme-text-muted hover:text-theme-text-primary transition-colors">
      <PhArrowLeft class="w-4 h-4" />
      <span>Back to Orbital</span>
    </router-link>

    <div class="flex-1 flex flex-col items-center justify-center w-full max-w-3xl mx-auto py-8">
      <!-- Header -->
      <div class="text-center mb-10">
        <div
          class="w-20 h-20 lg:w-24 lg:h-24 bg-theme-accent rounded-2xl flex items-center justify-center mx-auto mb-4">
          <img
            src="/orbital-logo.png"
            alt="Orbital Logo"
            class="w-16 h-16 lg:w-20 lg:h-20 object-contain" />
        </div>

        <h1 class="text-3xl lg:text-4xl font-bold text-theme-text-primary mb-2">
          Download Orbital
        </h1>

        <p class="text-theme-text-muted text-lg">
          Native desktop voice chat. Lower latency, screen sharing, and global hotkeys.
        </p>

        <p class="mt-3 text-sm text-theme-text-muted">
          Version <span class="font-mono text-theme-text-secondary">{{ version }}</span>
        </p>
      </div>

      <!-- Platform cards -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
        <div
          v-for="platform in platforms"
          :key="platform.key"
          :data-testid="`download-${platform.key}`"
          class="relative bg-theme-bg-secondary rounded-xl p-6 border transition-all duration-200 flex flex-col"
          :class="
            platform.key === detectedOS
              ? 'border-theme-accent ring-1 ring-theme-accent'
              : 'border-theme-border'
          ">
          <span
            v-if="platform.key === detectedOS"
            class="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-medium bg-theme-accent text-theme-text-on-accent whitespace-nowrap">
            Recommended for your device
          </span>

          <div class="flex items-center gap-3 mb-4">
            <div
              class="w-12 h-12 rounded-lg flex items-center justify-center"
              :class="
                platform.key === detectedOS
                  ? 'bg-theme-accent text-theme-text-on-accent'
                  : 'bg-theme-bg-tertiary text-theme-text-secondary'
              ">
              <component :is="platform.icon" class="w-7 h-7" weight="fill" />
            </div>

            <div>
              <h2 class="text-lg font-semibold text-theme-text-primary">{{ platform.name }}</h2>
              <p class="text-xs text-theme-text-muted">{{ platform.detail }}</p>
            </div>
          </div>

          <p class="text-sm text-theme-text-muted mb-6 flex-1">{{ platform.description }}</p>

          <a
            :href="platform.url"
            class="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-colors duration-200"
            :class="
              platform.key === detectedOS
                ? 'bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent'
                : 'bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary'
            ">
            <PhDownloadSimple class="w-5 h-5" />
            <span>{{ platform.buttonLabel }}</span>
          </a>
        </div>
      </div>

      <p class="mt-8 text-center text-xs text-theme-text-muted">
        Looking for something else?
        <a
          href="https://github.com/kuleshov-aleksei/orbital"
          target="_blank"
          rel="noopener"
          class="text-theme-accent hover:text-theme-accent-hover">
          View all releases on GitHub
        </a>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, type Component } from "vue"
import { PhArrowLeft, PhDownloadSimple, PhWindowsLogo, PhLinuxLogo } from "@phosphor-icons/vue"

declare const __APP_VERSION__: string

const DOWNLOAD_BASE_URL = "https://orbital-updates.encamy.com"

type OS = "windows" | "linux" | "unknown"

const version = __APP_VERSION__.replace(/-[0-9a-f]{8}$/, "")

const detectedOS = computed<OS>(() => {
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return "windows"
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return "linux"
  return "unknown"
})

interface Platform {
  key: Exclude<OS, "unknown">
  name: string
  detail: string
  description: string
  buttonLabel: string
  url: string
  icon: Component
}

const platforms = computed<Platform[]>(() => {
  const list: Platform[] = [
    {
      key: "windows",
      name: "Windows",
      detail: "Installer · Windows 10/11 · x64",
      description: "Download and run the installer to set up Orbital on your PC.",
      buttonLabel: "Download for Windows",
      url: `${DOWNLOAD_BASE_URL}/Orbital-Setup-${version}.exe`,
      icon: PhWindowsLogo,
    },
    {
      key: "linux",
      name: "Linux",
      detail: "AppImage · x64",
      description: "Download the AppImage, make it executable, and run it anywhere.",
      buttonLabel: "Download for Linux",
      url: `${DOWNLOAD_BASE_URL}/Orbital-${version}.AppImage`,
      icon: PhLinuxLogo,
    },
  ]

  // Keep the detected platform's card first
  if (detectedOS.value !== "unknown") {
    list.sort((a, b) => Number(b.key === detectedOS.value) - Number(a.key === detectedOS.value))
  }

  return list
})
</script>
