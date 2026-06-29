# FPV Tools Refactor Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add i18n (7 locales), continuous PID simulation with HUD controls, CSS 3D quad preview, preferences dropdown, and mobile/responsive fixes to the existing FPV Tools codebase.

**Architecture (unchanged):** Vue 3 Composition API shell for routing/layout. Lit 3 web components for all UI primitives and tool components. Pure TypeScript core for physics/math (zero DOM, zero framework). CSS custom properties for all theming. No new npm dependencies.

**Tech Stack (unchanged):** Vue 3.5, Lit 3, TypeScript 5.8, Vite 6, Vitest, vue-router 4, Canvas 2D API

## Global Constraints

- No new npm dependencies (no vue-i18n, no three.js, no CSS framework)
- All core modules remain pure functions with zero DOM access
- Dark theme default; light via `[data-theme="light"]`
- Internal units: SI (rad/s, kg*m^2, N*m). deg/s only at boundaries
- `Float32Array` for all signal buffers
- Seeded PRNG for all randomness
- Technical abbreviations (Hz, kHz, MHz, dBm, mW, V, A, KV, RPM, etc.) are never translated
- FPV brand/product names (Betaflight, ELRS, Molicel, etc.) are never translated
- Interpolation placeholders `{param}` must be preserved in all locale files

## Cross-Phase Decisions (locked)

These decisions resolve conflicts between exploration reports. Subagents must follow them exactly.

1. **i18n key scheme:** Flat snake_case keys with dot-namespace grouping. A `common.*` namespace holds labels reused across multiple components. Example: `pid.label_p_gain`, `home.pid_name`, `common.results`. Report 6's catalog is the completeness baseline.

2. **Locale list (6 non-English):** `zh` (Simplified Chinese), `de` (German), `ru` (Russian), `pt-BR` (Brazilian Portuguese), `ja` (Japanese), `ko` (Korean). Do NOT add `fr` or `es` in this pass.

3. **One locale store:** The Phase 1 singleton (`fpvI18n` in `src/core/shared/i18n.ts`) is the single source of truth for locale state. It reads/writes `localStorage` key `fpv-locale`. The Vue composable `useI18n()` wraps the singleton. There is no separate `useLocale` composable. The Phase 5 PrefsDropdown calls `useI18n().setLocale()`.

4. **Plural support:** The singleton's `t()` function handles minimal ICU-style plurals: `{n, plural, one{X} other{Y}}`. This is needed for ~3 strings (`changed setting(s)`, `step event(s)`). Full ICU MessageFormat is not required.

5. **Metrics tab in continuous mode:** While `_running === true`, the Metrics tab shows a "running..." placeholder. When the user clicks Stop, metrics are computed from the full accumulated sample buffer (not just the rolling window). A separate `_fullSamples` array captures all samples for metrics computation.

6. **Quad preview reads live data:** Phase 4's 3D quad reads the latest sample from the rolling buffer each rAF tick. The 3D tilt angle is computed inside the component as a visual proxy: `rollDeg = clamp(gyroDegS / maxDegS * 45, -60, 60)`. No physical integration is required.

7. **Extract stepSim helper:** `simulate.ts` extracts the inner loop body into a shared `stepSim()` function that both `simulate()` and `SimRunner.tick()` call. This keeps one-shot (still needed for metrics on stop) and continuous in sync.

8. **Phase 1 en.json includes ALL strings:** The English locale file includes keys for strings added by Phases 3-5 (HUD toolbar: Start/Stop/Reset/Restart, Advanced toggle, 3D preview labels). Later phases consume keys via `t()` instead of hardcoding strings.

---

## Phase 1: i18n Foundation

**Dependencies:** None (must complete before all other phases)
**Estimated complexity:** Medium (4 new files, 2 modified files, ~600 lines)

### Task 1.1: Core i18n Singleton

**Files:**
- Create: `src/core/shared/i18n.ts`

**Interfaces:**
```ts
// src/core/shared/i18n.ts — Pure TS, zero DOM, zero framework

export type LocaleId = 'en' | 'zh' | 'de' | 'ru' | 'pt-BR' | 'ja' | 'ko'

export const SUPPORTED_LOCALES: readonly LocaleId[] = ['en', 'zh', 'de', 'ru', 'pt-BR', 'ja', 'ko']

export const LOCALE_LABELS: Record<LocaleId, string> = {
  en: 'English',
  zh: '中文',       // Chinese characters for "Chinese"
  de: 'Deutsch',
  ru: 'Русский',  // Cyrillic for "Russian"
  'pt-BR': 'Português',
  ja: '日本語',  // Japanese characters for "Japanese"
  ko: '한국어',  // Korean characters for "Korean"
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
```

- [ ] **Step 1:** Create `src/core/shared/i18n.ts` with the exact class above. The module must have zero imports from DOM APIs or frameworks. `localStorage` is the only browser API used, and only inside `setLocale()`.

- [ ] **Step 2:** Write a vitest test `src/core/shared/__tests__/i18n.test.ts` that verifies:
  - `preload()` sets messages and `t()` resolves dot-path keys
  - `t()` with params does `{name}` interpolation
  - `t()` with plural params processes `{n, plural, one{...} other{...}}`
  - `t()` falls back to key string when key is missing
  - `subscribe()` fires callback on `setLocale()`
  - `subscribe()` returns an unsubscribe function that works

---

### Task 1.2: Lit ReactiveController for i18n

**Files:**
- Create: `src/components/primitives/I18nController.ts`

**Interfaces:**
```ts
// src/components/primitives/I18nController.ts
import type { ReactiveControllerHost } from 'lit'
import { fpvI18n } from '@core/shared/i18n.js'

export class I18nController {
  private _host: ReactiveControllerHost
  private _unsub?: () => void

  constructor(host: ReactiveControllerHost) {
    this._host = host
    host.addController(this)
  }

  t(key: string, params?: Record<string, string | number>): string {
    return fpvI18n.t(key, params)
  }

  hostConnected(): void {
    this._unsub = fpvI18n.subscribe(() => this._host.requestUpdate())
  }

  hostDisconnected(): void {
    this._unsub?.()
  }
}
```

Usage in any Lit component:
```ts
import { I18nController } from '../primitives/I18nController.js'

// inside class body:
private _i18n = new I18nController(this)

// in render():
html`<span>${this._i18n.t('pid.section_gains')}</span>`
```

- [ ] **Step 1:** Create `src/components/primitives/I18nController.ts` with the exact code above.

- [ ] **Step 2:** Export `I18nController` from `src/components/primitives/index.ts` (add to the existing barrel export).

---

### Task 1.3: Vue Composable for i18n

**Files:**
- Create: `src/app/composables/useI18n.ts`

**Interfaces:**
```ts
// src/app/composables/useI18n.ts
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
```

- [ ] **Step 1:** Create `src/app/composables/useI18n.ts` with the exact code above.

---

### Task 1.4: English Locale File (Complete String Catalog)

**Files:**
- Create: `src/locales/en.json`

This is the complete source of truth for all translatable strings in the application. It includes strings for features being added in later phases (HUD toolbar, advanced toggle, 3D preview).

- [ ] **Step 1:** Create `src/locales/en.json` with the following complete structure:

