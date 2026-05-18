import type { Meeting } from '../types/meeting'

const SNAPSHOT_KEY = (id: string) => `workb-meeting-snapshot:${id}`

/**
 * 홈·히스토리 등에서 상세로 이동하기 직전에 호출.
 * API 숫자 id(`7`) 회의는 목업 MEETINGS와 다르므로 스냅샷으로 제목·일시 등을 넘김.
 */
export function persistMeetingSnapshot(meeting: Meeting): void {
  try {
    sessionStorage.setItem(SNAPSHOT_KEY(meeting.id), JSON.stringify(meeting))
  } catch {
    /* storage full / private mode */
  }
}

function readSnapshot(id: string): Meeting | null {
  try {
    const raw = sessionStorage.getItem(SNAPSHOT_KEY(id))
    if (!raw) return null
    return JSON.parse(raw) as Meeting
  } catch {
    return null
  }
}

/**
 * 라우트 param(`meetingId`)으로 스냅샷 조회.
 * `/meetings/m7/...` 예전 URL이면 숫자 키(`7`)도 시도.
 */
export function readMeetingSnapshotForRoute(meetingId: string | undefined): Meeting | null {
  if (!meetingId) return null
  return readSnapshot(meetingId) ?? (meetingId.startsWith('m') ? readSnapshot(meetingId.slice(1)) : null)
}
