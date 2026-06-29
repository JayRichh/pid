import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { tokenStyles } from './tokens.css.js'

@customElement('fpv-tabs')
export class FpvTabs extends LitElement {
  static styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }

      .tab-bar {
        display: flex;
        gap: 2px;
        border-bottom: 1px solid var(--fpv-border);
      }

      .tab {
        padding: var(--fpv-space-sm) var(--fpv-space-md);
        font-size: var(--fpv-font-label);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--fpv-text-muted);
        cursor: pointer;
        border-radius: var(--fpv-radius-sm) var(--fpv-radius-sm) 0 0;
        transition: color 0.15s, background 0.15s;
        user-select: none;
        min-height: 44px;
        display: flex;
        align-items: center;
      }

      .tab:hover {
        color: var(--fpv-text);
        background: var(--fpv-surface-2);
      }

      .tab.active {
        background: var(--fpv-surface-2);
        color: var(--fpv-primary);
      }
    `,
  ]

  @property({ type: Array }) tabs: string[] = []
  @property({ type: Number }) active = 0

  private _onTabClick(index: number) {
    this.active = index
    this.dispatchEvent(
      new CustomEvent('tab-change', {
        detail: index,
        bubbles: true,
        composed: true,
      })
    )
  }

  render() {
    return html`
      <div class="tab-bar">
        ${this.tabs.map(
          (tab, i) => html`
            <div
              class="tab ${i === this.active ? 'active' : ''}"
              @click=${() => this._onTabClick(i)}
            >
              ${tab}
            </div>
          `
        )}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'fpv-tabs': FpvTabs
  }
}
