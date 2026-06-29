import { LitElement, html, css } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { tokenStyles } from '../primitives/tokens.css.js'
import { simulate } from '@core/pid/simulate'
import { GAIN_PRESETS, PLANT_PRESETS } from '@core/pid/presets'
import type { SimConfig, SimResult } from '@core/pid/types'
import type { ScopeSeries } from '../scope/fpv-scope.js'
import '../primitives/index.js'
import '../scope/fpv-scope.js'
import '../quad-preview/fpv-quad-preview.js'
import './pid-controls.js'

// ── Default config ────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: SimConfig = {
  controller: {
    gains: { ...GAIN_PRESETS['BF 4.4 Default'] },
    filters: { gyroLowpassHz: 100, dtermLowpassHz: 70 },
    loopRateHz: 4000,
    iTermLimitNm: 0.3,
    iTermRelax: true,
  },
  plant: { ...PLANT_PRESETS['5" Freestyle'] },
  noise: { kind: 'gaussian', gaussianStdDegS: 0, seed: 42 },
  setpoint: { kind: 'step', amplitudeDegS: 200, startMs: 100 },
  disturbances: [],
  durationMs: 1000,
}

// ── Series colors ─────────────────────────────────────────────────────────────

const COLOR_SETPOINT = '#00d4aa'
const COLOR_GYRO     = '#4488ff'
const COLOR_ERROR    = '#ff4466'
const COLOR_P        = '#ffaa33'
const COLOR_I        = '#aa44ff'
const COLOR_D        = '#44ccaa'
const COLOR_MOTOR    = '#888888'

// ── Component ─────────────────────────────────────────────────────────────────

