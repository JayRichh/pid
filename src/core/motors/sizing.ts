import type { SizingConfig, SizingResult, MotorSpec, PropSpec } from './types.js'

export type { MotorSpec, PropSpec, SizingConfig, SizingResult }

// ── Libraries ────────────────────────────────────────────────────────────────

export const MOTOR_LIBRARY: Record<string, MotorSpec> = {
  'iFlight 2806.5 1300KV': {
    name: 'iFlight 2806.5 1300KV',
    kv: 1300,
    maxCurrentA: 42,
    weightG: 38,
    recommendedProps: ['7040', '7035'],
  },
  'iFlight 2207 1750KV': {
    name: 'iFlight 2207 1750KV',
    kv: 1750,
    maxCurrentA: 36,
    weightG: 30,
    recommendedProps: ['5143', '5051'],
  },
  'T-Motor F40 2306 2450KV': {
    name: 'T-Motor F40 2306 2450KV',
    kv: 2450,
    maxCurrentA: 46,
    weightG: 34,
    recommendedProps: ['5045', '5143'],
  },
  'BetaFPV 1404 3800KV': {
    name: 'BetaFPV 1404 3800KV',
    kv: 3800,
    maxCurrentA: 12,
    weightG: 10,
    recommendedProps: ['3018', '3025'],
  },
  'T-Motor U5 400KV': {
    name: 'T-Motor U5 400KV',
    kv: 400,
    maxCurrentA: 30,
    weightG: 95,
    recommendedProps: ['1555', '1547'],
  },
}

export const PROP_LIBRARY: Record<string, PropSpec> = {
  'Gemfan 7040': { name: 'Gemfan 7040', diameterInch: 7, pitchInch: 4 },
  'Gemfan 5143': { name: 'Gemfan 5143', diameterInch: 5.1, pitchInch: 4.3 },
  'HQProp 5045': { name: 'HQProp 5045', diameterInch: 5, pitchInch: 4.5 },
  'Avan 3025': { name: 'Avan 3025', diameterInch: 3, pitchInch: 2.5 },
  'T-Motor 1555': { name: 'T-Motor 1555', diameterInch: 15, pitchInch: 5.5 },
}

// ── computeSizing ─────────────────────────────────────────────────────────────
//
// NOTE: thrust values are estimated using a simplified empirical model and
// should be verified against manufacturer dyno data before use in a real build.

export function computeSizing(config: SizingConfig): SizingResult {
  const { motor, prop, cellCount, auwG, motorCount } = config

  // Voltage — default LiPo 3.7 V/cell
  const nominalV = cellCount * 3.7

  // RPM at full throttle
  const maxRpm = motor.kv * nominalV

  // Simplified static thrust per motor (estimated — verify against manufacturer data)
  // thrustPerMotorG ≈ 0.70 × diameter² × pitch × (maxRpm / 10000)^1.5
  const rpmFactor = Math.pow(maxRpm / 10000, 1.5)
  const thrustPerMotorG = 0.70 * prop.diameterInch ** 2 * prop.pitchInch * rpmFactor

  const totalThrustG = thrustPerMotorG * motorCount
  const thrustToWeight = totalThrustG / auwG

  // Hover: throttle fraction needed so thrust equals all-up weight
  const hoverThrottlePct = (auwG / totalThrustG) * 100

  // Current at hover scales roughly as throttle^1.5 due to prop loading
  const hoverCurrentPerMotorA = motor.maxCurrentA * Math.pow(hoverThrottlePct / 100, 1.5)
  const totalHoverCurrentA = hoverCurrentPerMotorA * motorCount

  // Efficiency at hover (g of thrust per watt consumed per motor)
  // Note: motorCount cancels — formula is preserved as specified
  const efficiencyGPerW =
    (auwG / motorCount) / ((hoverCurrentPerMotorA * nominalV) / motorCount)

  const recommendedPropRange = motor.recommendedProps.join(', ')

  return {
    maxRpm: Math.round(maxRpm),
    nominalV,
    thrustPerMotorG: Math.round(thrustPerMotorG * 10) / 10,
    totalThrustG: Math.round(totalThrustG * 10) / 10,
    thrustToWeight: Math.round(thrustToWeight * 100) / 100,
    hoverThrottlePct: Math.round(hoverThrottlePct * 10) / 10,
    hoverCurrentPerMotorA: Math.round(hoverCurrentPerMotorA * 10) / 10,
    totalHoverCurrentA: Math.round(totalHoverCurrentA * 10) / 10,
    efficiencyGPerW: Math.round(efficiencyGPerW * 100) / 100,
    recommendedPropRange,
  }
}