```json
{
  "common": {
    "results": "Results",
    "setup": "Setup",
    "inputs": "Inputs",
    "voltage": "Voltage",
    "weight": "Weight",
    "speed": "Speed",
    "frequency": "Frequency",
    "auw": "AUW",
    "motor": "Motor",
    "range": "Range",
    "status": "Status",
    "custom": "Custom",
    "enable": "Enable",
    "na": "N/A",
    "start": "Start",
    "stop": "Stop",
    "reset": "Reset",
    "restart": "Restart",
    "advanced": "Advanced",
    "running": "Running...",
    "status_fast": "Fast",
    "status_ok": "OK",
    "status_slow": "Slow",
    "status_good": "Good",
    "status_moderate": "Moderate",
    "status_high": "High",
    "status_fair": "Fair",
    "status_poor": "Poor",
    "status_stable": "Stable",
    "status_oscillating": "Oscillating",
    "status_smooth": "Smooth",
    "status_normal": "Normal",
    "status_active": "Active"
  },
  "nav": {
    "brand": "FPV Tools",
    "pid": "PID",
    "power": "Power",
    "motors": "Motors",
    "rf": "RF",
    "convert": "Convert",
    "blackbox": "Blackbox",
    "tilt": "Tilt",
    "diff": "Diff",
    "prefs_label": "Preferences"
  },
  "prefs": {
    "theme": "Theme",
    "theme_dark": "Dark",
    "theme_light": "Light",
    "theme_auto": "Auto",
    "language": "Language"
  },
  "home": {
    "tagline": "Browser-native calculators and simulators for FPV pilots",
    "pid_name": "PID Tuner",
    "pid_desc": "Simulate PID controller response and tune gains with live step-response preview.",
    "power_name": "Power Calculator",
    "power_desc": "Estimate battery capacity, current draw, and flight time for any build.",
    "motors_name": "Motor Calculator",
    "motors_desc": "Compare KV ratings, thrust, and efficiency across motor and prop combinations.",
    "rf_name": "RF Link Budget",
    "rf_desc": "Calculate range, link margin, and RSSI for your video transmitter setup.",
    "convert_name": "Unit Converter",
    "convert_desc": "Convert between imperial and metric units commonly used in FPV builds.",
    "blackbox_name": "Blackbox Viewer",
    "blackbox_desc": "Analyze Betaflight blackbox logs to diagnose oscillations and tune PIDs.",
    "tilt_name": "Tilt Calculator",
    "tilt_desc": "Compute camera tilt angle, field of view, and horizon offset at speed.",
    "diff_name": "Diff Viewer",
    "diff_desc": "Compare Betaflight diff dumps side-by-side to track configuration changes."
  },
  "seo": {
    "home_title": "FPV Tools — Browser-Native Calculators for FPV Pilots",
    "home_desc": "Free, open-source FPV tools: PID simulator, pack calculator, motor sizing, link budget, VTX checker, and more. No install, no ads.",
    "pid_title": "PID Simulator — FPV Tools",
    "pid_desc": "Interactive Betaflight-style PID rate-loop simulator. Tune P/I/D/FF gains with live scope, quad preview, and performance metrics.",
    "power_title": "Pack Calculator — FPV Tools",
    "power_desc": "Li-ion and LiPo pack sizing calculator. Flight time, voltage sag, C-rate analysis for Molicel P42A, P45B, Samsung 40T, and more.",
    "motors_title": "Motor Sizing — FPV Tools",
    "motors_desc": "Motor and prop sizing calculator. Thrust-to-weight ratio, efficiency, and current draw estimation for FPV builds.",
    "rf_title": "RF Tools — FPV Tools",
    "rf_desc": "ELRS link budget calculator and VTX power compliance checker. Check legal limits for USA, EU, UK, Australia, NZ, Canada, Japan.",
    "convert_title": "Unit Converters — FPV Tools",
    "convert_desc": "FPV-specific unit conversions: dBm/mW, mAh/Wh, KV/RPM, AWG ampacity, and more.",
    "tilt_title": "Camera Tilt Calculator — FPV Tools",
    "tilt_desc": "Camera tilt angle vs flight speed calculator. Visualize horizon position and ground coverage.",
    "diff_title": "Tune Diff — FPV Tools",
    "diff_desc": "Compare two Betaflight CLI dumps side by side. See changed PID, filter, and rate settings at a glance.",
    "blackbox_title": "Blackbox Analyzer — FPV Tools",
    "blackbox_desc": "Analyze Betaflight blackbox logs. Gyro FFT, step response, and system identification."
  },
  "pid": {
    "title": "PID Simulator",
    "subtitle": "Interactive Betaflight-style rate-loop simulator. Adjust gains and see the response in real-time.",
    "section_gains": "Gains",
    "section_filters": "Filters",
    "section_loop_rate": "Loop Rate",
    "section_plant": "Plant",
    "section_setpoint": "Setpoint",
    "section_options": "Options",
    "section_presets": "Presets",
    "section_disturbance": "Disturbance",
    "label_p_gain": "P Gain",
    "label_i_gain": "I Gain",
    "label_d_gain": "D Gain",
    "label_ff_gain": "FF Gain",
    "label_gyro_lp": "Gyro LP",
    "label_dterm_lp": "D-Term LP",
    "label_notch_filter": "Notch Filter",
    "label_center": "Center",
    "label_q": "Q",
    "label_rate": "Rate",
    "label_preset": "Preset",
    "label_inertia": "Inertia",
    "label_motor_tau": "Motor τ",
    "label_drag": "Drag",
    "label_max_torque": "Max Torque",
    "label_profile": "Profile",
    "label_amplitude": "Amplitude",
    "label_start": "Start",
    "label_duration": "Duration",
    "label_iterm_relax": "I-Term Relax",
    "label_anti_windup": "Anti-Windup",
    "label_gains_select": "Gains",
    "label_scenario": "Scenario",
    "label_torque": "Torque",
    "label_time": "Time",
    "label_kind": "Kind",
    "rate_8khz": "8 kHz",
    "rate_4khz": "4 kHz",
    "rate_2khz": "2 kHz",
    "profile_step": "Step",
    "profile_ramp": "Ramp",
    "profile_sine": "Sine",
    "dist_impulse": "Impulse",
    "dist_step": "Step",
    "preset_gains_placeholder": "— Apply Gain Preset —",
    "preset_scenario_placeholder": "— Apply Scenario —",
    "plant_custom": "Custom",
    "scenario_over_tuned": "Over-tuned",
    "scenario_propwash": "Propwash Recovery",
    "scenario_filter_tradeoff": "Filter Tradeoff",
    "tab_response": "Response",
    "tab_terms": "Terms",
    "tab_metrics": "Metrics",
    "series_setpoint": "Setpoint",
    "series_gyro": "Gyro",
    "series_error": "Error",
    "series_pterm": "P-term",
    "series_iterm": "I-term",
    "series_dterm": "D-term",
    "series_motor": "Motor",
    "metric_rise_time": "Rise Time",
    "metric_overshoot": "Overshoot",
    "metric_settling_time": "Settling Time",
    "metric_ss_error": "SS Error",
    "metric_oscillation": "Oscillation",
    "metric_motor_rms": "Motor RMS",
    "loading": "Run simulation first",
    "hud_time_label": "{seconds}s"
  },
  "power": {
    "title": "Pack Calculator",
    "subtitle": "Li-ion and LiPo pack sizing — flight time, voltage sag, C-rate, and range.",
    "section_cell": "Cell",
    "section_pack_config": "Pack Config",
    "section_flight_model": "Flight Model",
    "section_pack": "Pack",
    "section_flight": "Flight",
    "section_verdicts": "Verdicts",
    "label_model": "Model",
    "label_series": "Series",
    "label_parallel": "Parallel",
    "label_wiring": "Wiring",
    "label_hover_eff": "Hover Eff",
    "label_cruise_fac": "Cruise Fac",
    "label_usable_cap": "Usable Cap",
    "label_capacity": "Capacity",
    "label_max_cont": "Max Cont",
    "label_pack_ir": "Pack IR",
    "label_hover_i": "Hover I",
    "label_cruise_i": "Cruise I",
    "label_hover_time": "Hover Time",
    "label_cruise_time": "Cruise Time",
    "label_voltage_sag": "Voltage Sag",
    "verdict_crate_ok": "C-rate OK ×{margin}",
    "verdict_crate_over": "C-rate OVER",
    "verdict_sag_warning": "Sag warning {v} V",
    "verdict_sag_ok": "Sag OK",
    "empty": "Configure inputs above."
  },
  "motors": {
    "title": "Motor / Prop Sizing",
    "subtitle": "Estimate thrust, hover current, and efficiency for your FPV build. Select a motor and prop from the library or enter custom values.",
    "section_propeller": "Propeller",
    "label_prop": "Prop",
    "label_diameter": "Diameter",
    "label_pitch": "Pitch",
    "label_cell_count": "Cell Count",
    "label_motors": "Motors",
    "label_kv": "KV",
    "label_max_i": "Max I",
    "motor_custom": "Custom...",
    "motors_3": "3 motors (tricopter)",
    "motors_4": "4 motors (quad)",
    "motors_6": "6 motors (hex)",
    "motors_8": "8 motors (octo)",
    "result_tw": "Thrust / Weight",
    "result_nominal_v": "Nominal Voltage",
    "result_max_rpm": "Max RPM",
    "result_thrust_per_motor": "Thrust / Motor",
    "result_total_thrust": "Total Thrust",
    "result_hover_throttle": "Hover Throttle",
    "result_hover_i_per_motor": "Hover I / Motor",
    "result_total_hover_i": "Total Hover I",
    "result_efficiency": "Efficiency",
    "result_rec_props": "Rec. Props",
    "disclaimer": "Thrust is estimated — verify against manufacturer dyno data before building."
  },
  "rf": {
    "title": "RF Tools",
    "subtitle": "ELRS link budget calculator and VTX power compliance checker.",
    "section_transmitter": "Transmitter",
    "section_receiver": "Receiver",
    "section_link_params": "Link Parameters",
    "section_compliance": "Compliance",
    "label_tx_power": "TX Power",
    "label_tx_gain": "TX Gain",
    "label_rx_gain": "RX Gain",
    "label_packet_rate": "Packet Rate",
    "label_country": "Country",
    "label_band": "Band",
    "label_power": "Power",
    "label_sensitivity": "Sensitivity",
    "label_path_loss": "Path Loss @ 1km",
    "label_link_margin": "Link Margin",
    "label_theoretical_range": "Theoretical Range",
    "label_limit": "Limit",
    "label_your_power": "Your Power",
    "freq_915": "915 MHz (ELRS Long Range)",
    "freq_2400": "2400 MHz (2.4 GHz ELRS)",
    "freq_5800": "5800 MHz (5.8 GHz Video)",
    "band_5g8": "5.8 GHz (FPV Video)",
    "band_2g4": "2.4 GHz (RC Link)",
    "band_915": "915 MHz (Long Range)",
    "verdict_compliant": "Compliant",
    "verdict_non_compliant": "Non-Compliant"
  },
  "convert": {
    "title": "Unit Converters",
    "subtitle": "FPV-specific unit conversions — power, frequency, electrical, and angles.",
    "tab_power": "Power",
    "tab_frequency": "Frequency",
    "tab_electrical": "Electrical",
    "tab_angle": "Angle",
    "section_dbm_mw": "dBm ⇄ mW",
    "section_mah_wh": "mAh ⇄ Wh",
    "section_kv_rpm": "KV → RPM",
    "section_rpm_hz_rads": "RPM ⇄ Hz ⇄ rad/s",
    "section_awg_ampacity": "AWG → Ampacity",
    "section_voltage_drop": "Voltage Drop",
    "section_deg_rad": "Degrees ⇄ Radians",
    "label_current": "Current",
    "label_length": "Length",
    "label_ampacity": "Ampacity",
    "label_v_drop": "V Drop",
    "label_degrees": "Degrees",
    "label_radians": "Radians"
  },
  "tilt": {
    "title": "Camera Tilt Calculator",
    "subtitle": "Visualize camera FOV, horizon position, and ground coverage at a given tilt angle and speed.",
    "section_computed": "Computed",
    "section_viz": "Visualization (side view)",
    "label_tilt_angle": "Tilt Angle",
    "label_horizon_pos": "Horizon pos",
    "label_ground_dist": "Ground dist",
    "label_aoa": "AoA (level)",
    "canvas_ground": "GND (30m AGL)",
    "canvas_horizon": "horizon ({pct}% from top)",
    "canvas_tilt": "{tilt}° tilt"
  },
  "diff": {
    "title": "Tune Diff",
    "subtitle": "Paste two Betaflight \"diff all\" outputs to compare PIDs, filters, rates, and features side-by-side.",
    "label_config_a": "Config A",
    "label_config_b": "Config B",
    "placeholder_a": "Paste first 'diff all' output here...",
    "placeholder_b": "Paste second 'diff all' output here...",
    "table_setting": "Setting",
    "table_value": "Value",
    "summary_changed": "Showing {n} changed {n, plural, one{setting} other{settings}} out of {total} total",
    "summary_parsed": "Showing {n} parsed settings",
    "empty_initial": "Paste Betaflight \"diff all\" output into one or both panels above to compare tunes.",
    "empty_identical": "No differences found — configs appear identical.",
    "empty_invalid": "No settings found. Make sure to paste valid \"diff all\" output."
  },
  "blackbox": {
    "title": "Blackbox Analyzer",
    "subtitle": "Drop a Betaflight Blackbox Explorer CSV export to analyze gyro FFT and step response.",
    "dropzone_label": "Drop Blackbox CSV",
    "dropzone_sub": "or click to browse — .csv export from Betaflight Blackbox Explorer",
    "error_not_csv": "Please drop a .csv file exported from Blackbox Explorer",
    "error_parse": "Parse error: {message}",
    "error_read": "Failed to read file",
    "tab_fft": "FFT Analysis",
    "tab_step": "Step Response",
    "series_gyro_psd": "Gyro PSD (dB)",
    "step_series_name": "Step {n} ({sign}{amplitude} °/s)",
    "axis_fft": "X-axis: frequency (Hz) | Y-axis: PSD (dB)",
    "axis_step": "X-axis: time after step (ms) | Y-axis: gyro (°/s)",
    "noise_fundamental": "Fundamental: {hz} Hz",
    "noise_harmonic": "{n}× harmonic: {dB} dB",
    "noise_resonance": "Resonance: {hz} Hz (Q = {q})",
    "noise_broadband": "Broadband: {rms} °/s RMS",
    "summary_samples": "{n} samples",
    "summary_loop": "{hz} Hz loop",
    "summary_steps": "{n} step {n, plural, one{event} other{events}}",
    "no_steps": "No step events detected in this log"
  }
}
```

