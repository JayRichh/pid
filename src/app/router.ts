import { createRouter, createWebHashHistory } from 'vue-router'
import { fpvI18n } from '@core/shared/i18n'
import { ROUTE_SEO_KEYS } from './seo'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('./views/HomeView.vue'),
    },
    {
      path: '/pid',
      name: 'pid',
      component: () => import('./views/PidView.vue'),
    },
    {
      path: '/power',
      name: 'power',
      component: () => import('./views/PowerView.vue'),
    },
    {
      path: '/motors',
      name: 'motors',
      component: () => import('./views/MotorsView.vue'),
    },
    {
      path: '/rf',
      name: 'rf',
      component: () => import('./views/RfView.vue'),
    },
    {
      path: '/convert',
      name: 'convert',
      component: () => import('./views/ConvertView.vue'),
    },
    {
      path: '/blackbox',
      name: 'blackbox',
      component: () => import('./views/BlackboxView.vue'),
    },
    {
      path: '/tilt',
      name: 'tilt',
      component: () => import('./views/TiltView.vue'),
    },
    {
      path: '/diff',
      name: 'diff',
      component: () => import('./views/DiffView.vue'),
    },
  ],
})

function applyMeta(path: string): void {
  const key = ROUTE_SEO_KEYS[path] ?? 'home'
  document.title = fpvI18n.t(`seo.${key}_title`)

  let descEl = document.querySelector('meta[name="description"]')
  if (descEl) descEl.setAttribute('content', fpvI18n.t(`seo.${key}_desc`))

  let ogTitleEl = document.querySelector('meta[property="og:title"]')
  if (!ogTitleEl) {
    ogTitleEl = document.createElement('meta')
    ogTitleEl.setAttribute('property', 'og:title')
    document.head.appendChild(ogTitleEl)
  }
  ogTitleEl.setAttribute('content', fpvI18n.t(`seo.${key}_title`))

  let ogDescEl = document.querySelector('meta[property="og:description"]')
  if (!ogDescEl) {
    ogDescEl = document.createElement('meta')
    ogDescEl.setAttribute('property', 'og:description')
    document.head.appendChild(ogDescEl)
  }
  ogDescEl.setAttribute('content', fpvI18n.t(`seo.${key}_desc`))
}

// Re-apply meta whenever locale changes
fpvI18n.subscribe(() => {
  const currentPath = router.currentRoute.value.path
  applyMeta(currentPath)
})

router.beforeEach((to) => {
  applyMeta(to.path)
})

export default router
