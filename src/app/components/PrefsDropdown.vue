<template>
  <div class="prefs-wrap" ref="wrapRef">
    <button
      class="prefs-trigger"
      @click="toggle"
      :aria-label="t('prefs.prefs_label')"
      :title="t('prefs.prefs_label')"
    >
      &#x2699;
    </button>
    <Teleport to="body">
      <Transition name="prefs-overlay">
        <div v-if="open" class="prefs-overlay" @click="close"></div>
      </Transition>
      <Transition name="prefs-panel">
        <div
          v-if="open"
          class="prefs-panel"
          :class="{ 'prefs-panel--mobile': isMobile }"
          ref="panelRef"
        >
          <div class="prefs-section">
            <div class="prefs-section-label">{{ t('prefs.theme') }}</div>
            <div class="prefs-pills">
              <button
                v-for="th in themes"
                :key="th"
                :class="['prefs-pill', { active: theme === th }]"
                :title="t(`prefs.theme_${th}`)"
                :aria-label="t(`prefs.theme_${th}`)"
                @click="setTheme(th)"
              >
                {{ themeGlyph(th) }}
              </button>
            </div>
          </div>
          <div class="prefs-section">
            <div class="prefs-section-label">{{ t('prefs.language') }}</div>
            <div class="prefs-lang-list">
              <button
                v-for="loc in SUPPORTED_LOCALES"
                :key="loc"
                :class="['prefs-lang', { active: locale === loc }]"
                @click="selectLocale(loc)"
              >
                {{ LOCALE_LABELS[loc] }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useTheme, type Theme } from '../composables/useTheme'
import { useI18n } from '../composables/useI18n'
import type { LocaleId } from '@core/shared/i18n'

const { theme, setTheme } = useTheme()
const { t, locale, setLocale, SUPPORTED_LOCALES, LOCALE_LABELS } = useI18n()

const themes: Theme[] = ['dark', 'light', 'auto']
const open = ref(false)
const isMobile = ref(false)
const wrapRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)

function themeGlyph(th: Theme): string {
  if (th === 'dark') return '☽'
  if (th === 'light') return '☀'
  return '◐'
}

function toggle() { open.value = !open.value }
function close() { open.value = false }

async function selectLocale(loc: LocaleId) {
  await setLocale(loc)
  close()
}

function onClickOutside(e: MouseEvent) {
  if (!open.value) return
  if (wrapRef.value?.contains(e.target as Node)) return
  if (panelRef.value?.contains(e.target as Node)) return
  close()
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) close()
}

function checkMobile() {
  isMobile.value = window.innerWidth <= 600
}

onMounted(() => {
  document.addEventListener('click', onClickOutside)
  document.addEventListener('keydown', onKeyDown)
  window.addEventListener('resize', checkMobile)
  checkMobile()
})

onUnmounted(() => {
  document.removeEventListener('click', onClickOutside)
  document.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('resize', checkMobile)
})
</script>

<style scoped>
.prefs-wrap {
  position: relative;
  flex-shrink: 0;
}

.prefs-trigger {
  margin-left: auto;
  padding: var(--fpv-space-xs) var(--fpv-space-sm);
  background: var(--fpv-surface-2);
  border: 1px solid var(--fpv-border);
  border-radius: var(--fpv-radius-sm);
  color: var(--fpv-text);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
  min-height: 32px;
  min-width: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.prefs-trigger:hover {
  border-color: var(--fpv-primary);
  background-color: var(--fpv-border);
}

/* Panel (Teleported to body) */
.prefs-panel {
  position: fixed;
  top: auto;
  right: var(--fpv-space-md);
  width: 240px;
  background: var(--fpv-surface-2);
  border: 1px solid var(--fpv-border);
  border-radius: var(--fpv-radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 9999;
  padding: var(--fpv-space-md);
  display: flex;
  flex-direction: column;
  gap: var(--fpv-space-md);
}

/* Position below the nav bar (~52px) */
.prefs-panel:not(.prefs-panel--mobile) {
  top: 52px;
}

.prefs-panel--mobile {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  width: 100%;
  border-radius: var(--fpv-radius-md) var(--fpv-radius-md) 0 0;
  top: auto;
}

.prefs-section {
  display: flex;
  flex-direction: column;
  gap: var(--fpv-space-sm);
}

.prefs-section-label {
  font-size: var(--fpv-font-label);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--fpv-text-muted);
}

.prefs-pills {
  display: flex;
  gap: var(--fpv-space-xs);
}

.prefs-pill {
  flex: 1;
  padding: var(--fpv-space-xs) var(--fpv-space-sm);
  background: var(--fpv-surface);
  border: 1px solid var(--fpv-border);
  border-radius: var(--fpv-radius-sm);
  color: var(--fpv-text-muted);
  font-size: 16px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.prefs-pill:hover {
  border-color: var(--fpv-primary);
  color: var(--fpv-text);
}

.prefs-pill.active {
  background: var(--fpv-primary);
  border-color: var(--fpv-primary);
  color: #000;
}

.prefs-lang-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.prefs-lang {
  width: 100%;
  text-align: left;
  padding: var(--fpv-space-xs) var(--fpv-space-sm);
  background: transparent;
  border: 1px solid transparent;
  border-left: 2px solid transparent;
  border-radius: var(--fpv-radius-sm);
  color: var(--fpv-text-muted);
  font-size: var(--fpv-font-body);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  min-height: 36px;
}

.prefs-lang:hover {
  background: var(--fpv-surface);
  color: var(--fpv-text);
}

.prefs-lang.active {
  border-left-color: var(--fpv-primary);
  background: var(--fpv-surface);
  color: var(--fpv-text);
}

/* Overlay: only visible on mobile */
.prefs-overlay {
  position: fixed;
  inset: 0;
  z-index: 9998;
  background: transparent;
}

.prefs-panel--mobile + .prefs-overlay,
.prefs-overlay {
  background: rgba(0, 0, 0, 0.4);
}

/* But on desktop, overlay is invisible (just click catcher) */
@media (min-width: 601px) {
  .prefs-overlay {
    background: transparent;
  }
}

/* Transitions */
.prefs-overlay-enter-active,
.prefs-overlay-leave-active {
  transition: opacity 0.15s ease;
}
.prefs-overlay-enter-from,
.prefs-overlay-leave-to {
  opacity: 0;
}

.prefs-panel-enter-active,
.prefs-panel-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.prefs-panel-enter-from,
.prefs-panel-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.prefs-panel--mobile.prefs-panel-enter-from,
.prefs-panel--mobile.prefs-panel-leave-to {
  transform: translateY(100%);
}
</style>