- [ ] **Step 1:** Create the directory `src/locales/` and write `en.json` with the complete structure above. Verify it is valid JSON (no trailing commas, correct escaping).

---

### Task 1.5: Bootstrap i18n at App Startup

**Files:**
- Modify: `src/main.ts`

**Current `src/main.ts`:**
```ts
import { createApp } from 'vue'
import App from './app/App.vue'
import router from './app/router'
import './styles/global.css'

const app = createApp(App)
app.use(router)
app.mount('#app')
```

**Target `src/main.ts`:**
```ts
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
```

- [ ] **Step 1:** Modify `src/main.ts` to import the singleton and en.json, call `preload('en', enMessages)`, and conditionally async-load a saved non-English locale before mounting.

---

### Task 1.6: SEO Migration to i18n Keys

**Files:**
- Modify: `src/app/router.ts`
- Modify: `src/app/seo.ts` (keep as route-path-to-key mapping only)

**Current state:** `router.ts` reads `ROUTE_META[to.path]` which returns hardcoded English strings from `seo.ts`.

**Target:** `seo.ts` maps route paths to i18n key prefixes. `router.ts` uses `fpvI18n.t()` to resolve the actual strings. A singleton subscription re-applies meta when locale changes.

**New `src/app/seo.ts`:**
```ts
/** Maps route paths to their seo.* key prefix in the locale file. */
export const ROUTE_SEO_KEYS: Record<string, string> = {
  '/': 'home',
  '/pid': 'pid',
  '/power': 'power',
  '/motors': 'motors',
  '/rf': 'rf',
  '/convert': 'convert',
  '/tilt': 'tilt',
  '/diff': 'diff',
  '/blackbox': 'blackbox',
}
```

**Modified `src/app/router.ts`** additions:
```ts
import { fpvI18n } from '@core/shared/i18n'
import { ROUTE_SEO_KEYS } from './seo'

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
```

The `router.beforeEach` hook calls `applyMeta(to.path)` instead of the current inline code.

- [ ] **Step 1:** Rewrite `src/app/seo.ts` to export only `ROUTE_SEO_KEYS` (the route-path-to-key mapping). Remove the `RouteMeta` interface and `ROUTE_META` object.

- [ ] **Step 2:** Modify `src/app/router.ts` to import `fpvI18n` and `ROUTE_SEO_KEYS`. Replace the `beforeEach` body with a call to `applyMeta()`. Add the `fpvI18n.subscribe()` call that re-applies meta on locale change.

---

## Phase 2: Translation Content

**Dependencies:** Phase 1 complete (en.json exists, singleton works)
**Estimated complexity:** Low-medium (6 JSON files + 1 script, ~1200 lines of JSON per locale)

### Task 2.1: Translation Validation Script

**Files:**
- Create: `scripts/check-i18n.ts`
- Modify: `package.json` (add `"test:i18n"` script)

```ts
// scripts/check-i18n.ts
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

const localeDir = resolve('src/locales')

function flatKeys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix].filter(Boolean)
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    flatKeys(v, prefix ? `${prefix}.${k}` : k)
  )
}

function checkEmptyValues(obj: unknown, prefix = ''): string[] {
  if (typeof obj === 'string') return obj.trim() === '' ? [prefix] : []
  if (typeof obj !== 'object' || obj === null) return []
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    checkEmptyValues(v, prefix ? `${prefix}.${k}` : k)
  )
}

const en = JSON.parse(readFileSync(join(localeDir, 'en.json'), 'utf8'))
const enKeys = new Set(flatKeys(en))

console.log(`[en]  ${enKeys.size} keys (source of truth)\n`)

let hasError = false

for (const file of readdirSync(localeDir).filter(f => f.endsWith('.json') && f !== 'en.json')) {
  const locale = file.replace('.json', '')
  const messages = JSON.parse(readFileSync(join(localeDir, file), 'utf8'))
  const keys = new Set(flatKeys(messages))

  const missing = [...enKeys].filter(k => !keys.has(k))
  const extra = [...keys].filter(k => !enKeys.has(k))
  const empty = checkEmptyValues(messages)

  if (missing.length || extra.length || empty.length) {
    hasError = true
    console.error(`[${locale}]  ${missing.length} missing  ${extra.length} extra  ${empty.length} empty`)
    missing.forEach(k => console.error(`  - MISSING  ${k}`))
    extra.forEach(k => console.error(`  + EXTRA    ${k}`))
    empty.forEach(k => console.error(`  ! EMPTY    ${k}`))
  } else {
    console.log(`[${locale}]  OK (${enKeys.size} keys)`)
  }
}

if (hasError) process.exit(1)
```

- [ ] **Step 1:** Create `scripts/check-i18n.ts` with the validation script above.

- [ ] **Step 2:** Add to `package.json` scripts: `"test:i18n": "npx tsx scripts/check-i18n.ts"`

---

### Task 2.2: Generate Locale Files

**Files:**
- Create: `src/locales/zh.json`
- Create: `src/locales/de.json`
- Create: `src/locales/ru.json`
- Create: `src/locales/pt-BR.json`
- Create: `src/locales/ja.json`
- Create: `src/locales/ko.json`

Each file must have the exact same key structure as `en.json`. Translation rules:

