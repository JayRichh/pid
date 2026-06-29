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