@customElement('pid-simulator')
export class PidSimulator extends LitElement {
  static styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }

      .layout {
        display: grid;
        grid-template-columns: 320px 1fr;
        gap: var(--fpv-space-lg);
        align-items: start;
      }

      @media (max-width: 900px) {
        .layout {
          grid-template-columns: 1fr;
        }
      }

      .controls-col {
        position: sticky;
        top: var(--fpv-space-md);
        max-height: calc(100vh - var(--fpv-space-xl));
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: var(--fpv-border) transparent;
      }

      .viz-col {
        display: flex;
        flex-direction: column;
        gap: var(--fpv-space-md);
        min-width: 0;
      }

      .tab-panel {
        min-height: 340px;
      }

      fpv-scope {
        width: 100%;
        min-height: 300px;
      }

      fpv-quad-preview {
        height: 220px;
      }

      .metrics-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: var(--fpv-space-sm);
      }

      .metric-card {
        background: var(--fpv-surface-2);
        border: 1px solid var(--fpv-border);
        border-radius: var(--fpv-radius-md);
        padding: var(--fpv-space-md);
        display: flex;
        flex-direction: column;
        gap: var(--fpv-space-xs);
      }

      .metric-label {
        font-size: var(--fpv-font-label);
        color: var(--fpv-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .metric-value {
        font-family: var(--fpv-font-mono);
        font-size: var(--fpv-font-body);
        color: var(--fpv-text);
        font-weight: 600;
      }

      .metric-null {
        color: var(--fpv-text-muted);
        font-style: italic;
      }
    `,
  ]

  @state() private _config: SimConfig = DEFAULT_CONFIG
  @state() private _result: SimResult | null = null
  @state() private _activeTab = 0

  private _debounceTimer = 0

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  firstUpdated() {
    this._runSim()
  }

  // ── Simulation ────────────────────────────────────────────────────────────

  private _runSim() {
    this._result = simulate(this._config)
  }

  private _scheduleRun() {
    clearTimeout(this._debounceTimer)
    this._debounceTimer = window.setTimeout(() => this._runSim(), 16)
  }

  private _onConfigChange(e: CustomEvent<Partial<SimConfig>>) {
    e.stopPropagation()
    this._config = e.detail as SimConfig
    this._scheduleRun()
  }

  // ── Scope series builders ─────────────────────────────────────────────────

  private _buildResponseSeries(): ScopeSeries[] {
    const samples = this._result?.samples ?? []
    if (samples.length === 0) return []
    const n = samples.length
    const setpoint = new Float32Array(n)
    const gyro     = new Float32Array(n)
    const error    = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      setpoint[i] = samples[i].setpointDegS
      gyro[i]     = samples[i].gyroDegS
      error[i]    = samples[i].errorDegS
    }
    return [
      { name: 'Setpoint', color: COLOR_SETPOINT, data: setpoint, visible: true },
      { name: 'Gyro',     color: COLOR_GYRO,     data: gyro,     visible: true },
      { name: 'Error',    color: COLOR_ERROR,     data: error,    visible: true },
    ]
  }

  private _buildTermsSeries(): ScopeSeries[] {
    const samples = this._result?.samples ?? []
    if (samples.length === 0) return []
    const n = samples.length
    const p     = new Float32Array(n)
    const iArr  = new Float32Array(n)
    const d     = new Float32Array(n)
    const motor = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      p[i]     = samples[i].pTerm
      iArr[i]  = samples[i].iTerm
      d[i]     = samples[i].dTerm
      motor[i] = samples[i].motorOutput
    }
    return [
      { name: 'P-term', color: COLOR_P,     data: p,     visible: true },
      { name: 'I-term', color: COLOR_I,     data: iArr,  visible: true },
      { name: 'D-term', color: COLOR_D,     data: d,     visible: true },
      { name: 'Motor',  color: COLOR_MOTOR, data: motor, visible: false },
    ]
  }

  // ── Quad preview helpers ──────────────────────────────────────────────────

  private _getQuadProps() {
    const samples = this._result?.samples ?? []
    if (samples.length === 0) {
      return { motorOutputs: [0, 0, 0, 0], setpointDegS: 0, gyroDegS: 0, errorDegS: 0, saturated: false }
    }
    const last = samples[samples.length - 1]
    // Normalise motor output to [-1, 1] for display
    const maxT = this._config.plant.maxTorqueNm || 1
    const m = Math.max(-1, Math.min(1, last.motorOutput / maxT))
    // Roll convention: left motors (M1, M3) +, right motors (M2, M4) -
    const motorOutputs = [m / 2, -m / 2, m / 2, -m / 2]
    return {
      motorOutputs,
      setpointDegS: last.setpointDegS,
      gyroDegS: last.gyroDegS,
      errorDegS: last.errorDegS,
      saturated: last.saturated,
    }
  }

  // ── Metrics rendering ─────────────────────────────────────────────────────

  private _renderMetrics() {
    const m = this._result?.metrics
    if (!m) return html`<div class="metric-null">Run simulation first</div>`

    const fmt = (v: number | null, unit: string, digits = 1) =>
      v === null
        ? html`<span class="metric-null">N/A</span>`
        : html`<span>${v.toFixed(digits)} ${unit}</span>`

    const badgeVariant = (v: number | null, good: number, warn: number): 'success' | 'warning' | 'error' => {
      if (v === null) return 'info'
      if (v <= good) return 'success'
      if (v <= warn) return 'warning'
      return 'error'
    }

    return html`
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-label">Rise Time</div>
          <div class="metric-value">${fmt(m.riseTimeMs, 'ms')}</div>
          ${m.riseTimeMs !== null ? html`<fpv-badge .variant=${badgeVariant(m.riseTimeMs, 30, 80)}>
            ${m.riseTimeMs <= 30 ? 'Fast' : m.riseTimeMs <= 80 ? 'OK' : 'Slow'}
          </fpv-badge>` : ''}
        </div>
        <div class="metric-card">
          <div class="metric-label">Overshoot</div>
          <div class="metric-value">${fmt(m.overshootPct, '%')}</div>
          ${m.overshootPct !== null ? html`<fpv-badge .variant=${badgeVariant(m.overshootPct, 5, 20)}>
            ${m.overshootPct <= 5 ? 'Good' : m.overshootPct <= 20 ? 'Moderate' : 'High'}
          </fpv-badge>` : ''}
        </div>
        <div class="metric-card">
          <div class="metric-label">Settling Time</div>
          <div class="metric-value">${fmt(m.settlingTimeMs, 'ms')}</div>
          ${m.settlingTimeMs !== null ? html`<fpv-badge .variant=${badgeVariant(m.settlingTimeMs, 100, 300)}>
            ${m.settlingTimeMs <= 100 ? 'Fast' : m.settlingTimeMs <= 300 ? 'OK' : 'Slow'}
          </fpv-badge>` : ''}
        </div>
        <div class="metric-card">
          <div class="metric-label">SS Error</div>
          <div class="metric-value">${fmt(m.steadyStateErrorDegS, '°/s', 2)}</div>
          ${m.steadyStateErrorDegS !== null ? html`<fpv-badge .variant=${badgeVariant(Math.abs(m.steadyStateErrorDegS), 2, 10)}>
            ${Math.abs(m.steadyStateErrorDegS) <= 2 ? 'Good' : Math.abs(m.steadyStateErrorDegS) <= 10 ? 'Fair' : 'Poor'}
          </fpv-badge>` : ''}
        </div>
        <div class="metric-card">
          <div class="metric-label">Oscillation</div>
          <div class="metric-value">${fmt(m.oscillationHz, 'Hz')}</div>
          ${m.oscillationHz !== null ? html`<fpv-badge .variant=${badgeVariant(m.oscillationHz, 5, 20)}>
            ${m.oscillationHz <= 5 ? 'Stable' : m.oscillationHz <= 20 ? 'Moderate' : 'Oscillating'}
          </fpv-badge>` : ''}
        </div>
        <div class="metric-card">
          <div class="metric-label">Motor RMS</div>
          <div class="metric-value">${m.motorActivityRms.toFixed(3)} Nm</div>
          <fpv-badge .variant=${badgeVariant(m.motorActivityRms, 0.1, 0.3)}>
            ${m.motorActivityRms <= 0.1 ? 'Smooth' : m.motorActivityRms <= 0.3 ? 'Normal' : 'Active'}
          </fpv-badge>
        </div>
      </div>
    `
  }

  // ── Render ────────────────────────────────────────────────────────────────

  render() {
    const quad = this._getQuadProps()
    const durationMs = this._config.durationMs

    return html`
      <div class="layout">
        <div class="controls-col">
          <pid-controls
            .config=${this._config}
            @config-change=${this._onConfigChange}
          ></pid-controls>
        </div>

        <div class="viz-col">
          <fpv-card>
            <fpv-tabs
              .tabs=${['Response', 'Terms', 'Metrics']}
              .active=${this._activeTab}
              @tab-change=${(e: CustomEvent<number>) => { this._activeTab = e.detail }}
            ></fpv-tabs>
            <div class="tab-panel">
              ${this._activeTab === 0 ? html`
                <fpv-scope
                  .series=${this._buildResponseSeries()}
                  .timeMs=${durationMs}
                ></fpv-scope>
              ` : ''}
              ${this._activeTab === 1 ? html`
                <fpv-scope
                  .series=${this._buildTermsSeries()}
                  .timeMs=${durationMs}
                ></fpv-scope>
              ` : ''}
              ${this._activeTab === 2 ? html`
                ${this._renderMetrics()}
              ` : ''}
            </div>
          </fpv-card>

          <fpv-quad-preview
            .motorOutputs=${quad.motorOutputs}
            .setpointDegS=${quad.setpointDegS}
            .gyroDegS=${quad.gyroDegS}
            .errorDegS=${quad.errorDegS}
            .saturated=${quad.saturated}
          ></fpv-quad-preview>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pid-simulator': PidSimulator
  }
}