1. **Keep in English (never translate):** All technical abbreviations (Hz, kHz, MHz, GHz, dBm, dBi, dB, mW, V, A, mAh, Wh, g, kg, Nm, RPM, KV, rad/s, km, m, ms, min, S, AWG, dB), brand/product names (Betaflight, ELRS, Molicel, FPV, DJI), PID terms (P Gain, I Gain, D Gain, FF Gain, P-term, I-term, D-term, Gyro LP, D-Term LP), preset names (BF 4.4 Default, 5" Freestyle, etc.), Betaflight CLI category names (PID, Filters, Rates, Features), conversion formula labels (dBm, mW, mAh, Wh, KV, RPM, Hz, rad/s, AWG).
2. **Keep interpolation placeholders unchanged:** `{name}`, `{margin}`, `{v}`, `{n}`, `{total}`, `{hz}`, `{dB}`, `{q}`, `{rms}`, `{pct}`, `{tilt}`, `{message}`, `{sign}`, `{amplitude}`, `{seconds}`.
3. **Keep ICU plural syntax intact:** `{n, plural, one{...} other{...}}` structure must be preserved with locale-appropriate plural forms.
4. **Translate all UI labels, descriptions, messages, status words, verdicts, error messages, and prose text** into natural language used by drone hobbyists in each locale.

**Per-locale notes:**
- `zh`: Use Simplified Chinese (zh-Hans). Target audience is mainland China FPV hobbyists.
- `de`: Standard German. FPV racing club terminology is common.
- `ru`: Russian. Many FPV technical terms are kept in English by Russian pilots; translate descriptions but preserve technical abbreviations.
- `pt-BR`: Brazilian Portuguese specifically (not European). Example: "throttle" = "acelerador".
- `ja`: Japanese. Many English loan words in katakana are accepted. Preserve technical terms.
- `ko`: Korean. Active drone racing community uses mixed Korean/English terminology.

- [ ] **Step 1:** Create all 6 locale JSON files with complete translations. Each file must match the exact key structure of `en.json`.

- [ ] **Step 2:** Run `npm run test:i18n` to verify all locale files pass validation (zero missing, zero extra, zero empty keys).

---

## Phase 3: PID Simulator Refactor

**Dependencies:** Phase 1 complete (i18n keys available for new UI strings)
**Estimated complexity:** High (1 new file, 2 modified files, ~400 lines)

### Task 3.1: Extract stepSim Helper

**Files:**
- Modify: `src/core/pid/simulate.ts`

**Current state:** `simulate()` contains the inner loop body inline (lines 30-79). The new `SimRunner` needs the same logic.

**Target:** Extract the per-step logic into a standalone `stepSim()` function. Both `simulate()` and `SimRunner.tick()` call it.

```ts
// New export in simulate.ts

export interface StepContext {
  plantState: PlantState
  ctrlState: ControllerState
  filterBank: FilterBank
  ctrlConfig: ControllerConfig
  plant: PlantModel
  spProfile: SetpointProfile
  disturbances: Disturbance[]
  noiseStd: number
  rng: () => number
  dt: number
}

/**
 * Advance the simulation by one controller tick.
 * Returns the sample for this step (or null if it should be skipped for decimation).
 * Mutates plantState, ctrlState, filterBank in place.
 */
export function stepSim(ctx: StepContext, step: number, tMs: number): SimSample {
  const setpointDegS = generateSetpoint(ctx.spProfile, tMs)

  let disturbanceTorque = 0
  for (const d of ctx.disturbances) {
    if (tMs >= d.startMs && tMs < d.startMs + d.durationMs) {
      disturbanceTorque += d.torqueNm
    }
  }

  const gyroDegS = radToDeg(ctx.plantState.omega)
  const noiseVal = ctx.noiseStd > 0 ? gaussianNoise(ctx.rng) * ctx.noiseStd : 0
  const gyroMeasuredDegS = gyroDegS + noiseVal

  let gyroFiltered = ctx.filterBank.gyro.process(gyroMeasuredDegS)
  if (ctx.filterBank.notch) {
    gyroFiltered = ctx.filterBank.notch.process(gyroFiltered)
  }

  const ctrlOut = stepController(ctx.ctrlState, ctx.ctrlConfig, setpointDegS, gyroFiltered, ctx.dt)
  stepPlant(ctx.plantState, ctx.plant, ctrlOut.output, disturbanceTorque, ctx.dt)

  return {
    tMs,
    setpointDegS,
    gyroDegS,
    gyroMeasuredDegS,
    errorDegS: setpointDegS - gyroDegS,
    pTerm: ctrlOut.pTerm,
    iTerm: ctrlOut.iTerm,
    dTerm: ctrlOut.dTerm,
    ffTerm: ctrlOut.ffTerm,
    motorOutput: ctrlOut.output,
    saturated: ctrlOut.saturated,
  }
}
```

Then refactor `simulate()` to call `stepSim()` internally instead of inlining the loop body. The function's external signature and return type remain unchanged.

- [ ] **Step 1:** Add `StepContext` interface and `stepSim()` function to `src/core/pid/simulate.ts`.

- [ ] **Step 2:** Refactor `simulate()` to use `stepSim()` internally. Verify `npm test` still passes.

---

### Task 3.2: SimRunner Class (Continuous Simulation)

**Files:**
- Create: `src/core/pid/sim-runner.ts`

**Interfaces:**
```ts
// src/core/pid/sim-runner.ts — Pure TS, no DOM

import { mulberry32, gaussianNoise } from '@core/shared/prng'
import { createPlantState, type PlantState } from './plant'
import { createControllerState, type ControllerState } from './controller'
import { createFilterBank, type FilterBank } from './filters'
import { stepSim, type StepContext } from './simulate'
import type { SimConfig, SimSample } from './types'

export class SimRunner {
  private _ctx: StepContext
  private _step = 0
  private _decimateEvery: number

  constructor(config: SimConfig) {
    const fs = config.controller.loopRateHz
    const dt = 1 / fs
    const noiseStd = config.noise.kind === 'gaussian' ? (config.noise.gaussianStdDegS ?? 0) : 0

    this._decimateEvery = Math.max(1, Math.round(fs / 1000))
    this._ctx = {
      plantState: createPlantState(config.plant),
      ctrlState: createControllerState(config.controller),
      filterBank: createFilterBank(config.controller.filters, fs),
      ctrlConfig: config.controller,
      plant: config.plant,
      spProfile: config.setpoint,
      disturbances: config.disturbances,
      noiseStd,
      rng: mulberry32(config.noise.seed),
      dt,
    }
  }

  /**
   * Advance the simulation by wallMs of real time.
   * Returns only the newly produced (decimated) samples.
   *
   * At 4 kHz with 16ms wall time: 64 steps, ~16 output samples. Very cheap.
   */
  tick(wallMs: number): SimSample[] {
    const nSteps = Math.round((wallMs / 1000) * (1 / this._ctx.dt))
    const newSamples: SimSample[] = []

    for (let i = 0; i < nSteps; i++) {
      const tMs = this._step * this._ctx.dt * 1000
      const sample = stepSim(this._ctx, this._step, tMs)

      if (this._step % this._decimateEvery === 0) {
        newSamples.push(sample)
      }
      this._step++
    }

    return newSamples
  }

  /** Current simulation time in milliseconds. */
  get elapsedMs(): number {
    return this._step * this._ctx.dt * 1000
  }

  /** Re-create all internal state from the same config. */
  reset(config: SimConfig): void {
    const fs = config.controller.loopRateHz
    const dt = 1 / fs
    const noiseStd = config.noise.kind === 'gaussian' ? (config.noise.gaussianStdDegS ?? 0) : 0

    this._decimateEvery = Math.max(1, Math.round(fs / 1000))
    this._step = 0
    this._ctx = {
      plantState: createPlantState(config.plant),
      ctrlState: createControllerState(config.controller),
      filterBank: createFilterBank(config.controller.filters, fs),
      ctrlConfig: config.controller,
      plant: config.plant,
      spProfile: config.setpoint,
      disturbances: config.disturbances,
      noiseStd,
      rng: mulberry32(config.noise.seed),
      dt,
    }
  }
}
```

- [ ] **Step 1:** Create `src/core/pid/sim-runner.ts` with the `SimRunner` class above.

- [ ] **Step 2:** Write a vitest test `src/core/pid/__tests__/sim-runner.test.ts` that verifies:
  - `tick(16)` returns ~16 samples at 4kHz (64 steps / 4 decimation)
  - `elapsedMs` advances correctly after multiple ticks
  - `reset()` clears state and `elapsedMs` returns to 0
  - Output samples have correct structure (all SimSample fields present)

---

### Task 3.3: Continuous Simulation in pid-simulator.ts

**Files:**
- Modify: `src/components/pid/pid-simulator.ts`

This is the largest change in the refactor. The one-shot `simulate()` call is replaced with a continuous rAF loop using `SimRunner`.

**New imports and fields to add:**
```ts
import { I18nController } from '../primitives/I18nController.js'
import { SimRunner } from '@core/pid/sim-runner'

// Add inside class body:
private _i18n = new I18nController(this)  // needed for HUD button labels

@state() private _running = true        // default: continuous, running
@state() private _elapsedMs = 0         // total sim wall-clock time accumulated

private _rafId = 0                      // requestAnimationFrame handle
private _lastFrameTs = 0               // DOMHighResTimeStamp of previous rAF tick
private _runner: SimRunner | null = null
private _rollingBuf: SimSample[] = []   // sliding window of recent samples
private _fullSamples: SimSample[] = []  // all samples for metrics computation on Stop
private _windowMs = 2000                // display window width (fixed)
```

**Methods to ADD:**

| Method | Purpose |
|---|---|
| `_startLoop()` | **Idempotent.** First line: `cancelAnimationFrame(this._rafId)`. Then sets `_running = true`, stamps `_lastFrameTs = performance.now()`, starts rAF via `_tick()`. The cancel-first ensures no double rAF chains accumulate (critical when `_onConfigChange` calls this while a loop is already running) |
| `_stopLoop()` | Sets `_running = false`, cancels rAF. Computes metrics from `_fullSamples` and stores in `_result` for the Metrics tab |
| `_resetSim()` | Creates new `SimRunner(this._config)`, clears `_rollingBuf` and `_fullSamples`, sets `_elapsedMs = 0` |
| `_tick()` | rAF callback: calculates deltaMs, calls `this._runner.tick(deltaMs)`, pushes to `_rollingBuf` and `_fullSamples`, trims rolling buffer to `_windowMs`, updates `_elapsedMs`, calls `this.requestUpdate()`, schedules next rAF |
| `_onStart()` | Button handler: calls `_startLoop()` |
| `_onStop()` | Button handler: calls `_stopLoop()` |
| `_onReset()` | Button handler: calls `_stopLoop()`, `_resetSim()` |
| `_onRestart()` | Button handler: calls `_stopLoop()`, `_resetSim()`, `_startLoop()` |

**Methods to REMOVE:**
- `_runSim()` (lines 150-152) -- replaced by incremental runner
- `_scheduleRun()` (lines 154-157) -- no longer needed

**Methods to MODIFY:**

- `firstUpdated()` (line 144): Replace `this._runSim()` with `this._resetSim()` then `this._startLoop()`

- `_onConfigChange()` (lines 159-163): Keep the config merge. Then call `this._resetSim()`. If `_running`, call `this._startLoop()`. This gives the "reactive restart on config change" behavior.

- `_buildResponseSeries()`: Source from `this._rollingBuf` instead of `this._result?.samples`. Build Float32Arrays the same way.

- `_buildTermsSeries()`: Source from `this._rollingBuf` instead of `this._result?.samples`.

- `_getQuadProps()`: Read from `this._rollingBuf[this._rollingBuf.length - 1]` instead of `this._result?.samples[last]`.

- `_renderMetrics()`: When `_running === true`, show `html`<div class="metric-null">${this._i18n.t('common.running')}</div>` instead of the metrics grid. When `_running === false` and `_result?.metrics` exists, show the metrics grid as before.

- `render()`: 
  1. Add the HUD toolbar div above `.layout`
  2. Pass `timeMs=${this._windowMs}` (fixed 2000) instead of `${durationMs}` to `fpv-scope`

**IMPORTANT:** There is no `fpv-button` primitive in this codebase. The HUD toolbar must use native `<button class="hud-btn">` elements (same approach as the `.secondary-toggle` in Task 3.4).

**HUD toolbar template (inserted above `.layout` in render()):**
```html
<div class="hud-toolbar">
  ${this._running
    ? html`<button class="hud-btn" @click=${this._onStop}>${this._i18n.t('common.stop')}</button>`
    : html`<button class="hud-btn" @click=${this._onStart}>${this._i18n.t('common.start')}</button>`
  }
  <button class="hud-btn" @click=${this._onReset}>${this._i18n.t('common.reset')}</button>
  <button class="hud-btn" @click=${this._onRestart}>${this._i18n.t('common.restart')}</button>
  <span class="hud-time">${this._i18n.t('pid.hud_time_label', { seconds: (this._elapsedMs / 1000).toFixed(1) })}</span>
</div>
```

**HUD toolbar CSS to add:**
```css
.hud-toolbar {
  display: flex;
  align-items: center;
  gap: var(--fpv-space-sm);
  padding: var(--fpv-space-sm) 0;
}

.hud-btn {
  padding: var(--fpv-space-xs) var(--fpv-space-md);
  background: var(--fpv-surface-2);
  border: 1px solid var(--fpv-border);
  border-radius: var(--fpv-radius-sm);
  color: var(--fpv-text);
  font-size: var(--fpv-font-label);
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
  min-height: 36px;
}

.hud-btn:hover {
  border-color: var(--fpv-primary);
  background-color: var(--fpv-border);
}

.hud-time {
  font-family: var(--fpv-font-mono);
  font-size: var(--fpv-font-body);
  color: var(--fpv-text-muted);
  margin-left: auto;
}
```

**Rolling window logic in `_tick()`:**
```ts
private _tick() {
  if (!this._running || !this._runner) return

  this._rafId = requestAnimationFrame((ts) => {
    if (!this._running) return

    const deltaMs = ts - this._lastFrameTs
    this._lastFrameTs = ts

    // Cap delta to avoid huge jumps on tab-switch
    const clampedDelta = Math.min(deltaMs, 50)

    const newSamples = this._runner!.tick(clampedDelta)

    // Accumulate for metrics (computed on Stop)
    this._fullSamples.push(...newSamples)

    // Rolling window for display
    this._rollingBuf.push(...newSamples)
    this._elapsedMs = this._runner!.elapsedMs

    // Trim to windowMs
    const cutoff = this._elapsedMs - this._windowMs
    while (this._rollingBuf.length > 0 && this._rollingBuf[0].tMs < cutoff) {
      this._rollingBuf.shift()
    }

    this.requestUpdate()
    this._tick()
  })
}
```

**Scope time axis:** Pass `timeMs={this._windowMs}` (fixed 2000). The scope renders the rolling buffer mapped to `[0, 2000ms]`. As old samples age out, the plot scrolls left automatically. Existing zoom/pan works on top of this.

- [ ] **Step 1:** Add `SimRunner` import, new state fields, and the `_tick()` / `_startLoop()` / `_stopLoop()` / `_resetSim()` methods.

- [ ] **Step 2:** Remove `_runSim()` and `_scheduleRun()`. Update `firstUpdated()` and `_onConfigChange()`.

- [ ] **Step 3:** Update `_buildResponseSeries()`, `_buildTermsSeries()`, `_getQuadProps()` to read from `_rollingBuf`.

- [ ] **Step 4:** Update `_renderMetrics()` to show "running..." placeholder while `_running` is true.

- [ ] **Step 5:** Add HUD toolbar HTML and CSS to `render()` and `static styles`.

- [ ] **Step 6:** Verify `npm run build` succeeds. Test manually: page loads, sim runs continuously, Start/Stop/Reset/Restart buttons work, scope scrolls, config changes restart the sim.

---

### Task 3.4: Control Grouping in pid-controls.ts

**Files:**
- Modify: `src/components/pid/pid-controls.ts`

**Current render() order (lines 306-319):**
1. `_renderGains()`
2. `_renderFilters()`
3. `_renderLoopRate()`
4. `_renderPlant()`
5. `_renderSetpoint()`
6. `_renderOptions()`
7. `_renderPresets()`
8. `_renderDisturbance()`

**Target layout: Primary (always visible) + Secondary (collapsible, closed by default)**

**Primary group (prominent, always visible):**
1. `_renderPresets()` -- move to top (preset load sets all gains at once)
2. `_renderGains()` -- the most-used controls, large sliders
3. `_renderPlant()` -- plant preset select
4. `_renderSetpoint()` -- setpoint profile

**Secondary group (behind "Advanced" toggle):**
5. `_renderFilters()` -- gyro LP, dterm LP, notch
6. `_renderLoopRate()` -- loop rate select
7. `_renderOptions()` -- iTermRelax, anti-windup
8. `_renderDisturbance()` -- disturbance injection

**New state:**
```ts
@state() private _secondaryOpen = false
```

**New render():**
```ts
render() {
  if (!this.config) return html``
  return html`
    <div class="sections">
      ${this._renderPresets()}
      ${this._renderGains()}
      ${this._renderPlant()}
      ${this._renderSetpoint()}

      <button class="secondary-toggle"
        @click=${() => { this._secondaryOpen = !this._secondaryOpen }}>
        ${this._i18n.t('common.advanced')} ${this._secondaryOpen ? '▲' : '▼'}
      </button>
      ${this._secondaryOpen ? html`
        ${this._renderFilters()}
        ${this._renderLoopRate()}
        ${this._renderOptions()}
        ${this._renderDisturbance()}
      ` : ''}
    </div>
  `
}
```

**CSS to add:**
```css
.secondary-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--fpv-space-xs);
  width: 100%;
  padding: var(--fpv-space-sm);
  background: var(--fpv-surface-2);
  border: 1px solid var(--fpv-border);
  border-radius: var(--fpv-radius-sm);
  color: var(--fpv-text-muted);
  font-size: var(--fpv-font-label);
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.secondary-toggle:hover {
  border-color: var(--fpv-primary);
  color: var(--fpv-text);
}
```

- [ ] **Step 1:** Add `@state() private _secondaryOpen = false` and add `I18nController` to the component.

- [ ] **Step 2:** Reorder `render()` to: Presets, Gains, Plant, Setpoint, toggle button, then conditionally Filters, LoopRate, Options, Disturbance.

- [ ] **Step 3:** Add `.secondary-toggle` CSS.

---

## Phase 4: 3D Quad Preview

**Dependencies:** Phase 3 complete (continuous sim provides live sample data)
**Estimated complexity:** Medium-high (1 new file, 1 modified file, ~350 lines)

### Task 4.1: CSS 3D Quad Preview Component

**Files:**
- Create: `src/components/quad-preview/fpv-quad-preview-3d.ts`

**Approach:** CSS 3D transforms for the quad body/frame structure (genuine 3D tilt with zero dependencies). Canvas overlay retained for torque arc, setpoint arc, and numeric labels (information-dense vector graphics that CSS cannot match).

**Component structure (shadow DOM):**
```
.scene                        /* perspective: 500px; position: relative */
  .quad                       /* transform: rotateX(pitch) rotateY(yaw) rotateZ(roll) */
    .arm.arm--fl              /* rotate(-45deg), translateX(-armLen) */
    .arm.arm--fr              /* rotate(45deg),  translateX(armLen) */
    .arm.arm--rl              /* rotate(225deg), translateX(-armLen) */
    .arm.arm--rr              /* rotate(135deg), translateX(armLen) */
      .motor                  /* round div at arm tip, border-width tracks thrust */
        .thrust-bar           /* height = motorOutput * maxHeight */
    .body                     /* center square/diamond rotated 45deg */
  canvas.overlay              /* absolute, full size, for arcs + labels only */
