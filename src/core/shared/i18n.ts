// src/core/shared/i18n.ts — Pure TS, zero DOM, zero framework

export type LocaleId = 'en' | 'zh' | 'de' | 'ru' | 'pt-BR' | 'ja' | 'ko'

export const SUPPORTED_LOCALES: readonly LocaleId[] = ['en', 'zh', 'de', 'ru', 'pt-BR', 'ja', 'ko']

export const LOCALE_LABELS: Record<LocaleId, string> = {
  en: 'English',
  zh: '中文',
  de: 'Deutsch',
  ru: 'Русский',
  'pt-BR': 'Português',
  ja: '日本語',
  ko: '한국어',
}

type Callback = () => void

class FpvI18n {
  private _locale: LocaleId = 'en'
  private _messages: Partial<Record<LocaleId, Record<string, unknown>>> = {}
  private _subs = new Set<Callback>()

  get locale(): LocaleId { return this._locale }

  /**
   * Synchronously load a locale's messages (used for en at startup).
   */
  preload(id: LocaleId, messages: Record<string, unknown>): void {
    this._messages[id] = messages
    if (id === this._locale) this._notify()
  }

  /**
   * Switch active locale. Lazy-loads the JSON if not already loaded.
   * Vite splits each locale into a separate chunk automatically.
   */
  async setLocale(id: LocaleId): Promise<void> {
    if (!this._messages[id]) {
      const mod = await import(`../../locales/${id}.json`)
      this._messages[id] = mod.default
    }
    this._locale = id
    localStorage.setItem('fpv-locale', id)
    this._notify()
  }

  /**
   * Look up a translation key with optional interpolation.
   *
   * Supports:
   * - Simple interpolation: "Hello {name}" with params {name: "World"}
   * - Minimal plurals: "{n, plural, one{# item} other{# items}}" with params {n: 5}
   *
   * Falls back to en if key is missing in current locale.
   * Falls back to the key string itself if missing in en too.
   */
  t(key: string, params?: Record<string, string | number>): string {
    const map = this._messages[this._locale] ?? this._messages['en']
    const enMap = this._messages['en']

    // Walk dot-separated path
    let value = this._resolve(map, key)
    if (typeof value !== 'string' && enMap) {
      value = this._resolve(enMap, key) // fallback to en
    }
    if (typeof value !== 'string') return key // fallback to key itself

    if (!params) return value

    // Process minimal ICU plurals: {n, plural, one{...} other{...}}
    value = value.replace(
      /\{(\w+),\s*plural,\s*one\{([^}]*)\}\s*other\{([^}]*)\}\}/g,
      (_, paramName, oneForm, otherForm) => {
        const n = Number(params[paramName] ?? 0)
        const form = n === 1 ? oneForm : otherForm
        return form.replace(/#/g, String(n))
      }
    )

    // Simple interpolation: {paramName}
    return value.replace(/\{(\w+)\}/g, (_, p) => String(params[p] ?? `{${p}}`))
  }

  subscribe(cb: Callback): () => void {
    this._subs.add(cb)
    return () => this._subs.delete(cb)
  }

  private _resolve(obj: Record<string, unknown> | undefined, key: string): unknown {
    if (!obj) return undefined
    return key.split('.').reduce<unknown>(
      (o, k) => (typeof o === 'object' && o !== null ? (o as Record<string, unknown>)[k] : undefined),
      obj
    )
  }

  private _notify(): void {
    this._subs.forEach(cb => cb())
  }
}

export const fpvI18n = new FpvI18n()
