<template>
  <div class="layout">
    <header class="nav">
      <div class="nav-inner">
        <router-link class="brand" to="/">{{ t('nav.brand') }}</router-link>
        <nav class="nav-links" :class="{ open: navOpen }" aria-label="Main navigation">
          <router-link to="/pid">{{ t('nav.pid') }}</router-link>
          <router-link to="/power">{{ t('nav.power') }}</router-link>
          <router-link to="/motors">{{ t('nav.motors') }}</router-link>
          <router-link to="/rf">{{ t('nav.rf') }}</router-link>
          <router-link to="/convert">{{ t('nav.convert') }}</router-link>
          <router-link to="/blackbox">{{ t('nav.blackbox') }}</router-link>
          <router-link to="/tilt">{{ t('nav.tilt') }}</router-link>
          <router-link to="/diff">{{ t('nav.diff') }}</router-link>
        </nav>
        <button
          class="nav-hamburger"
          @click="navOpen = !navOpen"
          aria-label="Menu"
          :aria-expanded="navOpen"
        >
          <span class="hamburger-bar" :class="{ open: navOpen }"></span>
          <span class="hamburger-bar" :class="{ open: navOpen }"></span>
          <span class="hamburger-bar" :class="{ open: navOpen }"></span>
        </button>
        <PrefsDropdown />
      </div>
    </header>
    <main class="main">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from './composables/useI18n'
import PrefsDropdown from './components/PrefsDropdown.vue'

const { t } = useI18n()
const navOpen = ref(false)
const router = useRouter()

router.afterEach(() => { navOpen.value = false })
</script>

<style scoped>
.layout {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.nav {
  position: sticky;
  top: 0;
  z-index: 100;
  background-color: var(--fpv-surface);
  border-bottom: 1px solid var(--fpv-border);
}

.nav-inner {
  display: flex;
  align-items: center;
  gap: var(--fpv-space-md);
  padding: var(--fpv-space-sm) var(--fpv-space-lg);
  max-width: 1280px;
  margin: 0 auto;
  width: 100%;
  flex-wrap: wrap;
}

.brand {
  font-family: var(--fpv-font-sans);
  font-size: 16px;
  font-weight: 600;
  color: var(--fpv-primary);
  white-space: nowrap;
  flex-shrink: 0;
}

.brand:hover {
  color: var(--fpv-text);
}

.nav-links {
  display: flex;
  flex-wrap: wrap;
  gap: var(--fpv-space-xs) var(--fpv-space-md);
  flex: 1;
}

.nav-links a {
  font-size: var(--fpv-font-body);
  color: var(--fpv-text-muted);
  transition: color 0.15s ease;
  white-space: nowrap;
}

.nav-links a:hover,
.nav-links a.router-link-active {
  color: var(--fpv-text);
}

.nav-links a.router-link-exact-active {
  color: var(--fpv-primary);
}

.nav-hamburger {
  display: none;
}

.main {
  flex: 1;
  padding: var(--fpv-space-lg);
  max-width: 1280px;
  margin: 0 auto;
  width: 100%;
}

@media (max-width: 768px) {
  .nav-inner {
    padding: var(--fpv-space-sm) var(--fpv-space-md);
    flex-wrap: nowrap;
  }

  .nav-hamburger {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    padding: 8px;
    background: none;
    border: none;
    cursor: pointer;
    margin-left: auto;
    min-height: 44px;
    min-width: 44px;
    align-items: center;
  }

  .hamburger-bar {
    display: block;
    width: 18px;
    height: 2px;
    background: var(--fpv-text-muted);
    border-radius: 1px;
    transition: background 0.15s, transform 0.2s, opacity 0.2s;
  }

  .nav-hamburger:hover .hamburger-bar {
    background: var(--fpv-text);
  }

  /* X animation when open */
  .hamburger-bar.open:nth-child(1) {
    transform: translateY(6px) rotate(45deg);
  }
  .hamburger-bar.open:nth-child(2) {
    opacity: 0;
  }
  .hamburger-bar.open:nth-child(3) {
    transform: translateY(-6px) rotate(-45deg);
  }

  .nav-links {
    display: none;
    width: 100%;
    flex-direction: column;
    gap: 0;
    order: 10;
    background: var(--fpv-surface);
    border-top: 1px solid var(--fpv-border);
    padding: var(--fpv-space-sm) 0;
  }

  .nav-links.open {
    display: flex;
  }

  .nav-links a {
    padding: var(--fpv-space-sm) var(--fpv-space-md);
    min-height: 44px;
    display: flex;
    align-items: center;
    border-left: 2px solid transparent;
  }

  .nav-links a.router-link-exact-active {
    border-left-color: var(--fpv-primary);
    background: var(--fpv-surface-2);
  }

  .main {
    padding: var(--fpv-space-md);
  }
}

@media (max-width: 600px) {
  .nav-inner {
    padding: var(--fpv-space-sm) var(--fpv-space-md);
  }

  .main {
    padding: var(--fpv-space-md);
  }
}
</style>