```

**Properties (same interface as `fpv-quad-preview`):**
```ts
@property({ type: Array })  motorOutputs: number[] = [0, 0, 0, 0]
@property({ type: Number }) setpointDegS = 0
@property({ type: Number }) gyroDegS = 0
@property({ type: Number }) errorDegS = 0
@property({ type: Boolean }) saturated = false
@property({ type: String })  axis: 'roll' | 'pitch' | 'yaw' = 'roll'
```

**Rotation mapping:**
- Derive `rollDeg` from `gyroDegS` as a visual proxy: `rollDeg = clamp(gyroDegS / 720 * 45, -60, 60)`
- Apply as CSS `transform: rotateX(${rollDeg}deg)` on the `.quad` div (for roll axis)
- For pitch axis: `rotateZ(${pitchDeg}deg)`
- For yaw axis: `rotateY(${yawDeg}deg)`
- Browser compositor handles the 3D transformation with hardware acceleration

**Sizing (proportional, CSS custom properties):**
```css
.scene {
  perspective: 500px;
  perspective-origin: 50% 40%;
  position: relative;
  width: 100%;
  height: 100%;
}

.quad {
  position: absolute;
  top: 50%;
  left: 50%;
  transform-style: preserve-3d;
  transition: transform 0.05s linear;
}

