import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { tokenStyles } from '../primitives/tokens.css.js'

// ── Helpers (shared with fpv-quad-preview.ts logic) ─────────────────────────

/**
 * Draw a circular-arc arrow with an arrowhead at the end.
 *
 * @param clockwise  visual clockwise on screen (canvas y-down convention)
 */
function drawCurvedArrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  color: string,
  clockwise = true,
): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 2
  ctx.lineCap = 'round'

  ctx.beginPath()
  ctx.arc(cx, cy, radius, startAngle, endAngle, !clockwise)
  ctx.stroke()

  const tipX = cx + Math.cos(endAngle) * radius
  const tipY = cy + Math.sin(endAngle) * radius
  const rot  = clockwise ? Math.PI + endAngle : endAngle
  const ah   = Math.max(3, radius * 0.22)

  ctx.translate(tipX, tipY)
  ctx.rotate(rot)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(-ah * 0.65, ah * 1.3)
  ctx.lineTo(ah * 0.65, ah * 1.3)
  ctx.closePath()
  ctx.fill()

  ctx.restore()
}

/**
 * Net torque per axis, clamped loosely to [-2, 2] (sum of two pairs).
 *  roll  → left  - right  : (M1+M3) - (M2+M4)
 *  pitch → front - rear   : (M1+M2) - (M3+M4)
 *  yaw   → CW   - CCW    : (M1+M4) - (M2+M3)
 */
