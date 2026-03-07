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
configStore
  .loadConfig()
  .then(() => {
    app.mount("#app")
  })
  .catch((error) => {
    console.error("Failed to load configuration, using defaults:", error)
    app.mount("#app")
  })
