/** Design tokens — single source of truth for colors, radius, spacing and type scale.
 *  Applied as CSS custom properties (see applyTokens); contrast is checked by tests/contrast.test.ts. */
export const colors = {
  light: {
    bg: '#ffffff', bgSubtle: '#f6f7f9', bgMuted: '#eceef2', bgHover: '#e3e6eb',
    fg: '#111827', fgMuted: '#4b5563', border: '#d1d5db', borderStrong: '#9ca3af',
    accent: '#2563eb', accentFg: '#ffffff', accentText: '#1d4ed8', accentSoft: '#e8f0fe',
    danger: '#b91c1c', dangerBg: '#b91c1c', dangerFg: '#ffffff', warn: '#92400e', success: '#15803d',
    userBubble: '#e8f0fe', codeBg: '#0d1117', codeBar: '#161b22', codeFg: '#e6edf3', codeMuted: '#9ba5b0',
    tableStripe: '#f6f7f9', focus: '#2563eb', shadow: 'rgba(15, 23, 42, 0.12)', overlay: 'rgba(15, 23, 42, 0.45)',
  },
  dark: {
    bg: '#17181c', bgSubtle: '#1f2126', bgMuted: '#2a2d33', bgHover: '#33363d',
    fg: '#e8eaed', fgMuted: '#a7adb8', border: '#3b3f46', borderStrong: '#5b616b',
    accent: '#2563eb', accentFg: '#ffffff', accentText: '#8ab4ff', accentSoft: '#1e2a44',
    danger: '#fca5a5', dangerBg: '#b91c1c', dangerFg: '#ffffff', warn: '#fbbf24', success: '#4ade80',
    userBubble: '#243453', codeBg: '#0d1117', codeBar: '#161b22', codeFg: '#e6edf3', codeMuted: '#9ba5b0',
    tableStripe: '#1f2126', focus: '#8ab4ff', shadow: 'rgba(0, 0, 0, 0.5)', overlay: 'rgba(0, 0, 0, 0.6)',
  },
} as const

export const scale = {
  radiusSm: '6px', radiusMd: '10px', radiusLg: '14px', radiusFull: '999px',
  space1: '4px', space2: '8px', space3: '12px', space4: '16px', space5: '24px', space6: '32px',
  fontXs: '0.75rem', fontSm: '0.85rem', fontMd: '1rem', fontLg: '1.15rem', fontXl: '1.4rem',
  fontMono: 'Consolas, "JetBrains Mono", "Cascadia Code", monospace',
}

/** foreground/background pairs that must meet WCAG AA (4.5:1 for normal text) */
export const contrastPairs: [keyof typeof colors.light, keyof typeof colors.light][] = [
  ['fg', 'bg'], ['fg', 'bgSubtle'], ['fg', 'bgMuted'], ['fg', 'bgHover'], ['fg', 'userBubble'], ['fg', 'tableStripe'],
  ['fgMuted', 'bg'], ['fgMuted', 'bgSubtle'], ['fgMuted', 'bgMuted'], ['fgMuted', 'userBubble'],
  ['accentFg', 'accent'], ['accentText', 'bg'], ['accentText', 'bgSubtle'], ['accentText', 'accentSoft'],
  ['danger', 'bg'], ['danger', 'bgSubtle'], ['dangerFg', 'dangerBg'], ['warn', 'bg'], ['success', 'bg'],
  ['codeFg', 'codeBg'], ['codeMuted', 'codeBg'], ['codeMuted', 'codeBar'],
]

const kebab = (s: string) => s.replace(/[A-Z]/g, m => '-' + m.toLowerCase())
export function tokensCss(): string {
  const vars = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `--${kebab(k)}:${v};`).join('')
  return `:root{${vars(scale)}${vars(colors.light)}}[data-theme=dark]{${vars(colors.dark)}}`
}
export function applyTokens() {
  let el = document.getElementById('design-tokens') as HTMLStyleElement | null
  if (!el) { el = document.createElement('style'); el.id = 'design-tokens'; document.head.prepend(el) }
  el.textContent = tokensCss()
}

// WCAG relative luminance / contrast
export function luminance(hex: string): number {
  const n = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
