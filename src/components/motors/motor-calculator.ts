import { LitElement, html, css } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { tokenStyles } from '../primitives/tokens.css.js'
import { computeSizing, MOTOR_LIBRARY, PROP_LIBRARY } from '@core/motors/sizing'
import type { MotorSpec, PropSpec, SizingResult } from '@core/motors/types'
import '../primitives/index.js'

@customElement('motor-calculator')
export class MotorCalculator extends LitElement {
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

      @media (max-width: 768px) {
        .layout {
          grid-template-columns: 1fr;
        }
      }

      .controls {
        display: flex;
        flex-direction: column;
        gap: var(--fpv-space-md);
      }

      .rows {
        display: flex;
        flex-direction: column;
        gap: var(--fpv-space-sm);
      }

      .results {
        display: flex;
        flex-direction: column;
        gap: var(--fpv-space-md);
      }

      .result-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--fpv-space-xs, 4px) 0;
        border-bottom: 1px solid var(--fpv-border);
      }

      .result-row:last-child {
        border-bottom: none;
      }

      .result-label {
        font-size: var(--fpv-font-label);
        color: var(--fpv-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .result-value {
        font-family: var(--fpv-font-mono);
        font-size: var(--fpv-font-body);
        color: var(--fpv-text);
        text-align: right;
      }

      .result-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--fpv-space-sm);
      }

      .disclaimer {
        font-size: var(--fpv-font-label);
        color: var(--fpv-text-muted);
        font-style: italic;
        margin-top: var(--fpv-space-sm);
      }
    `,
  ]

  // ── State ──────────────────────────────────────────────────────────────────

  @state() private _motorKey = 'iFlight 2806.5 1300KV'
  @state() private _propKey = 'Gemfan 7040'
  @state() private _useCustomMotor = false
  @state() private _useCustomProp = false
  @state() private _cellCount = 6
  @state() private _auwG = 1200
  @state() private _motorCount = 4

  // Custom motor fields
  @state() private _customMotorKv = 1300
  @state() private _customMotorMaxA = 42
  @state() private _customMotorWeightG = 38

  // Custom prop fields
  @state() private _customPropDiam = 7
  @state() private _customPropPitch = 4

  // ── Computed ───────────────────────────────────────────────────────────────

  private get _motor(): MotorSpec {
    if (this._useCustomMotor) {
      return {
        name: 'Custom',
        kv: this._customMotorKv,
        maxCurrentA: this._customMotorMaxA,
        weightG: this._customMotorWeightG,
        recommendedProps: [],
      }
    }
    return MOTOR_LIBRARY[this._motorKey]
  }

  private get _prop(): PropSpec {
    if (this._useCustomProp) {
      return {
        name: 'Custom',
        diameterInch: this._customPropDiam,
        pitchInch: this._customPropPitch,
      }
    }
    return PROP_LIBRARY[this._propKey]
  }

  private get _result(): SizingResult {
    return computeSizing({
      motor: this._motor,
      prop: this._prop,
      cellCount: this._cellCount,
      auwG: this._auwG,
      motorCount: this._motorCount,
    })
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private _twVariant(tw: number): 'success' | 'warning' | 'error' {
    if (tw >= 2) return 'success'
    if (tw >= 1.5) return 'warning'
    return 'error'
  }

  // ── Render sections ────────────────────────────────────────────────────────

  private _renderMotorSection() {
    const motorOptions = [
      { value: '__custom__', label: 'Custom...' },
      ...Object.keys(MOTOR_LIBRARY).map((k) => ({ value: k, label: k })),
    ]

    return html`
      <fpv-card header="Motor">
        <div class="rows">
          <fpv-select
            label="Motor"
            .value=${this._useCustomMotor ? '__custom__' : this._motorKey}
            .options=${motorOptions}
            @select-change=${(e: CustomEvent<string>) => {
              if (e.detail === '__custom__') {
                this._useCustomMotor = true
              } else {
                this._useCustomMotor = false
                this._motorKey = e.detail
              }
            }}
          ></fpv-select>
          ${this._useCustomMotor
            ? html`
                <fpv-number
                  label="KV"
                  .value=${this._customMotorKv}
                  min="50"
                  max="10000"
                  step="50"
                  unit="KV"
                  @value-change=${(e: CustomEvent<number>) => (this._customMotorKv = e.detail)}
                ></fpv-number>
                <fpv-number
                  label="Max I"
                  .value=${this._customMotorMaxA}
                  min="1"
                  max="120"
                  step="1"
                  unit="A"
                  @value-change=${(e: CustomEvent<number>) => (this._customMotorMaxA = e.detail)}
                ></fpv-number>
                <fpv-number
                  label="Weight"
                  .value=${this._customMotorWeightG}
                  min="1"
                  max="500"
                  step="1"
                  unit="g"
                  @value-change=${(e: CustomEvent<number>) => (this._customMotorWeightG = e.detail)}
                ></fpv-number>
              `
            : ''}
        </div>
      </fpv-card>
    `
  }

  private _renderPropSection() {
    const propOptions = [
      { value: '__custom__', label: 'Custom...' },
      ...Object.keys(PROP_LIBRARY).map((k) => ({ value: k, label: k })),
    ]

    return html`
      <fpv-card header="Propeller">
        <div class="rows">
          <fpv-select
            label="Prop"
            .value=${this._useCustomProp ? '__custom__' : this._propKey}
            .options=${propOptions}
            @select-change=${(e: CustomEvent<string>) => {
              if (e.detail === '__custom__') {
                this._useCustomProp = true
              } else {
                this._useCustomProp = false
                this._propKey = e.detail
              }
            }}
          ></fpv-select>
          ${this._useCustomProp
            ? html`
                <fpv-number
                  label="Diameter"
                  .value=${this._customPropDiam}
                  min="1"
                  max="30"
                  step="0.1"
                  unit="in"
                  @value-change=${(e: CustomEvent<number>) => (this._customPropDiam = e.detail)}
                ></fpv-number>
                <fpv-number
                  label="Pitch"
                  .value=${this._customPropPitch}
                  min="0.5"
                  max="20"
                  step="0.1"
                  unit="in"
                  @value-change=${(e: CustomEvent<number>) => (this._customPropPitch = e.detail)}
                ></fpv-number>
              `
            : ''}
        </div>
      </fpv-card>
    `
  }

  private _renderSetupSection() {
    return html`
      <fpv-card header="Setup">
        <div class="rows">
          <fpv-number
            label="Cell Count"
            .value=${this._cellCount}
            min="1"
            max="14"
            step="1"
            unit="S"
            @value-change=${(e: CustomEvent<number>) => (this._cellCount = e.detail)}
          ></fpv-number>
          <fpv-number
            label="AUW"
            .value=${this._auwG}
            min="50"
            max="30000"
            step="10"
            unit="g"
            @value-change=${(e: CustomEvent<number>) => (this._auwG = e.detail)}
          ></fpv-number>
          <fpv-select
            label="Motors"
            .value=${String(this._motorCount)}
            .options=${[
              { value: '3', label: '3 motors (tricopter)' },
              { value: '4', label: '4 motors (quad)' },
              { value: '6', label: '6 motors (hex)' },
              { value: '8', label: '8 motors (octo)' },
            ]}
            @select-change=${(e: CustomEvent<string>) => (this._motorCount = Number(e.detail))}
          ></fpv-select>
        </div>
      </fpv-card>
    `
  }

  private _renderResults() {
    const r = this._result
    const twVariant = this._twVariant(r.thrustToWeight)

    return html`
      <fpv-card header="Results">
        <div class="result-header">
          <span class="result-label">Thrust / Weight</span>
          <fpv-badge .variant=${twVariant}>${r.thrustToWeight.toFixed(2)}:1</fpv-badge>
        </div>
        <div class="rows">
          <div class="result-row">
            <span class="result-label">Nominal Voltage</span>
            <span class="result-value">${r.nominalV.toFixed(1)} V</span>
          </div>
          <div class="result-row">
            <span class="result-label">Max RPM</span>
            <span class="result-value">${r.maxRpm.toLocaleString()} RPM</span>
          </div>
          <div class="result-row">
            <span class="result-label">Thrust / Motor</span>
            <span class="result-value">${r.thrustPerMotorG} g</span>
          </div>
          <div class="result-row">
            <span class="result-label">Total Thrust</span>
            <span class="result-value">${r.totalThrustG} g</span>
          </div>
          <div class="result-row">
            <span class="result-label">Hover Throttle</span>
            <span class="result-value">${r.hoverThrottlePct} %</span>
          </div>
          <div class="result-row">
            <span class="result-label">Hover I / Motor</span>
            <span class="result-value">${r.hoverCurrentPerMotorA} A</span>
          </div>
          <div class="result-row">
            <span class="result-label">Total Hover I</span>
            <span class="result-value">${r.totalHoverCurrentA} A</span>
          </div>
          <div class="result-row">
            <span class="result-label">Efficiency</span>
            <span class="result-value">${r.efficiencyGPerW} g/W</span>
          </div>
          ${r.recommendedPropRange
            ? html`
                <div class="result-row">
                  <span class="result-label">Rec. Props</span>
                  <span class="result-value">${r.recommendedPropRange}</span>
                </div>
              `
            : ''}
        </div>
        <p class="disclaimer">
          Thrust is estimated — verify against manufacturer dyno data before building.
        </p>
      </fpv-card>
    `
  }

  render() {
    return html`
      <div class="layout">
        <div class="controls">
          ${this._renderMotorSection()}
          ${this._renderPropSection()}
          ${this._renderSetupSection()}
        </div>
        <div class="results">
          ${this._renderResults()}
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'motor-calculator': MotorCalculator
  }
}
