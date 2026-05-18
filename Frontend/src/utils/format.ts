/** Format ISO date as relative time string (Korean) */
export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return '방금 전'
  if (minutes < 60) return `${minutes}분 전`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}시간 전`
  const days = Math.floor(hours / 24)
  return `${days}일 전`
}

/** Format ISO date as HH:MM or "내일 HH:MM" etc. */
export function formatTime(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  // "오늘/내일" 판단은 시간 차이가 아니라 '로컬 날짜' 차이로 계산해야 자정 근처에서 틀어지지 않음
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const diffDays = Math.round((dayStart - nowStart) / (1000 * 60 * 60 * 24))

  const timeStr = date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })

  if (diffDays < 0) {
    return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) + ' ' + timeStr
  }
  if (diffDays === 0) return `오늘 ${timeStr}`
  if (diffDays === 1) return `내일 ${timeStr}`
  return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) + ' ' + timeStr
}

/** Short date: M월 D일 */
export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
}

/** Full date: YYYY년 M월 D일 HH:MM */
export function formatDateFull(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** Is this date in the past? */
export function isPast(iso: string): boolean {
  return new Date(iso).getTime() < Date.now()
}

/** Meeting duration in minutes */
export function durationMinutes(startIso: string, endIso?: string): number {
  const end = endIso ? new Date(endIso) : new Date()
  return Math.round((end.getTime() - new Date(startIso).getTime()) / 60_000)
}
