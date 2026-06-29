import { createApp } from 'vue'
import App from './app/App.vue'
import router from './app/router'
import './styles/global.css'
import { fpvI18n, type LocaleId } from './core/shared/i18n'
import enMessages from './locales/en.json'

// Pre-load English synchronously so there is no flash of untranslated content
fpvI18n.preload('en', enMessages)

const savedLocale = localStorage.getItem('fpv-locale') as LocaleId | null
if (savedLocale && savedLocale !== 'en') {
  // Load saved locale before mounting to prevent FOUC
  fpvI18n.setLocale(savedLocale).then(() => {
    const app = createApp(App)
    app.use(router)
    app.mount('#app')
  })
} else {
  const app = createApp(App)
  app.use(router)
  app.mount('#app')
}
