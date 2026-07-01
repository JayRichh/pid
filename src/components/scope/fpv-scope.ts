import { LitElement, html, css, PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { tokenStyles } from '../primitives/tokens.css.js'
import { ThemeColors } from '../primitives/theme-colors.js'
import { catmullRom, lttbDecimate } from '@core/shared/interpolate'

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface ScopeSeries {
  name: string
  color: string
  data: Float32Array
  visible?: boolean
}

export interface ScopeMetricBadge {
  tMs: number
  label: string
  color?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Catmull-Rom sub-steps per segment (modest; data is already decimated to ~pixel density). */
const SUB_STEPS = 3

/** Zoom clamp: minimum visible fraction of total time (prevents infinite zoom). */
const MIN_ZOOM_RANGE = 0.001

// ─── Component ────────────────────────────────────────────────────────────────

@customElement('fpv-scope')
export class FpvScope extends LitElement {
  static styles = [
    tokenStyles,
    css`
      :host {
        display: block;
        background: var(--fpv-surface);
        border: 1px solid var(--fpv-border);
        border-radius: var(--fpv-radius-md);
        padding: var(--fpv-space-sm);
        box-sizing: border-box;
      }

      .canvas-wrap {
        position: relative;
        width: 100%;
        overflow: hidden;
      }

      canvas {
        display: block;
        width: 100%;
        min-height: 200px;
        height: clamp(200px, 35vh, 350px);
        cursor: crosshair;
      }

      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: var(--fpv-space-sm);
        padding: var(--fpv-space-sm) 0 0;
        font-size: var(--fpv-font-label);
        color: var(--fpv-text-muted);
        user-select: none;
      }

      .legend-item {
        display: flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
        transition: opacity 0.15s;
      }

      .legend-item.hidden {
        opacity: 0.35;
      }

      .legend-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }
    `,
  ]

  // ─── External properties ─────────────────────────────────────────────────

  @property({ type: Array }) series: ScopeSeries[] = []
  @property({ type: Number }) timeMs = 1000
  @property({ type: Array }) metrics: ScopeMetricBadge[] = []
  @property({ type: Number }) gridDivisions = 10

  // ─── Reactive state (only visibility affects legend DOM) ─────────────────

  @state() private _visibility: boolean[] = []

  // ─── Plain imperative fields (mutate + set _dirty, NOT @state) ───────────

  private _dirty = false
  private _cacheDirty = false

  private _yMin = 0
  private _yMax = 1

  /** Visible fraction of the total time axis [0,1] */
  private _zoomStart = 0
  private _zoomEnd = 1

  /** Mouse X in CSS pixels, or -1 when not hovering */
  private _hoverX = -1

  private _dpr = 1
  private _rafId = 0
  private _canvas: HTMLCanvasElement | null = null
  private _ctx: CanvasRenderingContext2D | null = null
  private _ro: ResizeObserver | null = null

  /** Pre-decimated data per series. Rebuilt only when series/size changes. */
  private _decimated: Float32Array[] = []

  // ─── Drag / pan state ────────────────────────────────────────────────────

  private _dragging = false
  private _dragStartX = 0
  private _dragStartZoomStart = 0
  private _dragStartZoomEnd = 0

  // ─── Touch state ─────────────────────────────────────────────────────────

  private _touchStartId = -1
  private _touchStartX = 0
  private _pinchStartDist = 0
  private _pinchStartZoomStart = 0
  private _pinchStartZoomEnd = 0
  private _lastTapTime = 0

  // ─── Bound event listeners (stored for clean removal) ────────────────────

  private _boundWheel!: (e: WheelEvent) => void
  private _boundMouseDown!: (e: MouseEvent) => void
  private _boundMouseMove!: (e: MouseEvent) => void
  private _boundMouseLeave!: () => void
  private _boundDblClick!: () => void
  private _boundWindowMove!: (e: MouseEvent) => void
  private _boundWindowUp!: () => void
  private _boundTouchStart!: (e: TouchEvent) => void
  private _boundTouchMove!: (e: TouchEvent) => void
  private _boundTouchEnd!: (e: TouchEvent) => void
  private _boundTouchCancel!: () => void

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  disconnectedCallback() {
    super.disconnectedCallback()
    cancelAnimationFrame(this._rafId)
    this._ro?.disconnect()
    this._removeCanvasListeners()
    if (this._boundWindowMove) {
      window.removeEventListener('mousemove', this._boundWindowMove)
      window.removeEventListener('mouseup', this._boundWindowUp)
    }
  }

  firstUpdated() {
    const canvas = this.renderRoot.querySelector<HTMLCanvasElement>('canvas')!
    this._canvas = canvas
    this._ctx = canvas.getContext('2d')!

    this._ro = new ResizeObserver(() => {
      this._resizeCanvas()
      this._cacheDirty = true
      this._dirty = true
    })
    this._ro.observe(canvas)
    this._resizeCanvas()

    this._addCanvasListeners()
    this._rafLoop()
  }

  updated(changed: PropertyValues) {
    if (changed.has('series')) {
      const prev = this._visibility
      // Preserve toggle state by index; seed new entries from series.visible
      this._visibility = this.series.map((s, i) =>
        i < prev.length ? prev[i] : (s.visible ?? true)
      )
      this._cacheDirty = true
      this._dirty = true
    }
    if (changed.has('timeMs') || changed.has('metrics') || changed.has('gridDivisions')) {
      this._cacheDirty = true
      this._dirty = true
    }
  }

  // ─── rAF loop ────────────────────────────────────────────────────────────

  private _rafLoop() {
    this._rafId = requestAnimationFrame(() => {
      if (this._dirty && this._ctx && this._canvas) {
        this._rebuildCache()   // no-op unless _cacheDirty
        this._draw()
        this._dirty = false
      }
      this._rafLoop()
    })
  }

  // ─── Resize ──────────────────────────────────────────────────────────────

  private _resizeCanvas() {
    const canvas = this._canvas
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const w = Math.max(rect.width || canvas.clientWidth || 600, 1)
    const h = Math.max(rect.height || canvas.clientHeight || 200, 200)
    this._dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(w * this._dpr)
    canvas.height = Math.round(h * this._dpr)
  }

  // ─── Cache rebuild (decimation + y-scale) ────────────────────────────────

  private _rebuildCache() {
    if (!this._cacheDirty || !this._canvas) return
    this._cacheDirty = false

    // Decimate to 2× CSS-pixel width so zoom coarseness stays bounded
    const W = this._canvas.width / this._dpr
    const threshold = Math.max(Math.ceil(W * 2), 100)

    this._decimated = this.series.map(s => {
      if (!s.data || s.data.length === 0) return new Float32Array(0)
      if (s.data.length > threshold) return lttbDecimate(s.data, threshold)
      return s.data
    })

    // Auto-scale from full (non-decimated) visible data
    let yMin = Infinity
    let yMax = -Infinity
    for (let si = 0; si < this.series.length; si++) {
      if (!this._visibility[si]) continue
      const data = this.series[si].data
      if (!data || data.length === 0) continue
      for (let j = 0; j < data.length; j++) {
        const v = data[j]
        if (v < yMin) yMin = v
        if (v > yMax) yMax = v
      }
    }

    if (!isFinite(yMin) || !isFinite(yMax)) { yMin = 0; yMax = 1 }
    if (yMin === yMax) { yMin -= 0.5; yMax += 0.5 }

    const pad = (yMax - yMin) * 0.1
    this._yMin = yMin - pad
    this._yMax = yMax + pad
  }

  // ─── Coordinate helpers ───────────────────────────────────────────────────

  private _timeToX(tMs: number): number {
    const canvas = this._canvas
    if (!canvas) return 0
    const W = canvas.width / this._dpr
    const visDur = (this._zoomEnd - this._zoomStart) * this.timeMs
    return ((tMs - this._zoomStart * this.timeMs) / visDur) * W
  }

  private _xToTime(x: number): number {
    const canvas = this._canvas
    if (!canvas) return 0
    const W = canvas.width / this._dpr
    const visDur = (this._zoomEnd - this._zoomStart) * this.timeMs
    return this._zoomStart * this.timeMs + (x / W) * visDur
  }

  private _valueToY(value: number): number {
    const canvas = this._canvas
    if (!canvas) return 0
    const H = canvas.height / this._dpr
    return H - ((value - this._yMin) / (this._yMax - this._yMin)) * H
  }

  /**
   * Interpolate value at tMs from original (full-resolution) data using
   * Catmull-Rom so cursor readouts stay accurate at any zoom level.
   */
  private _getValueAtTime(data: Float32Array, tMs: number): number {
    const len = data.length
    if (len === 0) return 0
    const fracIdx = (tMs / this.timeMs) * (len - 1)
    const i = Math.max(0, Math.min(len - 2, Math.floor(fracIdx)))
    const t = fracIdx - i
    const p0 = i > 0 ? data[i - 1] : data[i]
    const p1 = data[i]
    const p2 = data[i + 1]
    const p3 = i + 2 < len ? data[i + 2] : data[i + 1]
    return catmullRom(p0, p1, p2, p3, t)
  }

  // ─── Draw orchestration ───────────────────────────────────────────────────

  private _theme = new ThemeColors(this)

  private _draw() {
    const ctx = this._ctx
    const canvas = this._canvas
    if (!ctx || !canvas) return

    const dpr = this._dpr
    const W = canvas.width / dpr
    const H = canvas.height / dpr

    ctx.save()
    ctx.scale(dpr, dpr)

    // Resolve CSS variables (cached; re-read periodically instead of every frame)
    this._theme.frame()
    const surface   = this._theme.get('--fpv-surface', '#14141f')
    const border    = this._theme.get('--fpv-border', '#2a2a3a')
    const textMuted = this._theme.get('--fpv-text-muted', '#8888a0')
    const surface2  = this._theme.get('--fpv-surface-2', '#1e1e2e')
    const fontLabel = this._theme.get('--fpv-font-label', '12px')
    const fontMono  = this._theme.get('--fpv-font-mono', 'JetBrains Mono, monospace')

    ctx.fillStyle = surface
    ctx.fillRect(0, 0, W, H)

    this._drawGrid(ctx, W, H, border, textMuted, fontLabel, fontMono)
    this._drawMetrics(ctx, W, H, textMuted, surface2, fontLabel)
    this._drawSeries(ctx, W, H)

    if (this._hoverX >= 0 && this._hoverX <= W) {
      this._drawCursor(ctx, W, H, surface2, fontLabel, fontMono)
    }

    ctx.restore()
  }

  // ─── Grid ────────────────────────────────────────────────────────────────

  private _drawGrid(
    ctx: CanvasRenderingContext2D,
    W: number, H: number,
    border: string, textMuted: string, fontLabel: string, fontMono: string,
  ) {
    const divs  = this.gridDivisions
    const minor = divs * 5

    // Minor lines (skip positions that coincide with major lines)
    ctx.save()
    ctx.strokeStyle = border
    ctx.globalAlpha = 0.2
    ctx.lineWidth = 0.5
    for (let i = 0; i <= minor; i++) {
      if (i % 5 === 0) continue
      const x = (i / minor) * W
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
    }
    for (let j = 0; j <= minor; j++) {
      if (j % 5 === 0) continue
      const y = (j / minor) * H
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
    }
    ctx.restore()

    // Major lines
    ctx.save()
    ctx.strokeStyle = border
    ctx.globalAlpha = 0.7
    ctx.lineWidth = 0.75
    for (let i = 0; i <= divs; i++) {
      const x = (i / divs) * W
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
    }
    for (let j = 0; j <= divs; j++) {
      const y = (j / divs) * H
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
    }
    ctx.restore()

    // X-axis time labels
    const visStart = this._zoomStart * this.timeMs
    const visEnd   = this._zoomEnd   * this.timeMs
    ctx.save()
    ctx.fillStyle = textMuted
    ctx.font = `${fontLabel} ${fontMono}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    for (let i = 0; i <= divs; i++) {
      const t = visStart + (i / divs) * (visEnd - visStart)
      const x = (i / divs) * W
      const label = t >= 1000 ? `${(t / 1000).toFixed(2)}s` : `${t.toFixed(0)}ms`
      ctx.fillText(label, x, H - 2)
    }
    ctx.restore()

    // Y-axis value labels
    ctx.save()
    ctx.fillStyle = textMuted
    ctx.font = `${fontLabel} ${fontMono}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    for (let j = 0; j <= divs; j++) {
      const val = this._yMax - (j / divs) * (this._yMax - this._yMin)
      const y   = (j / divs) * H
      const label = Math.abs(val) >= 1000 ? val.toFixed(0)
        : Math.abs(val) >= 10 ? val.toFixed(1)
        : val.toFixed(2)
      ctx.fillText(label, 2, y)
    }
    ctx.restore()
  }

  // ─── Metric badges ───────────────────────────────────────────────────────

  private _drawMetrics(
    ctx: CanvasRenderingContext2D,
    W: number, H: number,
    textMuted: string, surface2: string, fontLabel: string,
  ) {
    if (!this.metrics?.length) return

    ctx.save()
    ctx.font = `bold ${fontLabel} sans-serif`

    for (const m of this.metrics) {
      const x = this._timeToX(m.tMs)
      if (x < -2 || x > W + 2) continue
      const color = m.color || textMuted

      // Dashed vertical marker
      ctx.save()
      ctx.strokeStyle = color
      ctx.globalAlpha = 0.45
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
      ctx.restore()

      // Rounded badge near top
      const tw = ctx.measureText(m.label).width
      const bw = tw + 8
      const bh = 16
      const bx = Math.max(2, Math.min(x - bw / 2, W - bw - 2))
      const by = 6

      ctx.globalAlpha = 0.88
      ctx.fillStyle = surface2
      this._roundRect(ctx, bx, by, bw, bh, 3)
      ctx.fill()

      ctx.globalAlpha = 1
      ctx.fillStyle = color
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(m.label, bx + 4, by + 2)
    }

    ctx.restore()
  }

  // ─── Series rendering (Catmull-Rom on decimated data) ────────────────────

  private _drawSeries(ctx: CanvasRenderingContext2D, W: number, H: number) {
    for (let si = 0; si < this.series.length; si++) {
      if (!this._visibility[si]) continue
      const s   = this.series[si]
      const dec = this._decimated[si]
      if (!dec || dec.length === 0) continue

      const decLen  = dec.length
      const totalMs = this.timeMs

      ctx.save()
      ctx.strokeStyle = s.color
      ctx.lineWidth = 1.5
      ctx.lineJoin = 'round'
      ctx.lineCap  = 'round'
      ctx.beginPath()

      let started = false

      for (let i = 0; i < decLen - 1; i++) {
        // Map decimated index → proportional time
        const r0 = decLen > 1 ? i       / (decLen - 1) : 0
        const r1 = decLen > 1 ? (i + 1) / (decLen - 1) : 0
        const x0 = this._timeToX(r0 * totalMs)
        const x1 = this._timeToX(r1 * totalMs)

        if (x1 < -2)     continue   // both points left of view
        if (x0 > W + 2)  break      // all remaining points right of view

        if (!started) {
          ctx.moveTo(x0, this._valueToY(dec[i]))
          started = true
        }

        // Catmull-Rom control points (Y only; X is linear between x0…x1)
        const p0 = i > 0          ? dec[i - 1] : dec[i]
        const p1 = dec[i]
        const p2 = dec[i + 1]
        const p3 = i + 2 < decLen ? dec[i + 2] : dec[i + 1]

        for (let sub = 1; sub <= SUB_STEPS; sub++) {
          const t  = sub / SUB_STEPS
          const iy = catmullRom(p0, p1, p2, p3, t)
          const ix = x0 + (x1 - x0) * t
          ctx.lineTo(ix, this._valueToY(iy))
        }
      }

      // Single-point series: draw a dot
      if (decLen === 1 && !started) {
        const x = this._timeToX(0)
        const y = this._valueToY(dec[0])
        ctx.arc(x, y, 2.5, 0, Math.PI * 2)
      }

      ctx.stroke()
      ctx.restore()
    }
  }

  // ─── Cursor + tooltip ─────────────────────────────────────────────────────

  private _drawCursor(
    ctx: CanvasRenderingContext2D,
    W: number, H: number,
    surface2: string, fontLabel: string, fontMono: string,
  ) {
    const x   = this._hoverX
    const tMs = this._xToTime(x)

    // Vertical cursor line
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
    ctx.restore()

    // Collect interpolated values from full-resolution data
    const entries: Array<{ name: string; color: string; value: number }> = []
    for (let si = 0; si < this.series.length; si++) {
      if (!this._visibility[si]) continue
      const s = this.series[si]
      if (!s.data || s.data.length === 0) continue
      entries.push({
        name:  s.name,
        color: s.color,
        value: this._getValueAtTime(s.data, tMs),
      })
    }
    if (entries.length === 0) return

    // Measure tooltip dimensions
    ctx.save()
    ctx.font = `${fontLabel} ${fontMono}`

    const lineH   = 16
    const padX    = 7
    const padY    = 5
    const tLabel  = tMs >= 1000 ? `t=${(tMs / 1000).toFixed(3)}s` : `t=${tMs.toFixed(1)}ms`
    let maxW      = ctx.measureText(tLabel).width
    for (const e of entries) {
      maxW = Math.max(maxW, ctx.measureText(`${e.name}: ${e.value.toFixed(3)}`).width)
    }

    const ttW = maxW + padX * 2
    const ttH = lineH * (entries.length + 1) + padY * 2
    let ttX = x + 12
    let ttY = 10

    if (ttX + ttW > W - 4) ttX = x - ttW - 12
    if (ttY + ttH > H - 4) ttY = H - ttH - 4

    // Tooltip background
    ctx.fillStyle = surface2
    ctx.globalAlpha = 0.93
    this._roundRect(ctx, ttX, ttY, ttW, ttH, 4)
    ctx.fill()

    ctx.globalAlpha = 1
    ctx.textBaseline = 'top'
    ctx.textAlign    = 'left'

    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.fillText(tLabel, ttX + padX, ttY + padY)

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      ctx.fillStyle = e.color
      ctx.fillText(`${e.name}: ${e.value.toFixed(3)}`, ttX + padX, ttY + padY + lineH * (i + 1))
    }

    ctx.restore()
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /** Cross-browser rounded rectangle path (Canvas 2D roundRect not always available). */
  private _roundRect(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    w: number, h: number,
    r: number,
  ) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y,     x + w, y + r)
    ctx.lineTo(x + w, y + h - r)
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    ctx.lineTo(x + r, y + h)
    ctx.quadraticCurveTo(x,     y + h, x,     y + h - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x,     y,     x + r, y)
    ctx.closePath()
  }

  // ─── Event wiring ─────────────────────────────────────────────────────────

  private _addCanvasListeners() {
    const canvas = this._canvas!

    this._boundWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect   = canvas.getBoundingClientRect()
      const cx     = e.clientX - rect.left
      const norm   = cx / rect.width
      const range  = this._zoomEnd - this._zoomStart
      // scroll down → zoom out (larger range), scroll up → zoom in
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15
      const newRange = Math.max(MIN_ZOOM_RANGE, Math.min(1, range * factor))
      const cursorT  = this._zoomStart + norm * range
      let ns = cursorT - norm * newRange
      let ne = ns + newRange
      if (ns < 0) { ns = 0; ne = newRange }
      if (ne > 1) { ne = 1; ns = 1 - newRange }
      this._zoomStart = Math.max(0, ns)
      this._zoomEnd   = Math.min(1, ne)
      this._dirty = true
    }

    this._boundMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      this._dragging           = true
      this._dragStartX         = e.clientX
      this._dragStartZoomStart = this._zoomStart
      this._dragStartZoomEnd   = this._zoomEnd
      window.addEventListener('mousemove', this._boundWindowMove)
      window.addEventListener('mouseup',   this._boundWindowUp)
    }

    this._boundMouseMove = (e: MouseEvent) => {
      const rect    = canvas.getBoundingClientRect()
      this._hoverX  = e.clientX - rect.left
      this._dirty   = true
    }

    this._boundMouseLeave = () => {
      this._hoverX = -1
      this._dirty  = true
    }

    this._boundDblClick = () => {
      this._zoomStart = 0
      this._zoomEnd   = 1
      this._dirty     = true
    }

    this._boundWindowMove = (e: MouseEvent) => {
      if (!this._dragging) return
      const rect   = canvas.getBoundingClientRect()
      const dx     = e.clientX - this._dragStartX
      const range  = this._dragStartZoomEnd - this._dragStartZoomStart
      const dtNorm = -(dx / rect.width) * range
      let ns = this._dragStartZoomStart + dtNorm
      let ne = this._dragStartZoomEnd   + dtNorm
      if (ns < 0) { ns = 0; ne = range }
      if (ne > 1) { ne = 1; ns = 1 - range }
      this._zoomStart = Math.max(0, ns)
      this._zoomEnd   = Math.min(1, ne)
      // Also update hover position
      this._hoverX  = e.clientX - rect.left
      this._dirty   = true
    }

    this._boundWindowUp = () => {
      this._dragging = false
      window.removeEventListener('mousemove', this._boundWindowMove)
      window.removeEventListener('mouseup',   this._boundWindowUp)
    }

    // Touch handlers (stored as bound fields so they can be removed)
    this._boundTouchStart = (e: TouchEvent) => {
      e.preventDefault()

      if (e.touches.length === 1) {
        const rect = canvas.getBoundingClientRect()
        const touch = e.touches[0]
        this._touchStartId = touch.identifier
        this._touchStartX = touch.clientX
        this._dragStartZoomStart = this._zoomStart
        this._dragStartZoomEnd = this._zoomEnd
        this._hoverX = touch.clientX - rect.left
        this._dirty = true

        // Double-tap detection
        const now = Date.now()
        if (now - this._lastTapTime < 300) {
          this._zoomStart = 0
          this._zoomEnd = 1
          this._dirty = true
        }
        this._lastTapTime = now
      } else if (e.touches.length === 2) {
        const dx = e.touches[1].clientX - e.touches[0].clientX
        const dy = e.touches[1].clientY - e.touches[0].clientY
        this._pinchStartDist = Math.hypot(dx, dy)
        this._pinchStartZoomStart = this._zoomStart
        this._pinchStartZoomEnd = this._zoomEnd
      }
    }

    this._boundTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()

      if (e.touches.length === 1) {
        const touch = e.touches[0]
        const dx = touch.clientX - this._touchStartX
        const range = this._dragStartZoomEnd - this._dragStartZoomStart
        const dtNorm = -(dx / rect.width) * range
        let ns = this._dragStartZoomStart + dtNorm
        let ne = this._dragStartZoomEnd + dtNorm
        if (ns < 0) { ns = 0; ne = range }
        if (ne > 1) { ne = 1; ns = 1 - range }
        this._zoomStart = Math.max(0, ns)
        this._zoomEnd = Math.min(1, ne)
        this._hoverX = touch.clientX - rect.left
        this._dirty = true
      } else if (e.touches.length === 2) {
        const dx = e.touches[1].clientX - e.touches[0].clientX
        const dy = e.touches[1].clientY - e.touches[0].clientY
        const dist = Math.hypot(dx, dy)
        const scale = this._pinchStartDist / dist
        const range = this._pinchStartZoomEnd - this._pinchStartZoomStart
        const newRange = Math.max(MIN_ZOOM_RANGE, Math.min(1, range * scale))
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left
        const norm = midX / rect.width
        const cursorT = this._pinchStartZoomStart + norm * range
        let ns = cursorT - norm * newRange
        let ne = ns + newRange
        if (ns < 0) { ns = 0; ne = newRange }
        if (ne > 1) { ne = 1; ns = 1 - newRange }
        this._zoomStart = Math.max(0, ns)
        this._zoomEnd = Math.min(1, ne)
        this._dirty = true
      }
    }

    this._boundTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        this._hoverX = -1
        this._dirty = true
      }
    }

    this._boundTouchCancel = () => {
      this._hoverX = -1
      this._dirty = true
    }

    // wheel must be non-passive to call preventDefault
    canvas.addEventListener('wheel',        this._boundWheel,       { passive: false })
    canvas.addEventListener('mousedown',    this._boundMouseDown)
    canvas.addEventListener('mousemove',    this._boundMouseMove)
    canvas.addEventListener('mouseleave',   this._boundMouseLeave)
    canvas.addEventListener('dblclick',     this._boundDblClick)
    canvas.addEventListener('touchstart',   this._boundTouchStart,  { passive: false })
    canvas.addEventListener('touchmove',    this._boundTouchMove,   { passive: false })
    canvas.addEventListener('touchend',     this._boundTouchEnd)
    canvas.addEventListener('touchcancel',  this._boundTouchCancel)
  }

  private _removeCanvasListeners() {
    const canvas = this._canvas
    if (!canvas || !this._boundWheel) return
    canvas.removeEventListener('wheel',       this._boundWheel)
    canvas.removeEventListener('mousedown',   this._boundMouseDown)
    canvas.removeEventListener('mousemove',   this._boundMouseMove)
    canvas.removeEventListener('mouseleave',  this._boundMouseLeave)
    canvas.removeEventListener('dblclick',    this._boundDblClick)
    if (this._boundTouchStart) {
      canvas.removeEventListener('touchstart',  this._boundTouchStart)
      canvas.removeEventListener('touchmove',   this._boundTouchMove)
      canvas.removeEventListener('touchend',    this._boundTouchEnd)
      canvas.removeEventListener('touchcancel', this._boundTouchCancel)
    }
  }

  // ─── Legend toggle ────────────────────────────────────────────────────────

  private _toggleSeries(i: number) {
    const v  = [...this._visibility]
    v[i]     = !v[i]
    this._visibility = v
    // Y-scale may change; rebuild on next dirty frame
    this._cacheDirty = true
    this._dirty      = true
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Export all currently-visible series as CSV.
   * Uses full-resolution data (not decimated). Series with different lengths
   * are zero-padded with empty cells for shorter ones.
   */
  exportCSV(): string {
    const visible = this.series.filter((_, i) => this._visibility[i])
    if (visible.length === 0) return ''

    const maxLen = Math.max(...visible.map(s => s.data?.length ?? 0))
    if (maxLen === 0) return ''

    const rows: string[] = []
    rows.push(['time_ms', ...visible.map(s => s.name)].join(','))

    for (let i = 0; i < maxLen; i++) {
      const t    = maxLen > 1 ? (i / (maxLen - 1)) * this.timeMs : 0
      const vals = visible.map(s =>
        s.data && i < s.data.length ? String(s.data[i]) : ''
      )
      rows.push([t.toFixed(3), ...vals].join(','))
    }

    return rows.join('\n')
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  render() {
    return html`
      <div class="canvas-wrap">
        <canvas></canvas>
      </div>
      <div class="legend">
        ${this.series.map((s, i) => html`
          <div
            class="legend-item ${this._visibility[i] ? '' : 'hidden'}"
            @click=${() => this._toggleSeries(i)}
          >
            <span class="legend-dot" style="background:${s.color}"></span>
            <span>${s.name}</span>
          </div>
        `)}
      </div>
    `
  }
}

// ─── Global type augmentation ─────────────────────────────────────────────────

declare global {
  interface HTMLElementTagNameMap {
    'fpv-scope': FpvScope
  }
}
