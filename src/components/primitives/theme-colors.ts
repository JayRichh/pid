/**
 * Caches CSS design-token (`--fpv-*`) lookups for canvas components that redraw
 * every animation frame.
 *
 * `getComputedStyle()` forces a synchronous style recalc; calling it 60×/s (once
 * per frame) is a measurable hot spot on continuously-animating views like the
 * PID scope and 3D quad preview. Tokens don't change during animation, so we
 * snapshot them once every `every` frames (≈0.5s). A theme switch is picked up
 * on the next refresh — no observer wiring needed.
 *
 * Draw-on-change viz (gauges, pack/tilt/rf viz) don't need this — their draw
 * fires only on interaction, so a per-draw getComputedStyle is already cheap.
 */
export class ThemeColors {
  private _cache: Record<string, string> = {}
  private _cs: CSSStyleDeclaration | null = null
  private _fresh = false
  private _frame = 0

  constructor(private _el: Element, private _every = 30) {}

  /** Call once at the top of each draw frame, before any `get()`. */
  frame(): void {
    this._fresh = this._frame++ % this._every === 0
    if (this._fresh) this._cs = getComputedStyle(this._el)
  }

  /** Resolve a CSS custom property, cached between refreshes. */
  get(name: string, fallback: string): string {
    if (this._fresh) {
      this._cache[name] = this._cs!.getPropertyValue(name).trim() || fallback
    }
    return this._cache[name] ?? fallback
  }
}
