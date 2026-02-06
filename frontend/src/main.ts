import { createApp, type Component } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './style.css'

// Log frontend version at startup
// eslint-disable-next-line no-console
console.log(`[Orbital] Frontend version: ${__APP_VERSION__}`)

const app = createApp(App as Component)

app.use(createPinia())
app.use(router)

app.mount('#app')