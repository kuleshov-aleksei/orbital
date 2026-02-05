import { createApp, type Component } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './style.css'

const app = createApp(App as Component)

app.use(createPinia())
app.use(router)

app.mount('#app')