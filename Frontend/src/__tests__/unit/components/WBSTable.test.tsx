import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import WbsPage from '../../../pages/meetings/WbsPage'

vi.mock('../../../data/mockWbs', () => ({
  WBS_M1: [
    {
      id: 'epic-1',
      title: '백엔드 API 개발',
      progress: 30,
      tasks: [
        {
          id: 'task-1',
          epicId: 'epic-1',
          title: '인증 엔드포인트 구현',
          assigneeName: '홍길동',
          status: 'todo',
          priority: 'urgent',
          dueDate: new Date(Date.now() + 5 * 86400_000).toISOString(),
          progress: 0,
        },
        {
          id: 'task-2',
          epicId: 'epic-1',
          title: '회의 CRUD API',
          assigneeName: '김철수',
          status: 'inprogress',
          priority: 'high',
          dueDate: new Date(Date.now() + 10 * 86400_000).toISOString(),
          progress: 50,
        },
      ],
    },
  ],
}))

function renderWbsPage(meetingId = 'm1') {
  return render(
    <MemoryRouter initialEntries={[`/meetings/${meetingId}/wbs`]}>
      <Routes>
        <Route path="/meetings/:meetingId/wbs" element={<WbsPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('WbsPage', () => {
  describe('렌더링', () => {
    it('페이지 제목이 표시됩니다', () => {
      renderWbsPage()
      expect(screen.getByText('WBS · 태스크 리스트')).toBeInTheDocument()
    })

    it('에픽 제목이 표시됩니다', () => {
      renderWbsPage()
      expect(screen.getByText('백엔드 API 개발')).toBeInTheDocument()
    })

    it('태스크 제목이 표시됩니다', () => {
      renderWbsPage()
      // 모바일·데스크톱 레이아웃 모두 렌더링되므로 getAllByText 사용
      expect(screen.getAllByText('인증 엔드포인트 구현').length).toBeGreaterThan(0)
      expect(screen.getAllByText('회의 CRUD API').length).toBeGreaterThan(0)
    })

    it('태스크 담당자가 표시됩니다', () => {
      renderWbsPage()
      expect(screen.getAllByText('홍길동').length).toBeGreaterThan(0)
      expect(screen.getAllByText('김철수').length).toBeGreaterThan(0)
    })

    it('에픽의 태스크 개수가 표시됩니다', () => {
      renderWbsPage()
      expect(screen.getByText('2개 태스크')).toBeInTheDocument()
    })

    it('meeting_id가 URL에서 읽혀 페이지에 표시됩니다', () => {
      renderWbsPage('meeting-123')
      expect(screen.getByText(/meeting-123/)).toBeInTheDocument()
    })

    it('에픽 진행률이 표시됩니다', () => {
      renderWbsPage()
      expect(screen.getByText('30%')).toBeInTheDocument()
    })
  })

  describe('에픽 접기/펼치기', () => {
    it('초기에는 태스크가 보입니다', () => {
      renderWbsPage()
      expect(screen.getAllByText('인증 엔드포인트 구현').length).toBeGreaterThan(0)
    })

    it('에픽 버튼 클릭 시 태스크가 숨겨집니다', () => {
      renderWbsPage()
      const buttons = screen.getAllByRole('button')
      const epicButton = buttons.find((b) => b.textContent?.includes('백엔드 API 개발'))
      expect(epicButton).toBeTruthy()
      fireEvent.click(epicButton!)
      // 접힌 후 태스크 제목이 없어야 함
      expect(screen.queryAllByText('인증 엔드포인트 구현').length).toBe(0)
    })

    it('접힌 에픽을 다시 클릭하면 태스크가 표시됩니다', () => {
      renderWbsPage()
      const buttons = screen.getAllByRole('button')
      const epicButton = buttons.find((b) => b.textContent?.includes('백엔드 API 개발'))!
      fireEvent.click(epicButton) // 접기
      fireEvent.click(epicButton) // 펼치기
      expect(screen.getAllByText('인증 엔드포인트 구현').length).toBeGreaterThan(0)
    })
  })

  describe('태스크 상태 변경', () => {
    it('상태 드롭다운이 렌더링됩니다', () => {
      renderWbsPage()
      const selects = screen.getAllByRole('combobox')
      expect(selects.length).toBeGreaterThan(0)
    })

    it('상태 드롭다운에서 done을 선택할 수 있습니다', () => {
      renderWbsPage()
      const selects = screen.getAllByRole('combobox')
      fireEvent.change(selects[0], { target: { value: 'done' } })
      expect(selects[0]).toHaveValue('done')
    })
  })
})
