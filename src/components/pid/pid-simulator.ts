import { LitElement, html, css } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { tokenStyles } from '../primitives/tokens.css.js'
import { I18nController } from '../primitives/I18nController.js'
import { SimRunner } from '@core/pid/sim-runner'
import { computeMetrics } from '@core/pid/metrics'
import { GAIN_PRESETS, PLANT_PRESETS } from '@core/pid/presets'
import type { SimConfig, SimResult, SimSample } from '@core/pid/types'
import type { ScopeSeries } from '../scope/fpv-scope.js'
import '../primitives/index.js'
import '../scope/fpv-scope.js'
import '../quad-preview/fpv-quad-preview-3d.js'
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

        .controls-col {
          position: static;
          max-height: none;
          overflow-y: visible;
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

      fpv-quad-preview-3d {
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

  // ── i18n ──────────────────────────────────────────────────────────────────
  private _i18n = new I18nController(this)

  // ── State ──────────────────────────────────────────────────────────────────
  @state() private _config: SimConfig = DEFAULT_CONFIG
  @state() private _result: SimResult | null = null
  @state() private _activeTab = 0
  @state() private _running = true
  @state() private _elapsedMs = 0

  // ── Continuous simulation internals ───────────────────────────────────────
  private _rafId = 0
  private _lastFrameTs = 0
  private _runner: SimRunner | null = null
  private _rollingBuf: SimSample[] = []
  private _fullSamples: SimSample[] = []
  private _windowMs = 2000

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  firstUpdated() {
    this._resetSim()
    this._startLoop()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    cancelAnimationFrame(this._rafId)
  }

  // ── Continuous simulation ─────────────────────────────────────────────────

  private _resetSim() {
    this._runner = new SimRunner(this._config)
    this._rollingBuf = []
    this._fullSamples = []
    this._elapsedMs = 0
  }

  private _startLoop() {
    // Idempotent: cancel any existing rAF chain first
    cancelAnimationFrame(this._rafId)
    this._running = true
    this._lastFrameTs = performance.now()
    this._tick()
  }

  private _stopLoop() {
    this._running = false
    cancelAnimationFrame(this._rafId)

    // Compute metrics from accumulated full-run samples
    let spAmplitude = 0
    const sp = this._config.setpoint
    if (sp.kind === 'step' || sp.kind === 'ramp' || sp.kind === 'sine') {
      spAmplitude = sp.amplitudeDegS
    } else if (sp.kind === 'trace') {
      spAmplitude = sp.samplesDegS.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    }
    const metrics = computeMetrics(this._fullSamples, spAmplitude)
    this._result = { samples: this._fullSamples, metrics }
  }

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

  // ── HUD button handlers ───────────────────────────────────────────────────

  private _onStart() {
    this._startLoop()
  }

  private _onStop() {
    this._stopLoop()
  }

  private _onReset() {
    this._stopLoop()
    this._resetSim()
  }

  private _onRestart() {
    this._stopLoop()
    this._resetSim()
    this._startLoop()
  }

  // ── Config change ─────────────────────────────────────────────────────────

  private _onConfigChange(e: CustomEvent<Partial<SimConfig>>) {
    e.stopPropagation()
    this._config = e.detail as SimConfig
    this._resetSim()
    if (this._running) {
      this._startLoop()
    }
  }

  // ── Scope series builders ─────────────────────────────────────────────────

  private _buildResponseSeries(): ScopeSeries[] {
    const samples = this._rollingBuf
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
    const samples = this._rollingBuf
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
    const samples = this._rollingBuf
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
    if (this._running) {
      return html`<div class="metric-null">${this._i18n.t('common.running')}</div>`
    }

    const m = this._result?.metrics
    if (!m) return html`<div class="metric-null">${this._i18n.t('pid.loading')}</div>`

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

    return html`
      <div class="hud-toolbar">
        ${this._running
          ? html`<button class="hud-btn" @click=${this._onStop}>${this._i18n.t('common.stop')}</button>`
          : html`<button class="hud-btn" @click=${this._onStart}>${this._i18n.t('common.start')}</button>`
        }
        <button class="hud-btn" @click=${this._onReset}>${this._i18n.t('common.reset')}</button>
        <button class="hud-btn" @click=${this._onRestart}>${this._i18n.t('common.restart')}</button>
        <span class="hud-time">${this._i18n.t('pid.hud_time_label', { seconds: (this._elapsedMs / 1000).toFixed(1) })}</span>
      </div>

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
                  .timeMs=${this._windowMs}
                ></fpv-scope>
              ` : ''}
              ${this._activeTab === 1 ? html`
                <fpv-scope
                  .series=${this._buildTermsSeries()}
                  .timeMs=${this._windowMs}
                ></fpv-scope>
              ` : ''}
              ${this._activeTab === 2 ? html`
                ${this._renderMetrics()}
              ` : ''}
            </div>
          </fpv-card>

          <fpv-quad-preview-3d
            .motorOutputs=${quad.motorOutputs}
            .setpointDegS=${quad.setpointDegS}
            .gyroDegS=${quad.gyroDegS}
            .errorDegS=${quad.errorDegS}
            .saturated=${quad.saturated}
            .axis=${'roll'}
          ></fpv-quad-preview-3d>
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
