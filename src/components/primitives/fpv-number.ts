import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { tokenStyles } from './tokens.css.js'

@customElement('fpv-number')
export class FpvNumber extends LitElement {
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
      }

      .label {
        min-width: 80px;
        font-size: var(--fpv-font-label);
        color: var(--fpv-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        flex-shrink: 0;
      }

      .input-wrap {
        flex: 1;
        display: flex;
        align-items: center;
        background: var(--fpv-surface-2);
        border: 1px solid var(--fpv-border);
        border-radius: var(--fpv-radius-sm);
        padding: 6px var(--fpv-space-sm);
        min-height: 44px;
        box-sizing: border-box;
        transition: border-color 0.15s;
      }

      .input-wrap:focus-within {
        border-color: var(--fpv-primary);
      }

      input[type='number'] {
        flex: 1;
        background: transparent;
        border: none;
        outline: none;
        color: var(--fpv-text);
        font-family: var(--fpv-font-mono);
        font-size: var(--fpv-font-body);
        min-width: 0;
        padding: 0;
      }

      input[type='number']::-webkit-inner-spin-button,
      input[type='number']::-webkit-outer-spin-button {
        opacity: 0.4;
      }

      .unit {
        font-family: var(--fpv-font-mono);
        font-size: var(--fpv-font-label);
        color: var(--fpv-text-muted);
        margin-left: 2px;
        flex-shrink: 0;
      }
    `,
  ]

  @property({ type: String }) label = ''
  @property({ type: Number }) value = 0
  @property({ type: Number }) min = -Infinity
  @property({ type: Number }) max = Infinity
  @property({ type: Number }) step = 1
  @property({ type: String }) unit = ''

  private _onChange(e: Event) {
    const input = e.target as HTMLInputElement
    let newValue = Number(input.value)
    if (!isNaN(newValue)) {
      newValue = Math.min(this.max, Math.max(this.min, newValue))
      this.value = newValue
      this.dispatchEvent(
        new CustomEvent('value-change', {
          detail: newValue,
          bubbles: true,
          composed: true,
        })
      )
    }
  }

  render() {
    return html`
      <div class="row">
        <span class="label">${this.label}</span>
        <div class="input-wrap">
          <input
            type="number"
            .value=${String(this.value)}
            min=${this.min}
            max=${this.max}
            step=${this.step}
            @change=${this._onChange}
            @input=${this._onChange}
          />
          ${this.unit ? html`<span class="unit">${this.unit}</span>` : ''}
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'fpv-number': FpvNumber
  }
}
