import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { tokenStyles } from './tokens.css.js'

@customElement('fpv-toggle')
export class FpvToggle extends LitElement {
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
        cursor: pointer;
        user-select: none;
        min-height: 44px;
      }

      .label {
        font-size: var(--fpv-font-label);
        color: var(--fpv-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        flex: 1;
      }

      .track {
        width: 36px;
        height: 20px;
        border-radius: 10px;
        background: var(--fpv-border);
        position: relative;
        transition: background 0.2s;
        flex-shrink: 0;
      }

      .track.on {
        background: var(--fpv-primary);
      }

      .thumb {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--fpv-text);
        transition: transform 0.2s;
      }

      .track.on .thumb {
        transform: translateX(16px);
      }
    `,
  ]

  @property({ type: String }) label = ''
  @property({ type: Boolean }) checked = false

  private _onClick() {
    this.checked = !this.checked
    this.dispatchEvent(
      new CustomEvent('toggle-change', {
        detail: this.checked,
        bubbles: true,
        composed: true,
      })
    )
  }

  render() {
    return html`
      <div class="row" @click=${this._onClick}>
        ${this.label ? html`<span class="label">${this.label}</span>` : ''}
        <div class="track ${this.checked ? 'on' : ''}">
          <div class="thumb"></div>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'fpv-toggle': FpvToggle
  }
}
