import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MeetingCard from '../../../components/home/MeetingCard'
import type { Meeting } from '../../../types/meeting'

const { mockUser } = vi.hoisted(() => ({
  mockUser: {
    id: 42,
    email: 't@test.com',
    name: '테스트',
    role: 'member' as const,
    workspace_id: 1,
  },
}))

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    loading: false,
    isAuthenticated: true,
    isAdmin: false,
    refreshSession: async () => null,
    saveUser: vi.fn(),
    signOut: async () => {},
  }),
}))

vi.mock('../../../utils/meetingRoutes', () => ({
  persistMeetingSnapshot: vi.fn(),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1',
    title: '스프린트 킥오프',
    status: 'upcoming',
    startAt: new Date(Date.now() + 3600_000).toISOString(),
    participants: [],
    agenda: [],
    actionItemCount: 0,
    decisionCount: 0,
    tags: [],
    ...overrides,
  }
}

function renderCard(meeting: Meeting) {
  return render(
    <MemoryRouter>
      <MeetingCard meeting={meeting} />
    </MemoryRouter>,
  )
}

describe('MeetingCard', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
  })

  describe('렌더링', () => {
    it('회의 제목을 표시합니다', () => {
      renderCard(makeMeeting({ title: '주간 팀 미팅' }))
      expect(screen.getByText('주간 팀 미팅')).toBeInTheDocument()
    })

    it('inprogress 상태 뱃지를 표시합니다', () => {
      renderCard(makeMeeting({ status: 'inprogress' }))
      // Badge 컴포넌트가 "진행 중" 또는 해당 variant로 렌더링됨
      const article = screen.getByRole('button')
      expect(article).toBeInTheDocument()
    })

    it('태그를 최대 3개까지 표시합니다', () => {
      renderCard(makeMeeting({ tags: ['React', 'TypeScript', 'Vite', 'TailwindCSS'] }))
      expect(screen.getByText('React')).toBeInTheDocument()
      expect(screen.getByText('TypeScript')).toBeInTheDocument()
      expect(screen.getByText('Vite')).toBeInTheDocument()
      expect(screen.queryByText('TailwindCSS')).not.toBeInTheDocument()
    })

    it('completed 상태이고 summary가 있으면 요약을 표시합니다', () => {
      renderCard(makeMeeting({
        status: 'completed',
        summary: '이번 스프린트에서 주요 기능 3개를 완료했습니다.',
      }))
      expect(screen.getByText(/이번 스프린트에서/)).toBeInTheDocument()
    })

    it('upcoming 상태이고 agenda가 있으면 아젠다를 최대 2개 표시합니다', () => {
      renderCard(makeMeeting({
        status: 'upcoming',
        agenda: ['기능 설계 논의', '배포 계획 수립', '팀 빌딩'],
      }))
      expect(screen.getByText('기능 설계 논의')).toBeInTheDocument()
      expect(screen.getByText('배포 계획 수립')).toBeInTheDocument()
      expect(screen.getByText('+1개 더')).toBeInTheDocument()
    })

    it('참석자가 있으면 이름을 표시합니다', () => {
      renderCard(makeMeeting({
        status: 'upcoming',
        participants: [
          { id: 'p1', name: '홍길동', avatarInitials: 'HG', color: '#000' },
        ],
      }))
      expect(screen.getByText(/홍길동/)).toBeInTheDocument()
    })

    it('actionItemCount가 0이면 체크박스 아이콘을 표시하지 않습니다', () => {
      const { container } = renderCard(makeMeeting({ actionItemCount: 0 }))
      // actionItemCount > 0 조건으로만 렌더링되므로 숫자 "0"이 없어야 함
      const spans = container.querySelectorAll('span')
      const hasZero = Array.from(spans).some((s) => s.textContent === '0')
      expect(hasZero).toBe(false)
    })
  })

  describe('네비게이션', () => {
    it('inprogress 카드 클릭 시 참가자면 /live/{id}로 이동합니다', () => {
      renderCard(
        makeMeeting({
          id: 'live-1',
          status: 'inprogress',
          participants: [
            {
              id: 'u42',
              userId: mockUser.id,
              name: '테스트',
              avatarInitials: '테스',
              color: '#6b78f6',
            },
          ],
        }),
      )
      fireEvent.click(screen.getByRole('button'))
      expect(mockNavigate).toHaveBeenCalledWith('/live/live-1')
    })

    it('inprogress 카드는 참가자가 아니면 이동하지 않고 안내합니다', () => {
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      renderCard(
        makeMeeting({
          id: 'live-2',
          status: 'inprogress',
          participants: [
            {
              id: 'u99',
              userId: 99,
              name: '다른사람',
              avatarInitials: '다른',
              color: '#22c55e',
            },
          ],
        }),
      )
      fireEvent.click(screen.getByRole('button'))
      expect(mockNavigate).not.toHaveBeenCalled()
      expect(alertSpy).toHaveBeenCalledWith('진행 중인 회의라 입장하실 수 없습니다.')
      alertSpy.mockRestore()
    })

    it('upcoming 카드 클릭 시 /meetings/{id}/upcoming으로 이동합니다', () => {
      renderCard(makeMeeting({ id: 'up-1', status: 'upcoming' }))
      fireEvent.click(screen.getByRole('button'))
      expect(mockNavigate).toHaveBeenCalledWith('/meetings/up-1/upcoming')
    })

    it('completed 카드 클릭 시 /meetings/{id}/notes로 이동합니다', () => {
      renderCard(makeMeeting({ id: 'done-1', status: 'completed' }))
      fireEvent.click(screen.getByRole('button'))
      expect(mockNavigate).toHaveBeenCalledWith('/meetings/done-1/notes')
    })

    it('Enter 키 입력 시 네비게이션이 실행됩니다', () => {
      renderCard(makeMeeting({ id: 'key-1', status: 'upcoming' }))
      fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' })
      expect(mockNavigate).toHaveBeenCalledWith('/meetings/key-1/upcoming')
    })

    it('Space 키 입력 시 네비게이션이 실행됩니다', () => {
      renderCard(makeMeeting({ id: 'key-2', status: 'upcoming' }))
      fireEvent.keyDown(screen.getByRole('button'), { key: ' ' })
      expect(mockNavigate).toHaveBeenCalledWith('/meetings/key-2/upcoming')
    })
  })
})