.arm {
  position: absolute;
  width: var(--arm-len, 38%);
  height: 2px;
  background: var(--fpv-border);
  transform-origin: 0 50%;
  top: 50%;
  left: 50%;
}

.motor {
  position: absolute;
  right: -8px;
  top: -8px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--motor-color, var(--fpv-primary));
  background: color-mix(in srgb, var(--motor-color, var(--fpv-primary)) 16%, transparent);
}

.thrust-bar {
  position: absolute;
  bottom: 100%;
  left: 50%;
  width: 2px;
  transform: translateX(-50%);
  background: var(--motor-color, var(--fpv-primary));
  height: calc(var(--thrust, 0) * 40px);
  transition: height 0.05s linear;
}

.body {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -6px;
  background: var(--fpv-border);
  transform: rotate(45deg);
}
```

**Canvas overlay (retained, reduced scope):**
The canvas overlay draws only:
1. Net torque arc at CoG (same logic as current `fpv-quad-preview`)
2. Setpoint ghost arc
3. SP / GY numeric text
4. Axis label (ROLL / PITCH / YAW)

Motor circles, frame arms, and motor labels are handled by CSS divs and removed from canvas drawing.

**Motor color logic (same as current):**
```ts
private _motorColor(): string {
  if (this.saturated) return clrError
  const absSetpoint = Math.abs(this.setpointDegS)
  const absError = Math.abs(this.errorDegS)
  const goodTracking = absSetpoint < 5 ? absError < 5 : absError < absSetpoint * 0.2
  return goodTracking ? clrPrimary : clrAccent
}
```

**rAF loop:** Dirty-check loop (same pattern as current component). Transform string and CSS custom properties update when props change. Canvas redraws only when `_dirty = true`.

- [ ] **Step 1:** Create `src/components/quad-preview/fpv-quad-preview-3d.ts` with the CSS 3D structure, property definitions, motor color logic, and canvas overlay for arcs/labels.

- [ ] **Step 2:** Ensure the component registers as `<fpv-quad-preview-3d>` via `@customElement('fpv-quad-preview-3d')`.

- [ ] **Step 3:** Test: component renders a stylized quad frame that tilts based on `gyroDegS`, motors scale based on `motorOutputs`, colors change based on tracking quality / saturation.

---

### Task 4.2: Wire 3D Preview into PID Simulator

**Files:**
- Modify: `src/components/pid/pid-simulator.ts`

**Changes:**
1. Add import: `import '../quad-preview/fpv-quad-preview-3d.js'`
2. In `render()`, replace `<fpv-quad-preview ...>` (lines 337-343) with `<fpv-quad-preview-3d ...>` using the same property bindings. Add `.axis=${'roll'}` which was previously omitted (component defaulted to 'roll').
3. The existing `_getQuadProps()` method works unchanged -- it returns the same property shape.

- [ ] **Step 1:** Change the import from `fpv-quad-preview.js` to `fpv-quad-preview-3d.js`.

- [ ] **Step 2:** Replace the tag in the template from `<fpv-quad-preview>` to `<fpv-quad-preview-3d>`. Add `.axis=${'roll'}`.

- [ ] **Step 3:** Verify the old `fpv-quad-preview.ts` file remains in the codebase (do not delete it -- it can serve as a fallback or be reused elsewhere).

---

## Phase 5: UI Chrome & Responsive

**Dependencies:** Phase 1 complete (i18n available for prefs dropdown and nav strings)
**Estimated complexity:** Medium-high (1 new file, 4 modified files, ~500 lines)

### Task 5.1: Preferences Dropdown Component

**Files:**
- Create: `src/app/components/PrefsDropdown.vue`

**Design:**

Trigger button: gear icon button, replaces current `.theme-btn`. Same styling as current theme button. `aria-label` from `prefs.prefs_label` i18n key.

Panel: positioned absolute below the trigger, right-aligned. Width 240px on desktop, bottom-sheet on mobile. Background `var(--fpv-surface-2)`, border, box-shadow, border-radius.

**Theme section:** Labeled with `prefs.theme` key. Three pill buttons:
- Dark (prefs.theme_dark), Light (prefs.theme_light), Auto (prefs.theme_auto)
- Active pill: `background: var(--fpv-primary); color: #000`
- Calls `setTheme()` from `useTheme`

**Language section:** Labeled with `prefs.language` key. List of 7 languages (en + 6 non-English), each a full-width button row showing the native language name from `LOCALE_LABELS`.
- Active row: left border `2px solid var(--fpv-primary)`, background `var(--fpv-surface)`
- Calls `setLocale()` from `useI18n`

**Dismiss behavior:**
- Click outside closes panel
- Escape key closes panel
- Clicking trigger toggles

**Mobile (max-width: 600px):** Panel becomes `position: fixed; bottom: 0; left: 0; right: 0; width: 100%` with a semi-transparent overlay behind it.

```vue
<template>
  <div class="prefs-wrap" ref="wrapRef">
    <button class="prefs-trigger" @click="toggle" :aria-label="t('prefs.prefs_label')" :title="t('prefs.prefs_label')">
      <!-- gear icon (Unicode) -->
      &#x2699;
    </button>
    <Teleport to="body">
      <div v-if="open" class="prefs-overlay" @click="close"></div>
      <div v-if="open" class="prefs-panel" :class="{ 'prefs-panel--mobile': isMobile }" ref="panelRef">
        <div class="prefs-section">
          <div class="prefs-section-label">{{ t('prefs.theme') }}</div>
          <div class="prefs-pills">
            <button v-for="th in themes" :key="th"
              :class="['prefs-pill', { active: theme === th }]"
              @click="setTheme(th)">
              {{ t(`prefs.theme_${th}`) }}
            </button>
          </div>
        </div>
        <div class="prefs-section">
          <div class="prefs-section-label">{{ t('prefs.language') }}</div>
          <div class="prefs-lang-list">
            <button v-for="loc in SUPPORTED_LOCALES" :key="loc"
              :class="['prefs-lang', { active: locale === loc }]"
              @click="selectLocale(loc)">
              {{ LOCALE_LABELS[loc] }}
            </button>
          </div>
        </div>
      </div>
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
```

Styles: see the exploration report for exact CSS. Key points: `.prefs-panel` is absolute right:0 on desktop, fixed bottom:0 on mobile. 150ms ease-out transition. `.prefs-pill.active` uses `var(--fpv-primary)`. `.prefs-lang.active` has left border accent.

- [ ] **Step 1:** Create `src/app/components/PrefsDropdown.vue` with theme pills, language list, click-outside dismiss, Escape dismiss, mobile bottom-sheet layout.

- [ ] **Step 2:** Style the component using only CSS custom properties from the design token system (no hardcoded colors).

---

### Task 5.2: Replace Theme Toggle in App.vue

**Files:**
- Modify: `src/app/App.vue`

**Changes:**
1. Remove: `useTheme` import, `themeIcon` computed, `theme`/`label`/`cycle` destructuring
2. Remove: `<button class="theme-btn">` element and `.theme-btn` / `.theme-btn:hover` CSS
3. Add: `import PrefsDropdown from './components/PrefsDropdown.vue'` and `import { useI18n } from './composables/useI18n'`
4. Replace the theme button with `<PrefsDropdown />`
5. Replace hardcoded nav link text with `t()` calls:
   - `FPV Tools` -> `{{ t('nav.brand') }}`
   - `PID` -> `{{ t('nav.pid') }}`
   - etc. for all 8 nav links

- [ ] **Step 1:** Import `PrefsDropdown` and `useI18n`. Replace the theme button with `<PrefsDropdown />`. Replace hardcoded nav strings with `t()` calls.

- [ ] **Step 2:** Remove unused `useTheme` import, `themeIcon` computed, and `.theme-btn` CSS.

---

### Task 5.3: Mobile Nav (Hamburger Collapse)

**Files:**
- Modify: `src/app/App.vue`

**Problem:** At 375px, 8 nav links wrap to 2-3 rows, consuming ~20% of viewport. No hamburger menu exists.

**Solution:** Add a hamburger toggle button visible only at `max-width: 600px`. The `.nav-links` are hidden behind it on mobile and shown in a vertical dropdown.

**New state:**
```ts
const navOpen = ref(false)
```

**Template changes:**
```html
<button class="nav-hamburger" @click="navOpen = !navOpen" aria-label="Menu">
  <span class="hamburger-bar"></span>
  <span class="hamburger-bar"></span>
  <span class="hamburger-bar"></span>
</button>
```

**CSS changes:**
```css
.nav-hamburger {
  display: none; /* hidden on desktop */
}

@media (max-width: 600px) {
  .nav-hamburger {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 8px;
    background: none;
    border: none;
    cursor: pointer;
  }

  .hamburger-bar {
    width: 18px;
    height: 2px;
    background: var(--fpv-text-muted);
    border-radius: 1px;
    transition: background 0.15s;
  }

  .nav-hamburger:hover .hamburger-bar {
    background: var(--fpv-text);
  }

  .nav-links {
    display: none; /* hidden by default on mobile */
    width: 100%;
    flex-direction: column;
    gap: var(--fpv-space-xs);
    order: 10; /* push below the nav bar */
  }

  .nav-links.open {
    display: flex;
  }

  .nav-links a {
    padding: var(--fpv-space-sm) 0;
    min-height: 44px;
    display: flex;
    align-items: center;
  }
}
```

