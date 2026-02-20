import { createApp, type Component } from "vue"
import { createPinia } from "pinia"
import App from "./App.vue"
import router from "./router"
import { useConfigStore } from "./stores"
import { initSounds } from "./services/sounds"
import "./style.css"

// Log frontend version at startup
// eslint-disable-next-line no-console
console.log(`[Orbital] Frontend version: ${__APP_VERSION__}`)

// Preload sounds immediately
initSounds().catch((error) => {
  console.warn("Failed to preload sounds:", error)
})

const app = createApp(App as Component)

const pinia = createPinia()
app.use(pinia)
app.use(router)

// Load configuration before mounting the app
const configStore = useConfigStore(pinia)
configStore
  .loadConfig()
  .then(() => {
    app.mount("#app")
  })
  .catch((error) => {
    console.error("Failed to load configuration, using defaults:", error)
    app.mount("#app")
  })
