import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatFAB from '../../../components/chat/ChatFAB'

vi.mock('../../../data/mockChatMessages', () => ({
  GLOBAL_CHAT_MESSAGES: [],
}))

function renderFAB() {
  return render(<ChatFAB />)
}

describe('ChatFAB', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('초기 상태', () => {
    it('AI 도우미 버튼이 렌더링됩니다', () => {
      renderFAB()
      expect(screen.getByRole('button', { name: 'AI 도우미 열기' })).toBeInTheDocument()
    })

    it('초기에는 채팅 패널이 닫혀 있습니다', () => {
      renderFAB()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  describe('패널 열기/닫기', () => {
    it('FAB 클릭 시 채팅 패널이 열립니다', async () => {
      const user = userEvent.setup()
      renderFAB()
      await user.click(screen.getByRole('button', { name: 'AI 도우미 열기' }))
      expect(screen.getByRole('dialog', { name: 'Workb AI 도우미' })).toBeInTheDocument()
    })

    it('패널 닫기 버튼 클릭 시 패널이 닫힙니다', async () => {
      const user = userEvent.setup()
      renderFAB()
      await user.click(screen.getByRole('button', { name: 'AI 도우미 열기' }))
      await user.click(screen.getByRole('button', { name: '닫기' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('Escape 키 입력 시 패널이 닫힙니다', async () => {
      const user = userEvent.setup()
      renderFAB()
      await user.click(screen.getByRole('button', { name: 'AI 도우미 열기' }))
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('FAB 재클릭 시 패널이 닫힙니다', async () => {
      const user = userEvent.setup()
      renderFAB()
      const fab = screen.getByRole('button', { name: 'AI 도우미 열기' })
      await user.click(fab)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      await user.click(fab)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  describe('칩 힌트', () => {
    it('패널이 열리면 4개의 칩 힌트가 표시됩니다', async () => {
      const user = userEvent.setup()
      renderFAB()
      await user.click(screen.getByRole('button', { name: 'AI 도우미 열기' }))
      expect(screen.getByText('현재 회의 요약')).toBeInTheDocument()
      expect(screen.getByText('액션 아이템 조회')).toBeInTheDocument()
      expect(screen.getByText('다음 회의 일정')).toBeInTheDocument()
      expect(screen.getByText('자료 검색')).toBeInTheDocument()
    })

    it('칩 클릭 시 입력창에 해당 텍스트가 채워집니다', async () => {
      const user = userEvent.setup()
      renderFAB()
      await user.click(screen.getByRole('button', { name: 'AI 도우미 열기' }))
      await user.click(screen.getByText('현재 회의 요약'))
      const input = screen.getByPlaceholderText('무엇이든 물어보세요...')
      expect(input).toHaveValue('현재 회의 요약')
    })
  })

  describe('메시지 전송', () => {
    it('텍스트 입력 후 전송 버튼 클릭 시 사용자 메시지가 추가됩니다', async () => {
      const user = userEvent.setup()
      renderFAB()
      await user.click(screen.getByRole('button', { name: 'AI 도우미 열기' }))

      const input = screen.getByPlaceholderText('무엇이든 물어보세요...')
      await user.type(input, '오늘 회의 요약해줘')
      await user.click(screen.getByRole('button', { name: '전송' }))

      expect(screen.getByText('오늘 회의 요약해줘')).toBeInTheDocument()
    })

    it('전송 후 입력창이 비워집니다', async () => {
      const user = userEvent.setup()
      renderFAB()
      await user.click(screen.getByRole('button', { name: 'AI 도우미 열기' }))

      const input = screen.getByPlaceholderText('무엇이든 물어보세요...')
      await user.type(input, '안녕하세요')
      await user.click(screen.getByRole('button', { name: '전송' }))

      expect(input).toHaveValue('')
    })

    it('입력이 비어 있으면 전송 버튼이 비활성화됩니다', async () => {
      const user = userEvent.setup()
      renderFAB()
      await user.click(screen.getByRole('button', { name: 'AI 도우미 열기' }))
      expect(screen.getByRole('button', { name: '전송' })).toBeDisabled()
    })

    it('800ms 후 AI 응답 메시지가 추가됩니다', async () => {
      const user = userEvent.setup()
      renderFAB()
      await user.click(screen.getByRole('button', { name: 'AI 도우미 열기' }))

      await user.type(screen.getByPlaceholderText('무엇이든 물어보세요...'), '질문입니다')
      await user.click(screen.getByRole('button', { name: '전송' }))

      await waitFor(
        () =>
          expect(
            screen.getByText('네, 확인했습니다. 해당 내용은 회의 기록에 반영하겠습니다.'),
          ).toBeInTheDocument(),
        { timeout: 2000 },
      )
    }, 5000)

    it('빈 문자열(공백만 있는 경우)은 전송되지 않습니다', async () => {
      const user = userEvent.setup()
      renderFAB()
      await user.click(screen.getByRole('button', { name: 'AI 도우미 열기' }))

      const input = screen.getByPlaceholderText('무엇이든 물어보세요...')
      await user.type(input, '   ')
      // 공백만 있으면 전송 버튼이 비활성화됨
      expect(screen.getByRole('button', { name: '전송' })).toBeDisabled()
    })
  })

  describe('헤더', () => {
    it('패널 헤더에 Workb 도우미 타이틀이 표시됩니다', async () => {
      const user = userEvent.setup()
      renderFAB()
      await user.click(screen.getByRole('button', { name: 'AI 도우미 열기' }))
      expect(screen.getByText('Workb 도우미')).toBeInTheDocument()
    })
  })
})
