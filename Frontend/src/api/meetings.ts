import type { Meeting } from '../types/meeting'
import { apiRequest } from './client'
import { mapApiMeetingItemToMeeting, type BackendMeetingItem } from './dashboard'

interface MeetingDetailResponseBody {
  success: boolean
  data: BackendMeetingItem
  message?: string
}

interface MeetingSearchItem {
  meeting_id: number
  title: string
  scheduled_at?: string | null
  participants?: { user_id: number; name: string }[]
  summary?: string | null
  status?: 'scheduled' | 'in_progress' | 'done'
}

interface MeetingSearchResponseBody {
  success: boolean
  data: { meetings: MeetingSearchItem[] }
  message?: string
}

function toDateParam(d: Date): string {
  // backend expects YYYY-MM-DD
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * GET /api/v1/meetings/workspaces/{workspaceId}/{meetingId}
 * 홈·캘린더 등에서 숫자 id로 연 회의 상세(예정/진행/완료 공통 스키마).
 */
export async function fetchWorkspaceMeetingDetail(
  workspaceId: number,
  meetingId: number,
): Promise<Meeting> {
  const body = await apiRequest<MeetingDetailResponseBody>(
    `/meetings/workspaces/${workspaceId}/${meetingId}`,
  )
  if (!body.data) {
    throw new Error('Meeting detail API: empty data')
  }
  return mapApiMeetingItemToMeeting(body.data)
}

/**
 * GET /api/v1/knowledges/workspaces/{workspaceId}/meetings/search
 * 캘린더용: 워크스페이스 회의를 기간으로 조회.
 */
export async function fetchWorkspaceMeetingsByDateRange(
  workspaceId: number,
  from: Date,
  to: Date,
): Promise<MeetingSearchItem[]> {
  const qs = new URLSearchParams({
    from_date: toDateParam(from),
    to_date: toDateParam(to),
  })
  const body = await apiRequest<MeetingSearchResponseBody>(
    `/knowledges/workspaces/${workspaceId}/meetings/search?${qs.toString()}`,
  )
  return body.data?.meetings ?? []
}

export async function startWorkspaceMeeting(workspaceId: number, meetingId: number): Promise<void> {
  await apiRequest(`/meetings/workspaces/${workspaceId}/${meetingId}/start`, { method: 'POST' })
}

export async function endWorkspaceMeeting(workspaceId: number, meetingId: number): Promise<void> {
  await apiRequest(`/meetings/workspaces/${workspaceId}/${meetingId}/end`, { method: 'POST' })
}

export interface SimulateWavResult {
  status: string
  meeting_id: number
  utterance_count: number
}

export async function simulateWav(
  workspaceId: number,
  meetingId: number,
  file: File,
): Promise<SimulateWavResult> {
  const form = new FormData()
  form.append('file', file)
  return apiRequest<SimulateWavResult>(
    `/meetings/workspaces/${workspaceId}/${meetingId}/simulate-wav`,
    { method: 'POST', body: form },
  )
}

export interface MinutePhoto {
  id: number
  minute_id: number
  photo_url: string
  taken_at: string
  taken_by: number
}

interface MinutePhotoUploadResponseBody {
  success: boolean
  photo: MinutePhoto
  message?: string
}

export async function uploadMinutePhoto(
  workspaceId: number,
  meetingId: number,
  imageBlob: Blob,
): Promise<MinutePhoto> {
  const form = new FormData()
  form.append('file', imageBlob, 'capture.png')
  const body = await apiRequest<MinutePhotoUploadResponseBody>(
    `/meetings/workspaces/${workspaceId}/${meetingId}/minute-photos`,
    { method: 'POST', body: form },
  )
  if (!body.photo) throw new Error('Minute photo upload failed: empty response')
  return body.photo
}

export interface MeetingHistoryItem {
  id: number
  title: string
  status: string
  scheduled_at?: string | null
  started_at?: string | null
  ended_at?: string | null
  summary?: string | null
}

export interface MeetingHistoryResult {
  total: number
  page: number
  meetings: MeetingHistoryItem[]
}

export async function fetchScheduledMeetings(
  workspaceId: number,
  page = 1,
  size = 20,
  keyword = '',
): Promise<MeetingHistoryResult> {
  const params = new URLSearchParams({ page: String(page), size: String(size) })
  if (keyword) params.append('keyword', keyword)
  const data = await apiRequest<MeetingHistoryResult>(
    `/meetings/workspaces/${workspaceId}/history?${params}`,
  )
  return {
    ...data,
    meetings: data.meetings.filter((m) => m.status === 'scheduled' || m.status === 'in_progress'),
  }
}

export async function fetchDoneMeetings(
  workspaceId: number,
  page = 1,
  size = 10,
  keyword = '',
): Promise<MeetingHistoryResult> {
  const params = new URLSearchParams({ page: String(page), size: String(size) })
  if (keyword) params.append('keyword', keyword)
  const data = await apiRequest<MeetingHistoryResult>(
    `/meetings/workspaces/${workspaceId}/history?${params}`,
  )
  return {
    ...data,
    meetings: data.meetings.filter((m) => m.status === 'done'),
  }
}
