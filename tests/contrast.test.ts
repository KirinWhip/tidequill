import { describe, it, expect } from 'vitest'
import { colors, contrastPairs, contrast, tokensCss } from '../src/renderer/theme/tokens'

describe('design tokens: WCAG AA contrast', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const [fg, bg] of contrastPairs) {
      it(`${theme}: ${fg} on ${bg} >= 4.5`, () => {
        const r = contrast(colors[theme][fg], colors[theme][bg])
        expect(r, `${colors[theme][fg]} on ${colors[theme][bg]} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
  it('light and dark define the same tokens', () => { expect(Object.keys(colors.dark).sort()).toEqual(Object.keys(colors.light).sort()) })
  it('generates CSS variables for both themes', () => {
    const css = tokensCss()
    expect(css).toContain('--accent-fg:#ffffff'); expect(css).toContain('[data-theme=dark]'); expect(css).toContain('--radius-md:10px')
  })
  it('contrast math matches known values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1)
  })
})