function calcNetTorque(m: number[], axis: 'roll' | 'pitch' | 'yaw'): number {
  switch (axis) {
    case 'roll':  return (m[0] + m[2]) - (m[1] + m[3])
    case 'pitch': return (m[0] + m[1]) - (m[2] + m[3])
    case 'yaw':   return (m[0] + m[3]) - (m[1] + m[2])
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * CSS 3D quad preview. The quad frame is rendered with CSS perspective +
 * rotateX/Y/Z driven by live gyro data. A Canvas 2D overlay handles the
 * torque arc, setpoint ghost arc, and numeric labels — information-dense
 * vector graphics that CSS cannot match.
 *
 * Motor indices: 0=M1=front-left, 1=M2=front-right, 2=M3=rear-left, 3=M4=rear-right
 */
@customElement('fpv-quad-preview-3d')
export class FpvQuadPreview3d extends LitElement {
  static styles = [
    tokenStyles,
    css`
      :host {
        display: block;
        min-height: 200px;
        position: relative;
        background: var(--fpv-surface);
        border: 1px solid var(--fpv-border);
        border-radius: var(--fpv-radius-md);
        overflow: hidden;
      }

      /* Fill the host using absolute positioning so height: 100% resolves */
      .scene {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        perspective: 500px;
        perspective-origin: 50% 40%;
      }

      /*
       * Zero-size anchor at the scene centre.
       * Arms use transform-origin: 0 50% so their left end is at this anchor.
       */
      .quad {
        position: absolute;
        top: 50%;
        left: 50%;
        transform-style: preserve-3d;
        transition: transform 0.05s linear;
      }

      /*
       * Arms extend 52 px from centre. X-frame layout:
       *   arm--fl: rotate(-135deg) → upper-left  (M1 front-left)
       *   arm--fr: rotate(-45deg)  → upper-right (M2 front-right)
       *   arm--rl: rotate(135deg)  → lower-left  (M3 rear-left)
       *   arm--rr: rotate(45deg)   → lower-right (M4 rear-right)
       */
      .arm {
        position: absolute;
        top: 0;
        left: 0;
        width: 52px;
        height: 2px;
        background: var(--fpv-border);
        transform-origin: 0 50%;
      }

      .arm--fl { transform: rotate(-135deg); }
      .arm--fr { transform: rotate(-45deg);  }
      .arm--rl { transform: rotate(135deg);  }
      .arm--rr { transform: rotate(45deg);   }

      /* Motor circle at arm tip. --motor-color is set on :host in updated(). */
      .motor {
        position: absolute;
        right: -8px;
        top: -8px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: 2px solid var(--motor-color, var(--fpv-primary));
        background: color-mix(in srgb, var(--motor-color, var(--fpv-primary)) 16%, transparent);
      }

      /* Thrust indicator bar rising above the motor. --thrust is [0,1]. */
      .thrust-bar {
        position: absolute;
        bottom: 100%;
        left: 50%;
        width: 2px;
        transform: translateX(-50%);
        background: var(--motor-color, var(--fpv-primary));
        height: calc(var(--thrust, 0) * 40px);
        transition: height 0.05s linear;
      }

      /* Centre body diamond */
      .body {
        position: absolute;
        top: 0;
        left: 0;
        width: 12px;
        height: 12px;
        margin: -6px 0 0 -6px;
        background: var(--fpv-border);
        transform: rotate(45deg);
      }

      /* Canvas overlay sits above the CSS 3D scene for arcs and labels */
      canvas.overlay {
        display: block;
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
      }
    `,
  ]

  // ── Properties (same interface as fpv-quad-preview) ───────────────────────

  /** Four motor output values [-1..1]: front-left, front-right, rear-left, rear-right */
  @property({ type: Array })   motorOutputs: number[] = [0, 0, 0, 0]
  /** Commanded rotation rate in deg/s */
  @property({ type: Number })  setpointDegS = 0
  /** Actual gyro rotation rate in deg/s */
  @property({ type: Number })  gyroDegS = 0
  /** PID tracking error in deg/s */
  @property({ type: Number })  errorDegS = 0
  /** Whether any motor is saturated */
  @property({ type: Boolean }) saturated = false
  /** Which axis is visualised */
  @property({ type: String })  axis: 'roll' | 'pitch' | 'yaw' = 'roll'

  // ── Canvas overlay internals ──────────────────────────────────────────────

  private _canvas!: HTMLCanvasElement
  private _ctx!: CanvasRenderingContext2D
  private _rafId = 0
  private _loopRunning = false
  private _dirty = true
  private _observer!: ResizeObserver

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  firstUpdated(): void {
    this._canvas = this.shadowRoot!.querySelector('canvas.overlay')!
    const ctx = this._canvas.getContext('2d')
    if (!ctx) return
    this._ctx = ctx

    this._observer = new ResizeObserver(() => { this._dirty = true })
    this._observer.observe(this)

    this._loopRunning = true
    this._loop()
  }

  updated(): void {
    // Resolve CSS tokens (not available in render) and expose motor color so
    // the CSS motor divs inherit the tracking-quality / saturation color.
    const cs    = getComputedStyle(this)
    const color = this._resolveMotorColor(cs)
    this.style.setProperty('--motor-color', color)
    this._dirty = true
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this._loopRunning = false
    cancelAnimationFrame(this._rafId)
    this._observer?.disconnect()
  }

  // ── Canvas rAF dirty-check loop ───────────────────────────────────────────

  private _loop(): void {
    if (!this._loopRunning) return
    this._rafId = requestAnimationFrame(() => {
      if (!this._loopRunning) return
      if (this._dirty) {
        this._resize()
        this._draw()
        this._dirty = false
      }
      this._loop()
    })
  }

  private _resize(): void {
    const dpr = window.devicePixelRatio || 1
    const w   = this.offsetWidth
    const h   = this.offsetHeight
    if (!w || !h) return
    const bw = Math.round(w * dpr)
    const bh = Math.round(h * dpr)
    if (this._canvas.width  !== bw) this._canvas.width  = bw
    if (this._canvas.height !== bh) this._canvas.height = bh
  }

  // ── Motor color logic ─────────────────────────────────────────────────────

  private _resolveMotorColor(cs: CSSStyleDeclaration): string {
    const get        = (v: string, fb: string) => cs.getPropertyValue(v).trim() || fb
    const clrPrimary = get('--fpv-primary', '#00d4aa')
    const clrAccent  = get('--fpv-accent',  '#ff6b35')
    const clrError   = get('--fpv-error',   '#ff4466')
    if (this.saturated) return clrError
    const absSetpoint  = Math.abs(this.setpointDegS)
    const absError     = Math.abs(this.errorDegS)
    const goodTracking = absSetpoint < 5 ? absError < 5 : absError < absSetpoint * 0.2
    return goodTracking ? clrPrimary : clrAccent
  }

  // ── Canvas overlay drawing (arcs + labels only) ───────────────────────────

  private _draw(): void {
    const canvas = this._canvas
    const ctx    = this._ctx
    if (!ctx || !canvas.width || !canvas.height) return

    const dpr  = window.devicePixelRatio || 1
    const cssW = canvas.width  / dpr
    const cssH = canvas.height / dpr

    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, cssW, cssH)

    const cs       = getComputedStyle(this)
    const get      = (v: string, fb: string) => cs.getPropertyValue(v).trim() || fb
    const clrPrimary = get('--fpv-primary',    '#00d4aa')
    const clrMuted   = get('--fpv-text-muted', '#8888a0')
    const clrInfo    = get('--fpv-info',       '#4488ff')
    const fontSans   = get('--fpv-font-sans',  'Inter, system-ui, sans-serif')
    const fontMono   = get('--fpv-font-mono',  'JetBrains Mono, monospace')

    const cx   = cssW / 2
    const cy   = cssH / 2
    const size = Math.min(cssW, cssH)

    // Sanitise motor outputs for torque calculation
    const motors = Array.from({ length: 4 }, (_, i) => {
      const v = this.motorOutputs[i]
      return Math.max(-1, Math.min(1, typeof v === 'number' ? v : 0))
    })

    // ── 1. Net torque arc at CoG
    const netTorque   = calcNetTorque(motors, this.axis)
    const torqueR     = size * 0.09
    const torqueMag   = Math.min(Math.abs(netTorque) / 2, 1)
    const torqueSweep = torqueMag * Math.PI * 1.25

    if (torqueMag > 0.01) {
      const tCW    = netTorque > 0
      const tStart = -Math.PI / 2
      const tEnd   = tStart + (tCW ? torqueSweep : -torqueSweep)
      drawCurvedArrow(ctx, cx, cy, torqueR, tStart, tEnd, clrPrimary, tCW)
    }

    // ── 2. Setpoint ghost arc (semi-transparent, slightly offset radius)
    const maxDegS = 720
    const spNorm  = this.setpointDegS / maxDegS
    const spMag   = Math.min(Math.abs(spNorm), 1)
    const spSweep = spMag * Math.PI * 1.25

    if (spMag > 0.01) {
      const spCW    = this.setpointDegS > 0
      const spR     = torqueR * 1.45
      const spStart = -Math.PI / 2 + Math.PI * 0.18
      const spEnd   = spStart + (spCW ? spSweep : -spSweep)
      ctx.save()
      ctx.globalAlpha = 0.4
      drawCurvedArrow(ctx, cx, cy, spR, spStart, spEnd, clrMuted, spCW)
      ctx.restore()
    }

    // ── 3. Labels
    const drawLeft   = cx - size / 2
    const drawTop    = cy - size / 2
    const drawBottom = cy + size / 2

    // Axis label — top-left corner of drawing area
    ctx.font         = `bold 11px ${fontSans}`
    ctx.fillStyle    = clrMuted
    ctx.textAlign    = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(this.axis.toUpperCase(), drawLeft + 8, drawTop + 8)

    // SP / GY numeric values — bottom row
    ctx.font         = `11px ${fontMono}`
    ctx.textBaseline = 'bottom'

    ctx.textAlign = 'right'
    ctx.fillStyle = clrPrimary
    ctx.fillText(`SP ${this.setpointDegS.toFixed(1)}°/s`, cx - 4, drawBottom - 6)

    ctx.textAlign = 'left'
    ctx.fillStyle = clrInfo
    ctx.fillText(`GY ${this.gyroDegS.toFixed(1)}°/s`, cx + 4, drawBottom - 6)

    ctx.restore()
  }

  // ── Render ────────────────────────────────────────────────────────────────

  render() {
    // Visual tilt angle: clamp gyroDegS proxy to ±60° max visual rotation.
    // 720 deg/s full-scale maps to 45° visual tilt.
    const angle    = clamp(this.gyroDegS / 720 * 45, -60, 60)
    const rollDeg  = this.axis === 'roll'  ? angle : 0
    const yawDeg   = this.axis === 'yaw'   ? angle : 0
    const pitchDeg = this.axis === 'pitch' ? angle : 0

    // roll  → rotateX (tilt left/right when viewed from front)
    // yaw   → rotateY (spin around vertical axis)
    // pitch → rotateZ (nose up/down when viewed from the side)
    const transform = `rotateX(${rollDeg}deg) rotateY(${yawDeg}deg) rotateZ(${pitchDeg}deg)`

    // Absolute motor output magnitudes for thrust bars [0, 1]
    const thrusts = Array.from({ length: 4 }, (_, i) => {
      const v = this.motorOutputs[i]
      return Math.max(0, Math.min(1, typeof v === 'number' ? Math.abs(v) : 0))
    })

    return html`
      <div class="scene">
        <div class="quad" style="transform: ${transform}">
          <div class="arm arm--fl">
            <div class="motor" style="--thrust: ${thrusts[0]}">
              <div class="thrust-bar"></div>
            </div>
          </div>
          <div class="arm arm--fr">
            <div class="motor" style="--thrust: ${thrusts[1]}">
              <div class="thrust-bar"></div>
            </div>
          </div>
          <div class="arm arm--rl">
            <div class="motor" style="--thrust: ${thrusts[2]}">
              <div class="thrust-bar"></div>
            </div>
          </div>
          <div class="arm arm--rr">
            <div class="motor" style="--thrust: ${thrusts[3]}">
              <div class="thrust-bar"></div>
            </div>
          </div>
          <div class="body"></div>
        </div>
        <canvas class="overlay"></canvas>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'fpv-quad-preview-3d': FpvQuadPreview3d
  }
}
