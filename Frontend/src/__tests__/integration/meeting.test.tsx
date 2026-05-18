import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../../data/mockWbs', () => ({
  WBS_M1: [
    {
      id: 'e1',
      title: '온보딩 플로우 개선',
      progress: 20,
      tasks: [
        {
          id: 't1',
          epicId: 'e1',
          title: 'UX 리서치 초안 작성',
          assigneeName: '박준혁',
          priority: 'urgent',
          status: 'inprogress',
          progress: 40,
        },
      ],
    },
  ],
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

import WbsPage from '../../pages/meetings/WbsPage'

describe('회의 플로우 통합 테스트', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNavigate.mockClear()
  })

  describe('WBS 플로우', () => {
    function renderWbsPage() {
      return render(
        <MemoryRouter initialEntries={['/meetings/meeting-1/wbs']}>
          <Routes>
            <Route path="/meetings/:meetingId/wbs" element={<WbsPage />} />
          </Routes>
        </MemoryRouter>,
      )
    }

    it('WBS 페이지가 렌더링됩니다', () => {
      renderWbsPage()
      expect(screen.getByText('WBS · 태스크 리스트')).toBeInTheDocument()
    })

    it('AI 자동 생성 안내 배너가 표시됩니다', () => {
      renderWbsPage()
      expect(screen.getByText(/AI가 회의 내용을 기반으로/)).toBeInTheDocument()
    })

    it('에픽과 태스크가 표시됩니다', () => {
      renderWbsPage()
      expect(screen.getByText('온보딩 플로우 개선')).toBeInTheDocument()
      expect(screen.getAllByText('UX 리서치 초안 작성').length).toBeGreaterThan(0)
    })

    it('에픽 접기 후 태스크가 숨겨집니다', async () => {
      renderWbsPage()
      const buttons = screen.getAllByRole('button')
      const epicButton = buttons.find((b) => b.textContent?.includes('온보딩 플로우 개선'))!
      await userEvent.click(epicButton)
      expect(screen.queryByText('UX 리서치 초안 작성')).not.toBeInTheDocument()
    })

    it('태스크 상태를 변경할 수 있습니다', async () => {
      renderWbsPage()
      const selects = screen.getAllByRole('combobox')
      await userEvent.selectOptions(selects[0], 'done')
      expect(selects[0]).toHaveValue('done')
    })
  })
})
