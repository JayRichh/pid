import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock localStorage before importing the module so setLocale() can call it
const localStorageMock = {
  _store: {} as Record<string, string>,
  getItem(key: string) { return this._store[key] ?? null },
  setItem(key: string, val: string) { this._store[key] = val },
  removeItem(key: string) { delete this._store[key] },
  clear() { this._store = {} },
}
vi.stubGlobal('localStorage', localStorageMock)

import { fpvI18n } from '../../../src/core/shared/i18n'

const EN_MESSAGES = {
  common: {
    start: 'Start',
    stop: 'Stop',
  },
  pid: {
    title: 'PID Simulator',
    section_gains: 'Gains',
    hud_time_label: '{seconds}s',
  },
  diff: {
    summary_changed: 'Showing {n} changed {n, plural, one{setting} other{settings}} out of {total} total',
    summary_steps: '{n} step {n, plural, one{event} other{events}}',
  },
  greet: 'Hello {name}',
}

beforeEach(() => {
  localStorageMock.clear()
  // Re-preload 'en' so the singleton has a known state
  fpvI18n.preload('en', EN_MESSAGES as Record<string, unknown>)
})

describe('preload + t() dot-path resolution', () => {
  it('resolves a top-level key', () => {
    expect(fpvI18n.t('greet', { name: 'World' })).toBe('Hello World')
  })

  it('resolves a nested dot-path key (one level)', () => {
    expect(fpvI18n.t('pid.title')).toBe('PID Simulator')
  })

  it('resolves a nested dot-path key (two levels down)', () => {
    expect(fpvI18n.t('common.start')).toBe('Start')
  })

  it('resolves another nested key from pid namespace', () => {
    expect(fpvI18n.t('pid.section_gains')).toBe('Gains')
  })
})

describe('t() simple interpolation', () => {
  it('replaces {name} placeholder', () => {
    fpvI18n.preload('en', { greet: 'Hello {name}' })
    expect(fpvI18n.t('greet', { name: 'FPV' })).toBe('Hello FPV')
  })

  it('replaces {seconds} placeholder', () => {
    expect(fpvI18n.t('pid.hud_time_label', { seconds: '3.5' })).toBe('3.5s')
  })

  it('leaves unknown placeholders as-is', () => {
    fpvI18n.preload('en', { msg: 'Value: {unknown}' })
    expect(fpvI18n.t('msg')).toBe('Value: {unknown}')
  })
})

describe('t() plural interpolation', () => {
  it('uses one form when n === 1', () => {
    const result = fpvI18n.t('diff.summary_steps', { n: 1 })
    expect(result).toBe('1 step event')
  })

  it('uses other form when n > 1', () => {
    const result = fpvI18n.t('diff.summary_steps', { n: 3 })
    expect(result).toBe('3 step events')
  })

  it('uses other form when n === 0', () => {
    const result = fpvI18n.t('diff.summary_steps', { n: 0 })
    expect(result).toBe('0 step events')
  })

  it('handles plural inside longer string with multiple params', () => {
    const result = fpvI18n.t('diff.summary_changed', { n: 1, total: 42 })
    expect(result).toBe('Showing 1 changed setting out of 42 total')
  })

  it('handles plural (other) inside longer string with multiple params', () => {
    const result = fpvI18n.t('diff.summary_changed', { n: 5, total: 42 })
    expect(result).toBe('Showing 5 changed settings out of 42 total')
  })
})

describe('t() fallback behaviour', () => {
  it('returns the key itself when key is missing from en', () => {
    expect(fpvI18n.t('nonexistent.key')).toBe('nonexistent.key')
  })

  it('returns the key itself when the namespace exists but the leaf does not', () => {
    expect(fpvI18n.t('pid.nonexistent')).toBe('pid.nonexistent')
  })

  it('returns a value without params intact', () => {
    expect(fpvI18n.t('common.stop')).toBe('Stop')
  })
})

describe('subscribe()', () => {
  it('fires callback when preload is called for the current locale', () => {
    let count = 0
    const unsub = fpvI18n.subscribe(() => { count++ })
    // preload('en', ...) notifies because 'en' is the current locale
    fpvI18n.preload('en', EN_MESSAGES as Record<string, unknown>)
    expect(count).toBe(1)
    unsub()
  })

  it('fires callback on setLocale (target already preloaded)', async () => {
    // Preload 'en' so setLocale('en') skips dynamic import
    fpvI18n.preload('en', EN_MESSAGES as Record<string, unknown>)
    let count = 0
    const unsub = fpvI18n.subscribe(() => { count++ })
    await fpvI18n.setLocale('en')
    expect(count).toBe(1)
    unsub()
  })

  it('does not fire after unsubscribe', async () => {
    fpvI18n.preload('en', EN_MESSAGES as Record<string, unknown>)
    let count = 0
    const unsub = fpvI18n.subscribe(() => { count++ })
    unsub()
    await fpvI18n.setLocale('en')
    expect(count).toBe(0)
  })

  it('subscribe returns a working unsubscribe function', () => {
    let count = 0
    const unsub = fpvI18n.subscribe(() => { count++ })
    // Fire once to confirm subscription works
    fpvI18n.preload('en', EN_MESSAGES as Record<string, unknown>)
    expect(count).toBe(1)
    // Unsubscribe and confirm no further fires
    unsub()
    fpvI18n.preload('en', EN_MESSAGES as Record<string, unknown>)
    expect(count).toBe(1)
  })

  it('multiple subscribers all fire independently', () => {
    const fired: string[] = []
    const unsub1 = fpvI18n.subscribe(() => { fired.push('a') })
    const unsub2 = fpvI18n.subscribe(() => { fired.push('b') })
    fpvI18n.preload('en', EN_MESSAGES as Record<string, unknown>)
    expect(fired).toContain('a')
    expect(fired).toContain('b')
    unsub1()
    unsub2()
  })
})