Close the nav on route change:
```ts
import { useRouter } from 'vue-router'
const router = useRouter()
router.afterEach(() => { navOpen.value = false })
```

- [ ] **Step 1:** Add hamburger button, `navOpen` ref, and mobile CSS to show/hide nav links.

- [ ] **Step 2:** Close nav on route change via `router.afterEach`.

- [ ] **Step 3:** Ensure nav links have `min-height: 44px` and adequate padding on mobile for touch targets.

---

### Task 5.4: Touch Support for fpv-scope

**Files:**
- Modify: `src/components/scope/fpv-scope.ts`

**Problem:** The scope canvas uses only mouse events. Touch pan, pinch zoom, touch cursor/tooltip, and double-tap to reset are all non-functional on mobile.

**Changes to `_addCanvasListeners()`:** Add touch event handlers alongside existing mouse handlers:

```ts
// --- Touch handlers ---

private _touchStartId = -1
private _touchStartX = 0
private _pinchStartDist = 0
private _pinchStartZoomStart = 0
private _pinchStartZoomEnd = 0
private _lastTapTime = 0

// In _addCanvasListeners():

canvas.addEventListener('touchstart', (e: TouchEvent) => {
  e.preventDefault()

  if (e.touches.length === 1) {
    // Single finger: begin pan + set hover position
    const rect = canvas.getBoundingClientRect()
    const touch = e.touches[0]
    this._touchStartId = touch.identifier
    this._touchStartX = touch.clientX
    this._dragStartZoomStart = this._zoomStart
    this._dragStartZoomEnd = this._zoomEnd
    this._hoverX = touch.clientX - rect.left
    this._dirty = true

    // Double-tap detection
    const now = Date.now()
    if (now - this._lastTapTime < 300) {
      this._zoomStart = 0
      this._zoomEnd = 1
      this._dirty = true
    }
    this._lastTapTime = now
  } else if (e.touches.length === 2) {
    // Two fingers: begin pinch zoom
    const dx = e.touches[1].clientX - e.touches[0].clientX
    const dy = e.touches[1].clientY - e.touches[0].clientY
    this._pinchStartDist = Math.hypot(dx, dy)
    this._pinchStartZoomStart = this._zoomStart
    this._pinchStartZoomEnd = this._zoomEnd
  }
}, { passive: false })

canvas.addEventListener('touchmove', (e: TouchEvent) => {
  e.preventDefault()
  const rect = canvas.getBoundingClientRect()

  if (e.touches.length === 1) {
    // Single finger pan
    const touch = e.touches[0]
    const dx = touch.clientX - this._touchStartX
    const range = this._dragStartZoomEnd - this._dragStartZoomStart
    const dtNorm = -(dx / rect.width) * range
    let ns = this._dragStartZoomStart + dtNorm
    let ne = this._dragStartZoomEnd + dtNorm
    if (ns < 0) { ns = 0; ne = range }
    if (ne > 1) { ne = 1; ns = 1 - range }
    this._zoomStart = Math.max(0, ns)
    this._zoomEnd = Math.min(1, ne)
    this._hoverX = touch.clientX - rect.left
    this._dirty = true
  } else if (e.touches.length === 2) {
    // Pinch zoom
    const dx = e.touches[1].clientX - e.touches[0].clientX
    const dy = e.touches[1].clientY - e.touches[0].clientY
    const dist = Math.hypot(dx, dy)
    const scale = this._pinchStartDist / dist // >1 means zoom in
    const range = this._pinchStartZoomEnd - this._pinchStartZoomStart
    const newRange = Math.max(MIN_ZOOM_RANGE, Math.min(1, range * scale))
    const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left
    const norm = midX / rect.width
    const cursorT = this._pinchStartZoomStart + norm * range
    let ns = cursorT - norm * newRange
    let ne = ns + newRange
    if (ns < 0) { ns = 0; ne = newRange }
    if (ne > 1) { ne = 1; ns = 1 - newRange }
    this._zoomStart = Math.max(0, ns)
    this._zoomEnd = Math.min(1, ne)
    this._dirty = true
  }
}, { passive: false })

canvas.addEventListener('touchend', (e: TouchEvent) => {
  if (e.touches.length === 0) {
    this._hoverX = -1
    this._dirty = true
  }
})

canvas.addEventListener('touchcancel', () => {
  this._hoverX = -1
  this._dirty = true
})
```

Update `_removeCanvasListeners()` to also remove the touch event listeners.

- [ ] **Step 1:** Add touch state fields (`_touchStartId`, `_touchStartX`, `_pinchStartDist`, `_pinchStartZoomStart`, `_pinchStartZoomEnd`, `_lastTapTime`).

- [ ] **Step 2:** Add `touchstart`, `touchmove`, `touchend`, `touchcancel` handlers in `_addCanvasListeners()`.

- [ ] **Step 3:** Update `_removeCanvasListeners()` to clean up touch listeners.

---

### Task 5.5: Touch Target Sizing

**Files:**
- Modify: `src/components/primitives/fpv-slider.ts`
- Modify: `src/components/primitives/fpv-number.ts`
- Modify: `src/components/primitives/fpv-select.ts`
- Modify: `src/components/primitives/fpv-tabs.ts`

**Problem:** All input components have touch targets well below the 44px WCAG minimum.

**fpv-slider.ts:**
- Increase `input[type=range]` thumb to 24x24px (from 14x14)
- Add `min-height: 44px` to `.row` (the containing wrapper), center-align vertically

**fpv-number.ts:**
- Set `min-height: 36px` on `.input-wrap`
- Add vertical padding to input element: `padding: 6px 8px` (from `2px 8px`)

**fpv-select.ts:**
- Set `min-height: 36px` on the `select` element
- Change padding to `8px var(--fpv-space-sm)` (from `4px var(--fpv-space-sm)`)

**fpv-tabs.ts:**
- Change `.tab` padding to `var(--fpv-space-sm) var(--fpv-space-md)` (8px 16px from 4px 16px)
- Add `min-height: 44px; display: flex; align-items: center` to `.tab`

- [ ] **Step 1:** Update slider thumb size and row min-height.

- [ ] **Step 2:** Update number input padding and min-height.

- [ ] **Step 3:** Update select padding and min-height.

- [ ] **Step 4:** Update tabs padding and min-height.

---

### Task 5.6: Scope Responsive Height

**Files:**
- Modify: `src/components/scope/fpv-scope.ts`

**Problem:** Canvas has `height: 300px; min-height: 300px` which takes ~80% of mobile portrait viewport.

**Fix:** Replace with responsive height:
```css
canvas {
  display: block;
  width: 100%;
  min-height: 200px;
  height: clamp(200px, 35vh, 350px);
  cursor: crosshair;
}
```

This saves ~100px on mobile portrait while keeping a good size on desktop.

**IMPORTANT:** The `_resizeCanvas()` method in fpv-scope.ts contains `h = Math.max(rect.height || ... , 300)` which forces the backing buffer to a 300px floor. This conflicts with the 200px CSS min-height: the canvas renders at 200px CSS but the buffer is 300px, causing vertical squish on mobile. Lower the JS floor from `300` to `200` to match the CSS `min-height`.

- [ ] **Step 1:** Change the canvas CSS from fixed `300px` to `clamp(200px, 35vh, 350px)`.

- [ ] **Step 2:** In `_resizeCanvas()`, change the `Math.max(...)` height floor from `300` to `200`.

---

## Phase 6: Integration & Polish

**Dependencies:** Phases 1-5 complete
**Estimated complexity:** Medium (many files modified with small changes, plus testing)

### Task 6.1: Wire i18n into Vue Views

**Files:**
- Modify: `src/app/views/HomeView.vue`
- Modify: `src/app/views/PidView.vue`
- Modify: `src/app/views/PowerView.vue`
- Modify: `src/app/views/RfView.vue`
- Modify: `src/app/views/MotorsView.vue`
- Modify: `src/app/views/ConvertView.vue`
- Modify: `src/app/views/BlackboxView.vue`
- Modify: `src/app/views/TiltView.vue`
- Modify: `src/app/views/DiffView.vue`

Each view currently has hardcoded `<h1>` and `<p>` text. Replace with `t()` calls:

```vue
<script setup lang="ts">
import { useI18n } from '../composables/useI18n'
const { t } = useI18n()
</script>

<template>
  <h1>{{ t('pid.title') }}</h1>
  <p class="subtitle">{{ t('pid.subtitle') }}</p>
  <pid-simulator></pid-simulator>
</template>
```

**HomeView.vue** is the most complex: replace the hero title, tagline, and all 8 tool card name/description pairs with `t()` calls using the `home.*` keys.

- [ ] **Step 1:** Update `HomeView.vue` with `useI18n` and replace all hardcoded strings with `t()` calls.

- [ ] **Step 2:** Update all 8 tool views (PidView, PowerView, RfView, MotorsView, ConvertView, BlackboxView, TiltView, DiffView) with `useI18n` and `t()` calls for title and subtitle.

---

### Task 6.2: Wire i18n into Lit Components

