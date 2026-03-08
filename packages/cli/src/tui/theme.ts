export const colors = {
  brand: '#22c55e',
  brandDim: '#16a34a',
  blue: '#3b82f6',
  purple: '#a78bfa',
  muted: '#6b7280',
  dim: '#4b5563',
  warning: '#eab308',
  error: '#ef4444',
  white: '#ffffff',
}

export const symbols = {
  check: '✓',
  cross: '✗',
  arrow: '❯',
  dot: '●',
  circle: '○',
  tree: '🌳',
  line: '─',
  corner: '╭',
  cornerEnd: '╰',
  vertical: '│',
  cornerRight: '╮',
  cornerEndRight: '╯',
}

export function horizontalLine(width: number): string {
  return symbols.line.repeat(width)
}

export function boxTop(width: number): string {
  return `${symbols.corner}${horizontalLine(width - 2)}${symbols.cornerRight}`
}

export function boxBottom(width: number): string {
  return `${symbols.cornerEnd}${horizontalLine(width - 2)}${symbols.cornerEndRight}`
}

export function boxRow(content: string, width: number): string {
  const visible = stripAnsi(content)
  const padding = Math.max(0, width - 2 - visible.length)
  return `${symbols.vertical} ${content}${' '.repeat(padding)}${symbols.vertical}`
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}
