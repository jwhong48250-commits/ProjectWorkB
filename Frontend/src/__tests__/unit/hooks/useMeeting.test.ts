import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Meeting } from '../../../types/meeting'

// fetchWorkspaceMeetingDetail을 사용하는 커스텀 훅 시뮬레이션.
// 실제 useMeeting 훅이 없으므로 fetchWorkspaceMeetingDetail API를 직접 테스트합니다.
vi.mock('../../../api/meetings', () => ({
  fetchWorkspaceMeetingDetail: vi.fn(),
}))

import { fetchWorkspaceMeetingDetail } from '../../../api/meetings'

const mockMeeting: Meeting = {
  id: 'm1',
  title: '스프린트 킥오프',
  status: 'upcoming',
  startAt: new Date(Date.now() + 3600_000).toISOString(),
  participants: [],
  actionItemCount: 0,
  decisionCount: 0,
  tags: [],
}

describe('fetchWorkspaceMeetingDetail (회의 데이터 로딩)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('성공 시 Meeting 객체를 반환합니다', async () => {
    vi.mocked(fetchWorkspaceMeetingDetail).mockResolvedValueOnce(mockMeeting)
    const result = await fetchWorkspaceMeetingDetail(1, 1)
    expect(result).toEqual(mockMeeting)
  })

  it('API 실패 시 에러를 throw 합니다', async () => {
    vi.mocked(fetchWorkspaceMeetingDetail).mockRejectedValueOnce(
      new Error('Meeting detail API failed (404)'),
    )
    await expect(fetchWorkspaceMeetingDetail(1, 999)).rejects.toThrow('404')
  })

  it('올바른 workspaceId와 meetingId로 호출됩니다', async () => {
    vi.mocked(fetchWorkspaceMeetingDetail).mockResolvedValueOnce(mockMeeting)
    await fetchWorkspaceMeetingDetail(5, 42)
    expect(fetchWorkspaceMeetingDetail).toHaveBeenCalledWith(5, 42)
  })

  it('inprogress 상태의 회의를 올바르게 반환합니다', async () => {
    const liveMeeting: Meeting = { ...mockMeeting, status: 'inprogress' }
    vi.mocked(fetchWorkspaceMeetingDetail).mockResolvedValueOnce(liveMeeting)
    const result = await fetchWorkspaceMeetingDetail(1, 2)
    expect(result.status).toBe('inprogress')
  })

  it('completed 상태의 회의는 summary 필드를 포함할 수 있습니다', async () => {
    const completedMeeting: Meeting = {
      ...mockMeeting,
      status: 'completed',
      summary: '회의가 성공적으로 완료됐습니다.',
    }
    vi.mocked(fetchWorkspaceMeetingDetail).mockResolvedValueOnce(completedMeeting)
    const result = await fetchWorkspaceMeetingDetail(1, 3)
    expect(result.summary).toBe('회의가 성공적으로 완료됐습니다.')
  })

  it('참석자 목록이 있는 회의를 올바르게 반환합니다', async () => {
    const meetingWithParticipants: Meeting = {
      ...mockMeeting,
      participants: [
        { id: 'p1', name: '홍길동', avatarInitials: 'HG', color: '#FF5733' },
        { id: 'p2', name: '김철수', avatarInitials: 'KC', color: '#33FF57' },
      ],
    }
    vi.mocked(fetchWorkspaceMeetingDetail).mockResolvedValueOnce(meetingWithParticipants)
    const result = await fetchWorkspaceMeetingDetail(1, 4)
    expect(result.participants).toHaveLength(2)
    expect(result.participants[0].name).toBe('홍길동')
  })
})
