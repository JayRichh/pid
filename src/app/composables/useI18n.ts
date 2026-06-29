import { ref, readonly, type Ref } from 'vue'
import { fpvI18n, type LocaleId, SUPPORTED_LOCALES, LOCALE_LABELS } from '@core/shared/i18n'

// Module-level ref shared across all composable instances.
// Same singleton pattern as useTheme's module-level `theme` ref.
const locale = ref<LocaleId>(
  (localStorage.getItem('fpv-locale') as LocaleId | null) ?? 'en'
)

// Subscribe once at module level
fpvI18n.subscribe(() => {
  locale.value = fpvI18n.locale
})

export function useI18n() {
  function t(key: string, params?: Record<string, string | number>): string {
    // Read locale.value to establish Vue reactive dependency
    locale.value // eslint-disable-line @typescript-eslint/no-unused-expressions
    return fpvI18n.t(key, params)
  }

  async function setLocale(id: LocaleId): Promise<void> {
    await fpvI18n.setLocale(id)
  }

  return {
    t,
    locale: readonly(locale) as Readonly<Ref<LocaleId>>,
    setLocale,
    SUPPORTED_LOCALES,
    LOCALE_LABELS,
  }
}
