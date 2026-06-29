import { describe, it, expect } from 'vitest'
import { computeSizing, MOTOR_LIBRARY, PROP_LIBRARY } from '../../../src/core/motors/sizing'

describe('computeSizing', () => {
  it('2806.5 1300KV on 6S with 7040 props, 1200g AUW, 4 motors → thrust-to-weight > 2', () => {
    const result = computeSizing({
      motor: MOTOR_LIBRARY['iFlight 2806.5 1300KV'],
      prop: PROP_LIBRARY['Gemfan 7040'],
      cellCount: 6,
      auwG: 1200,
      motorCount: 4,
    })
    expect(result.thrustToWeight).toBeGreaterThan(2)
  })

  it('higher KV motor produces higher max RPM at equal cell count', () => {
    const low = computeSizing({
      motor: MOTOR_LIBRARY['iFlight 2806.5 1300KV'],   // 1300 KV
      prop: PROP_LIBRARY['Gemfan 5143'],
      cellCount: 4,
      auwG: 700,
      motorCount: 4,
    })
    const high = computeSizing({
      motor: MOTOR_LIBRARY['iFlight 2207 1750KV'],       // 1750 KV
      prop: PROP_LIBRARY['Gemfan 5143'],
      cellCount: 4,
      auwG: 700,
      motorCount: 4,
    })
    expect(high.maxRpm).toBeGreaterThan(low.maxRpm)
  })

  it('more motors → lower per-motor current at hover (same AUW, same motor/prop)', () => {
    const four = computeSizing({
      motor: MOTOR_LIBRARY['iFlight 2207 1750KV'],
      prop: PROP_LIBRARY['Gemfan 5143'],
      cellCount: 4,
      auwG: 700,
      motorCount: 4,
    })
    const eight = computeSizing({
      motor: MOTOR_LIBRARY['iFlight 2207 1750KV'],
      prop: PROP_LIBRARY['Gemfan 5143'],
      cellCount: 4,
      auwG: 700,
      motorCount: 8,
    })
    expect(eight.hoverCurrentPerMotorA).toBeLessThan(four.hoverCurrentPerMotorA)
  })
})
