import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { tokenStyles } from './tokens.css.js'

@customElement('fpv-slider')
export class FpvSlider extends LitElement {
  static styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }

      .row {
        display: flex;
        align-items: center;
        gap: var(--fpv-space-sm);
        min-height: 44px;
      }

      .label {
        min-width: 80px;
        font-size: var(--fpv-font-label);
        color: var(--fpv-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        flex-shrink: 0;
      }

      input[type='range'] {
        flex: 1;
        appearance: none;
        height: 4px;
        background: var(--fpv-border);
        border-radius: 999px;
        outline: none;
        cursor: pointer;
      }

      input[type='range']::-webkit-slider-thumb {
        appearance: none;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: var(--fpv-primary);
        cursor: pointer;
        transition: transform 0.1s;
      }

      input[type='range']::-webkit-slider-thumb:hover {
        transform: scale(1.2);
      }

      input[type='range']::-moz-range-thumb {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: var(--fpv-primary);
        border: none;
        cursor: pointer;
      }

      .value {
        font-family: var(--fpv-font-mono);
        font-size: var(--fpv-font-label);
        color: var(--fpv-text);
        min-width: 48px;
        text-align: right;
        flex-shrink: 0;
      }
    `,
  ]

  @property({ type: String }) label = ''
  @property({ type: Number }) value = 0
  @property({ type: Number }) min = 0
  @property({ type: Number }) max = 100
  @property({ type: Number }) step = 1
  @property({ type: String }) unit = ''

  private _onInput(e: Event) {
    const input = e.target as HTMLInputElement
    const newValue = Number(input.value)
    this.value = newValue
    this.dispatchEvent(
      new CustomEvent('value-change', {
        detail: newValue,
        bubbles: true,
        composed: true,
      })
    )
  }

  render() {
    return html`
      <div class="row">
        <span class="label">${this.label}</span>
        <input
          type="range"
          .value=${String(this.value)}
          min=${this.min}
          max=${this.max}
          step=${this.step}
          @input=${this._onInput}
        />
        <span class="value">${this.value}${this.unit}</span>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'fpv-slider': FpvSlider
  }
}
