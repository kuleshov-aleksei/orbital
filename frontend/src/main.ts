import { createApp, type Component } from "vue"
import { createPinia } from "pinia"
import App from "./App.vue"
import router from "./router"
import { useConfigStore, useSoundPackStore } from "./stores"
import "./style.css"
import { debugLog, debugError } from "@/utils/debug"

// Log frontend version at startup

debugLog(`[Orbital] Frontend version: ${__APP_VERSION__}`)

const app = createApp(App as Component)

const pinia = createPinia()
app.use(pinia)
app.use(router)

// Load configuration before mounting the app
const configStore = useConfigStore(pinia)
const soundPackStore = useSoundPackStore(pinia)
soundPackStore.loadFromStorage()
debugLog("[Orbital] Loading config...")
configStore
  .loadConfig()
  .then(() => {
    debugLog("[Orbital] Config loaded, mounting app...")
    app.mount("#app")
    debugLog("[Orbital] App mounted successfully")
  })
  .catch((error) => {
    debugError("[Orbital] Failed to load configuration:", error)
    debugLog("[Orbital] Mounting app anyway...")
    app.mount("#app")
    debugLog("[Orbital] App mounted with defaults")
  })

// Global error handler
app.config.errorHandler = (err, _instance, info) => {
  debugError("[Orbital] Vue error:", err)
  debugError("[Orbital] Vue error info:", info)
}
