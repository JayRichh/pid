import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { tokenStyles } from '../primitives/tokens.css.js'
import { GAIN_PRESETS, PLANT_PRESETS, SCENARIO_PRESETS } from '@core/pid/presets'
import type { SimConfig, PlantModel, SetpointProfile, Disturbance } from '@core/pid/types'
import '../primitives/index.js'

@customElement('pid-controls')
export class PidControls extends LitElement {
  static styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }

      .sections {
        display: flex;
        flex-direction: column;
        gap: var(--fpv-space-md);
      }

      .rows {
        display: flex;
        flex-direction: column;
        gap: var(--fpv-space-sm);
      }

      .notch-inner {
        display: flex;
        flex-direction: column;
        gap: var(--fpv-space-sm);
        padding-top: var(--fpv-space-sm);
        padding-left: var(--fpv-space-md);
        border-left: 2px solid var(--fpv-border);
      }
    `,
  ]

  @property({ type: Object }) config!: SimConfig

  // ── helpers ──────────────────────────────────────────────────────────────

  private _emit(partial: Partial<SimConfig>) {
    this.dispatchEvent(
      new CustomEvent<Partial<SimConfig>>('config-change', {
        detail: { ...this.config, ...partial },
        bubbles: true,
        composed: true,
      })
    )
  }

  private _emitController(partial: Partial<SimConfig['controller']>) {
    this._emit({ controller: { ...this.config.controller, ...partial } })
  }

  private _emitGains(partial: Partial<SimConfig['controller']['gains']>) {
    this._emitController({ gains: { ...this.config.controller.gains, ...partial } })
  }

  private _emitFilters(partial: Partial<SimConfig['controller']['filters']>) {
    this._emitController({ filters: { ...this.config.controller.filters, ...partial } })
  }

  private _emitSetpoint(partial: Partial<SetpointProfile>) {
    const sp = { ...this.config.setpoint, ...partial } as SetpointProfile
    this._emit({ setpoint: sp })
  }

  // ── render helpers ────────────────────────────────────────────────────────

  private _renderGains() {
    const g = this.config.controller.gains
    return html`
      <fpv-card header="Gains">
        <div class="rows">
          <fpv-slider label="P Gain" .value=${g.kp} min="0" max="200" step="1"
            @value-change=${(e: CustomEvent<number>) => this._emitGains({ kp: e.detail })}></fpv-slider>
          <fpv-slider label="I Gain" .value=${g.ki} min="0" max="200" step="1"
            @value-change=${(e: CustomEvent<number>) => this._emitGains({ ki: e.detail })}></fpv-slider>
          <fpv-slider label="D Gain" .value=${g.kd} min="0" max="100" step="1"
            @value-change=${(e: CustomEvent<number>) => this._emitGains({ kd: e.detail })}></fpv-slider>
          <fpv-slider label="FF Gain" .value=${g.kff} min="0" max="200" step="1"
            @value-change=${(e: CustomEvent<number>) => this._emitGains({ kff: e.detail })}></fpv-slider>
        </div>
      </fpv-card>
    `
  }

  private _renderFilters() {
    const f = this.config.controller.filters
    const notchEnabled = !!f.notch
    return html`
      <fpv-card header="Filters">
        <div class="rows">
          <fpv-number label="Gyro LP" .value=${f.gyroLowpassHz} min="50" max="500" step="1" unit="Hz"
            @value-change=${(e: CustomEvent<number>) => this._emitFilters({ gyroLowpassHz: e.detail })}></fpv-number>
          <fpv-number label="D-Term LP" .value=${f.dtermLowpassHz} min="50" max="300" step="1" unit="Hz"
            @value-change=${(e: CustomEvent<number>) => this._emitFilters({ dtermLowpassHz: e.detail })}></fpv-number>
          <fpv-toggle label="Notch Filter" .checked=${notchEnabled}
            @toggle-change=${(e: CustomEvent<boolean>) => {
              if (e.detail) {
                this._emitFilters({ notch: { centerHz: 200, q: 2.5 } })
              } else {
                const { notch: _n, ...rest } = f
                this._emitController({ filters: rest })
              }
            }}></fpv-toggle>
          ${notchEnabled && f.notch ? html`
            <div class="notch-inner">
              <fpv-number label="Center" .value=${f.notch.centerHz} min="50" max="500" step="1" unit="Hz"
                @value-change=${(e: CustomEvent<number>) => this._emitFilters({ notch: { ...f.notch!, centerHz: e.detail } })}></fpv-number>
              <fpv-number label="Q" .value=${f.notch.q} min="0.1" max="10" step="0.1"
                @value-change=${(e: CustomEvent<number>) => this._emitFilters({ notch: { ...f.notch!, q: e.detail } })}></fpv-number>
            </div>
          ` : ''}
        </div>
      </fpv-card>
    `
  }

  private _renderLoopRate() {
    return html`
      <fpv-card header="Loop Rate">
        <fpv-select label="Rate"
          .value=${String(this.config.controller.loopRateHz)}
          .options=${[
            { value: '8000', label: '8 kHz' },
            { value: '4000', label: '4 kHz' },
            { value: '2000', label: '2 kHz' },
          ]}
          @select-change=${(e: CustomEvent<string>) =>
            this._emitController({ loopRateHz: Number(e.detail) })
          }></fpv-select>
      </fpv-card>
    `
  }

  private _renderPlant() {
    const plantKeys = Object.keys(PLANT_PRESETS)
    const p = this.config.plant

    // Detect if current plant matches any preset
    const matchedPreset = plantKeys.find(k => {
      const pp = PLANT_PRESETS[k]
      return pp.inertiaKgM2 === p.inertiaKgM2 &&
        pp.motorTimeConstantMs === p.motorTimeConstantMs &&
        pp.dragCoeff === p.dragCoeff &&
        pp.maxTorqueNm === p.maxTorqueNm
    })
    const selectedPlant = matchedPreset ?? 'Custom'

    const plantOptions = [
      ...plantKeys.map(k => ({ value: k, label: k })),
      { value: 'Custom', label: 'Custom' },
    ]

    return html`
      <fpv-card header="Plant">
        <div class="rows">
          <fpv-select label="Preset"
            .value=${selectedPlant}
            .options=${plantOptions}
            @select-change=${(e: CustomEvent<string>) => {
              if (e.detail !== 'Custom' && PLANT_PRESETS[e.detail]) {
                this._emit({ plant: { ...PLANT_PRESETS[e.detail] } })
              }
            }}></fpv-select>
          ${selectedPlant === 'Custom' ? html`
            <fpv-number label="Inertia" .value=${p.inertiaKgM2} min="0.00001" max="0.01" step="0.00001"
              @value-change=${(e: CustomEvent<number>) => this._emit({ plant: { ...p, inertiaKgM2: e.detail } })}></fpv-number>
            <fpv-number label="Motor τ" .value=${p.motorTimeConstantMs} min="1" max="50" step="0.5" unit="ms"
              @value-change=${(e: CustomEvent<number>) => this._emit({ plant: { ...p, motorTimeConstantMs: e.detail } })}></fpv-number>
            <fpv-number label="Drag" .value=${p.dragCoeff} min="0" max="0.1" step="0.001"
              @value-change=${(e: CustomEvent<number>) => this._emit({ plant: { ...p, dragCoeff: e.detail } })}></fpv-number>
            <fpv-number label="Max Torque" .value=${p.maxTorqueNm} min="0.01" max="2" step="0.01" unit="Nm"
              @value-change=${(e: CustomEvent<number>) => this._emit({ plant: { ...p, maxTorqueNm: e.detail } })}></fpv-number>
          ` : ''}
        </div>
      </fpv-card>
    `
  }

  private _renderSetpoint() {
    const sp = this.config.setpoint
    const profileOptions = [
      { value: 'step', label: 'Step' },
      { value: 'ramp', label: 'Ramp' },
      { value: 'sine', label: 'Sine' },
    ]
    return html`
      <fpv-card header="Setpoint">
        <div class="rows">
          <fpv-select label="Profile"
            .value=${sp.kind === 'trace' ? 'step' : sp.kind}
            .options=${profileOptions}
            @select-change=${(e: CustomEvent<string>) => {
              const kind = e.detail as 'step' | 'ramp' | 'sine'
              const amp = 'amplitudeDegS' in sp ? sp.amplitudeDegS : 200
              if (kind === 'step') {
                this._emit({ setpoint: { kind: 'step', amplitudeDegS: amp, startMs: 100 } })
              } else if (kind === 'ramp') {
                this._emit({ setpoint: { kind: 'ramp', amplitudeDegS: amp, durationMs: 200, startMs: 100 } })
              } else {
                this._emit({ setpoint: { kind: 'sine', amplitudeDegS: amp, frequencyHz: 5 } })
              }
            }}></fpv-select>
          ${'amplitudeDegS' in sp ? html`
            <fpv-number label="Amplitude" .value=${sp.amplitudeDegS} min="0" max="2000" step="10" unit="°/s"
              @value-change=${(e: CustomEvent<number>) => this._emitSetpoint({ amplitudeDegS: e.detail })}></fpv-number>
          ` : ''}
          ${sp.kind === 'step' ? html`
            <fpv-number label="Start" .value=${sp.startMs} min="0" max="1000" step="10" unit="ms"
              @value-change=${(e: CustomEvent<number>) => this._emitSetpoint({ startMs: e.detail })}></fpv-number>
          ` : ''}
          ${sp.kind === 'ramp' ? html`
            <fpv-number label="Duration" .value=${sp.durationMs} min="10" max="2000" step="10" unit="ms"
              @value-change=${(e: CustomEvent<number>) => this._emitSetpoint({ durationMs: e.detail })}></fpv-number>
            <fpv-number label="Start" .value=${sp.startMs} min="0" max="1000" step="10" unit="ms"
              @value-change=${(e: CustomEvent<number>) => this._emitSetpoint({ startMs: e.detail })}></fpv-number>
          ` : ''}
          ${sp.kind === 'sine' ? html`
            <fpv-number label="Frequency" .value=${sp.frequencyHz} min="0.1" max="50" step="0.1" unit="Hz"
              @value-change=${(e: CustomEvent<number>) => this._emitSetpoint({ frequencyHz: e.detail })}></fpv-number>
          ` : ''}
        </div>
      </fpv-card>
    `
  }

  private _renderOptions() {
    const c = this.config.controller
    return html`
      <fpv-card header="Options">
        <div class="rows">
          <fpv-toggle label="I-Term Relax" .checked=${c.iTermRelax}
            @toggle-change=${(e: CustomEvent<boolean>) => this._emitController({ iTermRelax: e.detail })}></fpv-toggle>
          <fpv-number label="Anti-Windup" .value=${c.iTermLimitNm} min="0" max="2" step="0.05" unit="Nm"
            @value-change=${(e: CustomEvent<number>) => this._emitController({ iTermLimitNm: e.detail })}></fpv-number>
        </div>
      </fpv-card>
    `
  }

  private _renderPresets() {
    const gainKeys = Object.keys(GAIN_PRESETS)
    const scenarioKeys = Object.keys(SCENARIO_PRESETS)
    return html`
      <fpv-card header="Presets">
        <div class="rows">
          <fpv-select label="Gains"
            value=""
            .options=${[{ value: '', label: '— Apply Gain Preset —' }, ...gainKeys.map(k => ({ value: k, label: k }))]}
            @select-change=${(e: CustomEvent<string>) => {
              if (e.detail && GAIN_PRESETS[e.detail]) {
                this._emitGains({ ...GAIN_PRESETS[e.detail] })
              }
            }}></fpv-select>
          <fpv-select label="Scenario"
            value=""
            .options=${[{ value: '', label: '— Apply Scenario —' }, ...scenarioKeys.map(k => ({ value: k, label: k }))]}
            @select-change=${(e: CustomEvent<string>) => {
              if (e.detail && SCENARIO_PRESETS[e.detail]) {
                this._emit({ ...SCENARIO_PRESETS[e.detail] })
              }
            }}></fpv-select>
        </div>
      </fpv-card>
    `
  }

  private _renderDisturbance() {
    const dists = this.config.disturbances
    const enabled = dists.length > 0
    const d: Disturbance = enabled ? dists[0] : { torqueNm: 0.3, startMs: 500, durationMs: 20, kind: 'impulse' }
    return html`
      <fpv-card header="Disturbance">
        <div class="rows">
          <fpv-toggle label="Enable" .checked=${enabled}
            @toggle-change=${(e: CustomEvent<boolean>) => {
              if (e.detail) {
                this._emit({ disturbances: [{ torqueNm: 0.3, startMs: 500, durationMs: 20, kind: 'impulse' }] })
              } else {
                this._emit({ disturbances: [] })
              }
            }}></fpv-toggle>
          ${enabled ? html`
            <fpv-number label="Torque" .value=${d.torqueNm} min="0" max="5" step="0.05" unit="Nm"
              @value-change=${(e: CustomEvent<number>) =>
                this._emit({ disturbances: [{ ...d, torqueNm: e.detail }] })}></fpv-number>
            <fpv-number label="Time" .value=${d.startMs} min="0" max="5000" step="10" unit="ms"
              @value-change=${(e: CustomEvent<number>) =>
                this._emit({ disturbances: [{ ...d, startMs: e.detail }] })}></fpv-number>
            <fpv-select label="Kind"
              .value=${d.kind}
              .options=${[{ value: 'impulse', label: 'Impulse' }, { value: 'step', label: 'Step' }]}
              @select-change=${(e: CustomEvent<string>) =>
                this._emit({ disturbances: [{ ...d, kind: e.detail as 'impulse' | 'step' }] })}></fpv-select>
          ` : ''}
        </div>
      </fpv-card>
    `
  }

  render() {
    if (!this.config) return html``
    return html`
      <div class="sections">
        ${this._renderGains()}
        ${this._renderFilters()}
        ${this._renderLoopRate()}
        ${this._renderPlant()}
        ${this._renderSetpoint()}
        ${this._renderOptions()}
        ${this._renderPresets()}
        ${this._renderDisturbance()}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pid-controls': PidControls
  }
}
