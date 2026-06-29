import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { tokenStyles } from './tokens.css.js'

export interface SelectOption {
  value: string
  label: string
}

@customElement('fpv-select')
export class FpvSelect extends LitElement {
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

      select {
        flex: 1;
        background: var(--fpv-surface-2);
        border: 1px solid var(--fpv-border);
        border-radius: var(--fpv-radius-sm);
        color: var(--fpv-text);
        font-family: var(--fpv-font-mono);
        font-size: var(--fpv-font-body);
        padding: 8px var(--fpv-space-sm);
        min-height: 44px;
        outline: none;
        cursor: pointer;
        transition: border-color 0.15s;
      }

      select:focus {
        border-color: var(--fpv-primary);
      }
    `,
  ]

  @property({ type: String }) label = ''
  @property({ type: String }) value = ''
  @property({ type: Array }) options: SelectOption[] = []

  private _onChange(e: Event) {
    const select = e.target as HTMLSelectElement
    this.value = select.value
    this.dispatchEvent(
      new CustomEvent('select-change', {
        detail: this.value,
        bubbles: true,
        composed: true,
      })
    )
  }

  render() {
    return html`
      <div class="row">
        ${this.label ? html`<span class="label">${this.label}</span>` : ''}
        <select .value=${this.value} @change=${this._onChange}>
          ${this.options.map(
            (opt) => html`
              <option value=${opt.value} ?selected=${opt.value === this.value}>
                ${opt.label}
              </option>
            `
          )}
        </select>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'fpv-select': FpvSelect
  }
}
