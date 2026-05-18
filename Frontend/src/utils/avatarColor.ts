const AVATAR_COLOR_PALETTE = [
  '#6b78f6',
  '#22c55e',
  '#f97316',
  '#ec4899',
  '#eab308',
  '#14b8a6',
  '#8b5cf6',
]

function getPaletteColorByIndex(index: number): string {
  return AVATAR_COLOR_PALETTE[index % AVATAR_COLOR_PALETTE.length]
}

export function createAvatarColorMap(userIds: number[]): Map<number, string> {
  const uniqueSortedIds = Array.from(
    new Set(userIds.filter((id) => Number.isFinite(id))),
  ).sort((a, b) => a - b)

  const colorMap = new Map<number, string>()
  uniqueSortedIds.forEach((userId, index) => {
    colorMap.set(userId, getPaletteColorByIndex(index))
  })
  return colorMap
}

export function pickAvatarColor(userId: number, colorMap: Map<number, string>): string {
  return (
    colorMap.get(userId) ??
    AVATAR_COLOR_PALETTE[Math.abs(userId) % AVATAR_COLOR_PALETTE.length]
  )
}

export function createLabelColorMap(labels: string[]): Map<string, string> {
  const uniqueSortedLabels = Array.from(
    new Set(labels.map((label) => label.trim()).filter((label) => label.length > 0)),
  ).sort((a, b) => a.localeCompare(b, 'ko'))

  const colorMap = new Map<string, string>()
  uniqueSortedLabels.forEach((label, index) => {
    colorMap.set(label, getPaletteColorByIndex(index))
  })
  return colorMap
}

export function pickLabelColor(label: string, colorMap: Map<string, string>): string {
  const normalized = label.trim()
  if (!normalized) return getPaletteColorByIndex(0)
  return colorMap.get(normalized) ?? getPaletteColorByIndex(normalized.length)
}
