import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { tokenStyles } from '../primitives/tokens.css.js'
import { ThemeColors } from '../primitives/theme-colors.js'

type V3 = [number, number, number]

function rotX(p: V3, a: number): V3 {
  const c = Math.cos(a), s = Math.sin(a)
  return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]
}
function rotY(p: V3, a: number): V3 {
  const c = Math.cos(a), s = Math.sin(a)
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]
}
function rotZ(p: V3, a: number): V3 {
  const c = Math.cos(a), s = Math.sin(a)
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]
}

function project(p: V3, focalLen: number, cx: number, cy: number): [number, number, number] {
  const z = p[2] + focalLen
  if (z < 1) return [cx, cy, 0]
  const s = focalLen / z
  return [cx + p[0] * s, cy - p[1] * s, s]
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const DEG = Math.PI / 180
const TAU = Math.PI * 2

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
      canvas {
        display: block;
        width: 100%;
        height: 100%;
        position: absolute;
        top: 0;
        left: 0;
        cursor: grab;
      }
      canvas:active { cursor: grabbing; }
    `,
  ]

  @property({ type: Array })   motorOutputs: number[] = [0, 0, 0, 0]
  @property({ type: Number })  setpointDegS = 0
  @property({ type: Number })  gyroDegS = 0
  @property({ type: Number })  errorDegS = 0
  @property({ type: Boolean }) saturated = false
  @property({ type: String })  axis: 'roll' | 'pitch' | 'yaw' = 'roll'

  private _canvas!: HTMLCanvasElement
  private _ctx!: CanvasRenderingContext2D
  private _rafId = 0
  private _running = false
  private _observer!: ResizeObserver

  private _camPitch = -28 * DEG
  private _camYaw   =  22 * DEG
  private _orbiting = false
  private _orbitX   = 0
  private _orbitY   = 0

  private _startOrbit = (e: MouseEvent) => {
    this._orbiting = true; this._orbitX = e.clientX; this._orbitY = e.clientY
  }
  private _moveOrbit = (e: MouseEvent) => {
    if (!this._orbiting) return
    this._camYaw   += (e.clientX - this._orbitX) * 0.006
    this._camPitch  = Math.max(-1.45, Math.min(-0.04, this._camPitch + (e.clientY - this._orbitY) * 0.006))
    this._orbitX = e.clientX; this._orbitY = e.clientY
    this._dirty = true
  }
  private _endOrbit   = () => { this._orbiting = false }
  private _touchOrbitStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return
    this._orbiting = true; this._orbitX = e.touches[0].clientX; this._orbitY = e.touches[0].clientY
  }
  private _touchOrbitMove = (e: TouchEvent) => {
    if (!this._orbiting || e.touches.length !== 1) return
    this._camYaw   += (e.touches[0].clientX - this._orbitX) * 0.006
    this._camPitch  = Math.max(-1.45, Math.min(-0.04, this._camPitch + (e.touches[0].clientY - this._orbitY) * 0.006))
    this._orbitX = e.touches[0].clientX; this._orbitY = e.touches[0].clientY
    this._dirty = true
  }
  private _resetOrbit = () => { this._camPitch = -28 * DEG; this._camYaw = 22 * DEG; this._dirty = true }

  firstUpdated() {
    this._canvas = this.shadowRoot!.querySelector('canvas')!
    const ctx = this._canvas.getContext('2d')
    if (!ctx) return
    this._ctx = ctx
    this._observer = new ResizeObserver(() => this._resize())
    this._observer.observe(this)
    this._resize()
    this._running = true
    this._loop()
    this._canvas.addEventListener('mousedown', this._startOrbit)
    window.addEventListener('mousemove', this._moveOrbit)
    window.addEventListener('mouseup', this._endOrbit)
    this._canvas.addEventListener('touchstart', this._touchOrbitStart, { passive: true })
    window.addEventListener('touchmove', this._touchOrbitMove, { passive: true })
    window.addEventListener('touchend', this._endOrbit)
    this._canvas.addEventListener('dblclick', this._resetOrbit)
  }

  updated() { this._dirty = true }

  disconnectedCallback() {
    super.disconnectedCallback()
    this._running = false
    cancelAnimationFrame(this._rafId)
    this._observer?.disconnect()
    window.removeEventListener('mousemove', this._moveOrbit)
    window.removeEventListener('mouseup', this._endOrbit)
    window.removeEventListener('touchmove', this._touchOrbitMove)
    window.removeEventListener('touchend', this._endOrbit)
  }

  private _dirty = true

  private _loop() {
    if (!this._running) return
    this._rafId = requestAnimationFrame(() => {
      if (!this._running) return
      if (this._dirty) {
        this._draw()
        this._dirty = false
      }
      this._loop()
    })
  }

  private _resize() {
    const dpr = window.devicePixelRatio || 1
    const w = this.offsetWidth
    const h = this.offsetHeight
    if (!w || !h) return
    this._canvas.width = Math.round(w * dpr)
    this._canvas.height = Math.round(h * dpr)
    this._dirty = true
  }

  private _theme = new ThemeColors(this)

  private _draw() {
    const ctx = this._ctx
    const canvas = this._canvas
    if (!ctx || !canvas.width) return

    const dpr = window.devicePixelRatio || 1
    const W = canvas.width / dpr
    const H = canvas.height / dpr

    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, W, H)

    this._theme.frame()
    const get = (v: string, fb: string) => this._theme.get(v, fb)
    const clrPrimary = get('--fpv-primary', '#00d4aa')
    const clrMuted = get('--fpv-text-muted', '#8888a0')
    const clrInfo = get('--fpv-info', '#4488ff')
    const clrBorder = get('--fpv-border', '#2a2a3e')
    const clrError = get('--fpv-error', '#ff4466')
    const clrAccent = get('--fpv-accent', '#ff6b35')
    const fontMono = get('--fpv-font-mono', 'JetBrains Mono, monospace')
    const fontSans = get('--fpv-font-sans', 'Inter, system-ui, sans-serif')

    const cx = W / 2
    const cy = H / 2
    const scale = Math.min(W, H) * 0.32

    // Quad arm length in model space
    const armLen = 1.0
    const motorR = 0.22
    const propR = 0.32
    const bodyR = 0.18
    const focalLen = 4.0

    // Camera angles (orbit-controlled)
    const camPitch = this._camPitch
    const camYaw   = this._camYaw

    // Gyro-driven rotation of the quad
    const gyroAngle = clamp(this.gyroDegS / 720 * 45, -60, 60) * DEG
    const spAngle = clamp(this.setpointDegS / 720 * 45, -60, 60) * DEG

    // Transform pipeline. The camera + projection stage is shared. The quad
    // model is additionally rotated by the gyro attitude; the ground reference
    // plane stays world-fixed (camera only) so the quad visibly banks against a
    // level horizon instead of the ground rolling with it.
    const camProject = (v: V3): [number, number, number] => {
      v = rotX(v, camPitch)
      v = rotY(v, camYaw)
      v = [v[0] * scale, v[1] * scale, v[2] * scale]
      return project(v, focalLen * scale, cx, cy)
    }
    const applyAttitude = (p: V3): V3 => {
      if (this.axis === 'roll') return rotX(p, gyroAngle)
      if (this.axis === 'pitch') return rotZ(p, -gyroAngle)
      return rotY(p, gyroAngle)
    }
    const xform = (p: V3): [number, number, number] => camProject(applyAttitude(p))
    const xformWorld = (p: V3): [number, number, number] => camProject(p)

    // Motor positions (X-frame, in XZ plane, Y=0)
    const motorPos: V3[] = [
      [-armLen * 0.707, 0, -armLen * 0.707], // M1 front-left
      [ armLen * 0.707, 0, -armLen * 0.707], // M2 front-right
      [-armLen * 0.707, 0,  armLen * 0.707], // M3 rear-left
      [ armLen * 0.707, 0,  armLen * 0.707], // M4 rear-right
    ]

    // Motor colors based on tracking quality
    const absError = Math.abs(this.errorDegS)
    const absSP = Math.abs(this.setpointDegS)
    const motorColor = this.saturated
      ? clrError
      : (absSP < 5 ? absError < 5 : absError < absSP * 0.2)
        ? clrPrimary
        : clrAccent

    // ── Draw grid floor (subtle reference plane) ──
    ctx.globalAlpha = 0.15
    ctx.strokeStyle = clrMuted
    ctx.lineWidth = 0.5
    const gridN = 4
    const gridSpan = 2.0
    for (let i = -gridN; i <= gridN; i++) {
      const t = (i / gridN) * gridSpan
      const a = xformWorld([t, -0.5, -gridSpan])
      const b = xformWorld([t, -0.5, gridSpan])
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke()
      const c = xformWorld([-gridSpan, -0.5, t])
      const d = xformWorld([gridSpan, -0.5, t])
      ctx.beginPath(); ctx.moveTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.stroke()
    }
    ctx.globalAlpha = 1

    // ── Draw shadow on grid ──
    ctx.globalAlpha = 0.08
    ctx.fillStyle = clrPrimary
    const shadowCenter = xformWorld([0, -0.5, 0])
    ctx.beginPath()
    ctx.ellipse(shadowCenter[0], shadowCenter[1], scale * 0.3, scale * 0.12, 0, 0, TAU)
    ctx.fill()
    ctx.globalAlpha = 1

    // ── Collect drawable elements with depth for sorting ──
    type Drawable = { z: number; draw: () => void }
    const drawables: Drawable[] = []

    // Arms
    const center: V3 = [0, 0, 0]
    const cp = xform(center)
    for (let i = 0; i < 4; i++) {
      const mp = xform(motorPos[i])
      const midZ = (cp[2] + mp[2]) / 2
      drawables.push({
        z: midZ,
        draw: () => {
          ctx.beginPath()
          ctx.moveTo(cp[0], cp[1])
          ctx.lineTo(mp[0], mp[1])
          ctx.strokeStyle = clrBorder
          ctx.lineWidth = 3
          ctx.lineCap = 'round'
          ctx.stroke()
        },
      })
    }

    // Center body
    drawables.push({
      z: cp[2],
      draw: () => {
        ctx.beginPath()
        ctx.arc(cp[0], cp[1], bodyR * scale * cp[2], 0, TAU)
        ctx.fillStyle = clrBorder
        ctx.fill()
        // Direction indicator (front arrow)
        const front = xform([0, 0, -0.25])
        ctx.beginPath()
        ctx.moveTo(cp[0], cp[1])
        ctx.lineTo(front[0], front[1])
        ctx.strokeStyle = clrPrimary
        ctx.lineWidth = 2
        ctx.stroke()
      },
    })

    // Motors + prop discs + thrust columns
    for (let i = 0; i < 4; i++) {
      const mp = xform(motorPos[i])
      const mOut = typeof this.motorOutputs[i] === 'number'
        ? clamp(this.motorOutputs[i], -1, 1)
        : 0
      const thrust = Math.abs(mOut)

      drawables.push({
        z: mp[2],
        draw: () => {
          // Prop disc (ellipse in 3D)
          const discR = propR * scale * mp[2]
          ctx.beginPath()
          ctx.ellipse(mp[0], mp[1], discR, discR * 0.35, 0, 0, TAU)
          ctx.fillStyle = motorColor + '20'
          ctx.strokeStyle = motorColor + '60'
          ctx.lineWidth = 1
          ctx.fill()
          ctx.stroke()

          // Motor hub
          const hubR = motorR * 0.5 * scale * mp[2]
          ctx.beginPath()
          ctx.arc(mp[0], mp[1], hubR, 0, TAU)
          ctx.fillStyle = motorColor
          ctx.fill()

          // Thrust column (vertical bar above motor)
          if (thrust > 0.01) {
            // Signed column: up for +thrust, down for −, so a roll/pitch couple
            // (opposite-sign motors) reads as the differential that drives it.
            const thrustTop: V3 = [motorPos[i][0], motorPos[i][1] + mOut * 0.8, motorPos[i][2]]
            const tp = xform(thrustTop)
            ctx.beginPath()
            ctx.moveTo(mp[0], mp[1])
            ctx.lineTo(tp[0], tp[1])
            ctx.strokeStyle = motorColor
            ctx.lineWidth = 3
            ctx.globalAlpha = 0.5
            ctx.lineCap = 'round'
            ctx.stroke()
            ctx.globalAlpha = 1
          }
        },
      })
    }

    // Sort back-to-front (smaller z = further from camera = draw first)
    drawables.sort((a, b) => a.z - b.z)
    for (const d of drawables) d.draw()

    // ── Rotation arc around the model ──
    const arcR = 1.35
    const arcSegments = 48
    const maxDegS = 720

    // Setpoint arc (ghost)
    const spNorm = clamp(this.setpointDegS / maxDegS, -1, 1)
    const spSweep = Math.abs(spNorm) * Math.PI * 1.2
    if (Math.abs(spNorm) > 0.01) {
      this._drawRotationArc(ctx, xform, arcR, spSweep, spNorm > 0, arcSegments, clrMuted, 0.35, 1.5, scale)
    }

    // Gyro arc (solid, brighter)
    const gyroNorm = clamp(this.gyroDegS / maxDegS, -1, 1)
    const gyroSweep = Math.abs(gyroNorm) * Math.PI * 1.2
    if (Math.abs(gyroNorm) > 0.01) {
      this._drawRotationArc(ctx, xform, arcR * 0.95, gyroSweep, gyroNorm > 0, arcSegments, clrPrimary, 0.8, 2.5, scale)
    }

    // ── Labels ──
    ctx.font = `bold 11px ${fontSans}`
    ctx.fillStyle = clrMuted
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(this.axis.toUpperCase(), 8, 8)

    ctx.font = `11px ${fontMono}`
    ctx.textBaseline = 'bottom'
    ctx.textAlign = 'right'
    ctx.fillStyle = clrPrimary
    ctx.fillText(`SP ${this.setpointDegS.toFixed(1)}°/s`, cx - 4, H - 6)
    ctx.textAlign = 'left'
    ctx.fillStyle = clrInfo
    ctx.fillText(`GY ${this.gyroDegS.toFixed(1)}°/s`, cx + 4, H - 6)

    ctx.restore()
  }

  private _drawRotationArc(
    ctx: CanvasRenderingContext2D,
    xform: (p: V3) => [number, number, number],
    radius: number,
    sweep: number,
    clockwise: boolean,
    segments: number,
    color: string,
    alpha: number,
    lineWidth: number,
    scale: number,
  ) {
    // Generate arc points in the rotation plane based on axis
    const points: [number, number][] = []
    const startAngle = -Math.PI / 2
    const dir = clockwise ? 1 : -1

    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      const angle = startAngle + dir * sweep * t
      let p: V3
      if (this.axis === 'roll') {
        p = [0, Math.cos(angle) * radius, Math.sin(angle) * radius]
      } else if (this.axis === 'pitch') {
        p = [Math.sin(angle) * radius, Math.cos(angle) * radius, 0]
      } else {
        p = [Math.cos(angle) * radius, 0, Math.sin(angle) * radius]
      }
      const proj = xform(p)
      points.push([proj[0], proj[1]])
    }

    if (points.length < 2) return

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    ctx.beginPath()
    ctx.moveTo(points[0][0], points[0][1])
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0], points[i][1])
    }
    ctx.stroke()

    // Arrowhead at the end
    const last = points[points.length - 1]
    const prev = points[points.length - 2]
    const dx = last[0] - prev[0]
    const dy = last[1] - prev[1]
    const angle = Math.atan2(dy, dx)
    const ah = Math.max(6, lineWidth * 3)

    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(last[0], last[1])
    ctx.lineTo(last[0] - ah * Math.cos(angle - 0.4), last[1] - ah * Math.sin(angle - 0.4))
    ctx.lineTo(last[0] - ah * Math.cos(angle + 0.4), last[1] - ah * Math.sin(angle + 0.4))
    ctx.closePath()
    ctx.fill()

    ctx.restore()
  }

  render() {
    return html`<canvas></canvas>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'fpv-quad-preview-3d': FpvQuadPreview3d
  }
}
