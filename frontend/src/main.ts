import { createApp, type Component } from "vue"
import { createPinia } from "pinia"
import App from "./App.vue"
import router from "./router"
import { useConfigStore, useSoundPackStore } from "./stores"
import "./style.css"

// Log frontend version at startup

console.log(`[Orbital] Frontend version: ${__APP_VERSION__}`)

const app = createApp(App as Component)

const pinia = createPinia()
app.use(pinia)
app.use(router)

// Load configuration before mounting the app
const configStore = useConfigStore(pinia)
const soundPackStore = useSoundPackStore(pinia)
soundPackStore.loadFromStorage()
console.log("[Orbital] Loading config...")
configStore
  .loadConfig()
  .then(() => {
    console.log("[Orbital] Config loaded, mounting app...")
    app.mount("#app")
    console.log("[Orbital] App mounted successfully")
  })
  .catch((error) => {
    console.error("[Orbital] Failed to load configuration:", error)
    console.log("[Orbital] Mounting app anyway...")
    app.mount("#app")
    console.log("[Orbital] App mounted with defaults")
  })

// Global error handler
app.config.errorHandler = (err, _instance, info) => {
  console.error("[Orbital] Vue error:", err)
  console.error("[Orbital] Vue error info:", info)
}