**Files:**
- Modify: `src/components/pid/pid-controls.ts` (42 strings)
- Modify: `src/components/pid/pid-simulator.ts` (28 strings)
- Modify: `src/components/power/pack-calculator.ts` (32 strings)
- Modify: `src/components/motors/motor-calculator.ts` (26 strings)
- Modify: `src/components/rf/link-budget.ts` (28 strings)
- Modify: `src/components/rf/vtx-checker.ts` (~15 strings)
- Modify: `src/components/convert/unit-converter.ts` (24 strings)
- Modify: `src/components/tilt/tilt-calculator.ts` (10 strings, canvas text needs special handling)
- Modify: `src/components/diff/tune-diff.ts` (14 strings)
- Modify: `src/components/blackbox/bbl-dropzone.ts` (5 strings)
- Modify: `src/components/blackbox/bbl-overlay.ts` (18 strings)

**Pattern for each component:**
1. Add `import { I18nController } from '../primitives/I18nController.js'`
2. Add `private _i18n = new I18nController(this)` field
3. Replace each hardcoded string with `this._i18n.t('key')` call
4. For `fpv-card header="Gains"`, change to `header=${this._i18n.t('pid.section_gains')}`
5. For `fpv-slider label="P Gain"`, change to `label=${this._i18n.t('pid.label_p_gain')}`
6. For select option labels, use `{ value: 'step', label: this._i18n.t('pid.profile_step') }`

**Special cases:**

- **tilt-calculator.ts canvas text:** The canvas draws text via `ctx.fillText()`. Pass the translated string into the draw method. For example:
  ```ts
  ctx.fillText(this._i18n.t('tilt.canvas_ground'), x, y)
  ctx.fillText(this._i18n.t('tilt.canvas_horizon', { pct: horizonPct.toFixed(0) }), x, y)
  ```

- **pid-simulator.ts metric badges:** The badge status text (`Fast`, `OK`, `Slow`, etc.) uses `common.status_*` keys:
  ```ts
  ${m.riseTimeMs <= 30 ? this._i18n.t('common.status_fast') : m.riseTimeMs <= 80 ? this._i18n.t('common.status_ok') : this._i18n.t('common.status_slow')}
  ```

- **pack-calculator.ts verdicts:** Use interpolation params:
  ```ts
  this._i18n.t('power.verdict_crate_ok', { margin: margin.toFixed(1) })
  ```

- **tune-diff.ts plural strings:**
  ```ts
  this._i18n.t('diff.summary_changed', { n: changed, total: total })
  ```

- **Preset names (BF 4.4 Default, 5" Freestyle, etc.):** These are kept in English -- they are technical identifiers. Do NOT translate them. They remain as hardcoded strings in the `options` arrays since they are lookup keys into `GAIN_PRESETS` and `PLANT_PRESETS`.

- [ ] **Step 1:** Wire i18n into `pid-controls.ts` and `pid-simulator.ts` (highest string count, most complex).

- [ ] **Step 2:** Wire i18n into `pack-calculator.ts` and `motor-calculator.ts`.

- [ ] **Step 3:** Wire i18n into `link-budget.ts` and `vtx-checker.ts`.

- [ ] **Step 4:** Wire i18n into `unit-converter.ts`, `tilt-calculator.ts`, `tune-diff.ts`.

- [ ] **Step 5:** Wire i18n into `bbl-dropzone.ts` and `bbl-overlay.ts`.

---

### Task 6.3: Number Formatting Helper

**Files:**
- Create: `src/core/shared/format.ts`

**Purpose:** Replace bare `.toFixed()` calls with locale-aware number formatting where the result is displayed as prose (not technical values).

```ts
// src/core/shared/format.ts — Pure TS

import { fpvI18n } from './i18n'

/**
 * Format a number with locale-aware decimal separator.
 * For technical readouts (metrics, results) that appear as prose.
 * NOT for axis labels or values that feed back into computation.
 */
export function formatNum(value: number, digits = 1): string {
  return new Intl.NumberFormat(fpvI18n.locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

/**
 * Format an integer with locale-aware thousands separator.
 * Example: 24000 -> "24,000" (en) or "24.000" (de)
 */
export function formatInt(value: number): string {
  return new Intl.NumberFormat(fpvI18n.locale, {
    maximumFractionDigits: 0,
  }).format(value)
}
```

Usage example in `motor-calculator.ts`: replace `r.maxRpm.toLocaleString()` with `formatInt(r.maxRpm)`.

Note: NOT all `.toFixed()` calls should be replaced. Technical values that are part of computations, axis labels on the scope, or values that the user might copy-paste into Betaflight should remain as-is (always use period decimal separator). Only values in result cards, metric badges, and prose readouts should use `formatNum`.

- [ ] **Step 1:** Create `src/core/shared/format.ts` with `formatNum()` and `formatInt()`.

- [ ] **Step 2:** Replace `r.maxRpm.toLocaleString()` in `motor-calculator.ts` with `formatInt(r.maxRpm)`.

- [ ] **Step 3:** Replace `.toLocaleString()` calls in `bbl-overlay.ts` with `formatInt()`.

---

### Task 6.4: Final Verification

- [ ] **Step 1:** Run `npm run build` and verify zero TypeScript errors.

- [ ] **Step 2:** Run `npm test` and verify all existing tests still pass.

- [ ] **Step 3:** Run `npm run test:i18n` and verify all 6 locale files pass validation.

- [ ] **Step 4:** Run `npm run dev` and manually verify:
  - Language switcher appears and works (all 7 locales load correctly)
  - Theme switcher works (dark/light/auto)
  - PID sim starts automatically on page load, scope scrolls continuously
  - Start/Stop/Reset/Restart buttons function correctly
  - Config changes restart the sim
  - Metrics tab shows "running..." while sim is active, shows computed metrics on Stop
  - 3D quad preview tilts based on gyro data
  - Advanced controls toggle works in pid-controls
  - Mobile nav hamburger collapses/expands
  - Scope supports touch pan and pinch zoom
  - All pages show translated text when switching locales
  - SEO meta tags update on locale change

---

## Dependency Graph

```
Phase 1 (i18n Foundation)
    |
    +---> Phase 2 (Translation Content)
    |         |
    +---> Phase 3 (PID Simulator Refactor)
    |         |
    |         +---> Phase 4 (3D Quad Preview)
    |
    +---> Phase 5 (UI Chrome & Responsive)
    |
    +---> Phase 6 (Integration & Polish) <--- requires Phases 1-5
```

Phases 2, 3, and 5 can run in parallel after Phase 1 completes.
Phase 4 depends on Phase 3.
Phase 6 depends on all prior phases.

## File Change Summary

**New files (9):**
| File | Phase | Lines (est) |
|---|---|---|
| `src/core/shared/i18n.ts` | 1 | 90 |
| `src/components/primitives/I18nController.ts` | 1 | 25 |
| `src/app/composables/useI18n.ts` | 1 | 35 |
| `src/locales/en.json` | 1 | 300 |
| `src/locales/{zh,de,ru,pt-BR,ja,ko}.json` (6 files) | 2 | 300 each |
| `scripts/check-i18n.ts` | 2 | 50 |
| `src/core/pid/sim-runner.ts` | 3 | 75 |
| `src/components/quad-preview/fpv-quad-preview-3d.ts` | 4 | 350 |
| `src/app/components/PrefsDropdown.vue` | 5 | 200 |
| `src/core/shared/format.ts` | 6 | 25 |

**Modified files (20+):**
| File | Phase | Change Size |
|---|---|---|
| `src/core/pid/simulate.ts` | 3 | Medium (extract stepSim) |
| `src/components/pid/pid-simulator.ts` | 3, 4, 6 | Large (continuous sim, HUD, 3D swap, i18n) |
| `src/components/pid/pid-controls.ts` | 3, 6 | Medium (reorder, toggle, i18n) |
| `src/main.ts` | 1 | Small (i18n bootstrap) |
| `src/app/seo.ts` | 1 | Small (rewrite to key mapping) |
| `src/app/router.ts` | 1 | Medium (i18n meta, subscribe) |
| `src/app/App.vue` | 5 | Medium (prefs dropdown, hamburger, i18n) |
| `src/components/scope/fpv-scope.ts` | 5 | Medium (touch events, responsive height) |
| `src/components/primitives/fpv-slider.ts` | 5 | Small (touch targets) |
| `src/components/primitives/fpv-number.ts` | 5 | Small (touch targets) |
| `src/components/primitives/fpv-select.ts` | 5 | Small (touch targets) |
| `src/components/primitives/fpv-tabs.ts` | 5 | Small (touch targets) |
| `src/components/primitives/index.ts` | 1 | Small (export I18nController) |
| `src/app/views/HomeView.vue` | 6 | Medium (i18n all cards) |
| `src/app/views/{Pid,Power,Rf,Motors,Convert,Blackbox,Tilt,Diff}View.vue` (8 files) | 6 | Small each (i18n title/subtitle) |
| `src/components/power/pack-calculator.ts` | 6 | Medium (i18n 32 strings) |
| `src/components/motors/motor-calculator.ts` | 6 | Medium (i18n 26 strings) |
| `src/components/rf/link-budget.ts` | 6 | Medium (i18n 28 strings) |
| `src/components/rf/vtx-checker.ts` | 6 | Small (i18n 15 strings) |
| `src/components/convert/unit-converter.ts` | 6 | Medium (i18n 24 strings) |
| `src/components/tilt/tilt-calculator.ts` | 6 | Small (i18n 10 strings, canvas special case) |
| `src/components/diff/tune-diff.ts` | 6 | Small (i18n 14 strings) |
| `src/components/blackbox/bbl-dropzone.ts` | 6 | Small (i18n 5 strings) |
| `src/components/blackbox/bbl-overlay.ts` | 6 | Medium (i18n 18 strings) |
| `package.json` | 2 | Small (add test:i18n script) |
