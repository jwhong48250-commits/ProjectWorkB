import { test, expect } from '@playwright/test'

/**
 * 챗봇 패널 E2E 테스트.
 *
 * ChatFAB 컴포넌트가 마운트된 페이지(홈, 라이브 등)에서 실행합니다.
 */

const BASE = 'http://localhost:5173'

test.describe('챗봇 FAB', () => {
  test.beforeEach(async ({ page }) => {
    // 홈 페이지로 이동 (ChatFAB이 AppShell에 포함)
    await page.goto(BASE)
  })

  test('AI 도우미 버튼이 화면에 표시됩니다', async ({ page }) => {
    const fab = page.getByRole('button', { name: 'AI 도우미 열기' })
    await expect(fab).toBeVisible()
  })

  test('FAB 클릭 시 채팅 패널이 열립니다', async ({ page }) => {
    await page.getByRole('button', { name: 'AI 도우미 열기' }).click()
    await expect(page.getByRole('dialog', { name: 'Workb AI 도우미' })).toBeVisible()
  })

  test('채팅 패널에 칩 힌트 4개가 표시됩니다', async ({ page }) => {
    await page.getByRole('button', { name: 'AI 도우미 열기' }).click()
    await expect(page.getByText('현재 회의 요약')).toBeVisible()
    await expect(page.getByText('액션 아이템 조회')).toBeVisible()
    await expect(page.getByText('다음 회의 일정')).toBeVisible()
    await expect(page.getByText('자료 검색')).toBeVisible()
  })

  test('칩 클릭 시 입력창에 텍스트가 채워집니다', async ({ page }) => {
    await page.getByRole('button', { name: 'AI 도우미 열기' }).click()
    await page.getByText('현재 회의 요약').click()
    await expect(page.locator('input[placeholder*="무엇이든"]')).toHaveValue('현재 회의 요약')
  })

  test('메시지 입력 후 전송 버튼이 활성화됩니다', async ({ page }) => {
    await page.getByRole('button', { name: 'AI 도우미 열기' }).click()
    const input = page.locator('input[placeholder*="무엇이든"]')
    await input.fill('테스트 질문입니다')
    await expect(page.getByRole('button', { name: '전송' })).toBeEnabled()
  })

  test('메시지 전송 후 사용자 메시지가 채팅에 표시됩니다', async ({ page }) => {
    await page.getByRole('button', { name: 'AI 도우미 열기' }).click()
    const input = page.locator('input[placeholder*="무엇이든"]')
    await input.fill('오늘 회의 요약해줘')
    await page.getByRole('button', { name: '전송' }).click()
    await expect(page.locator('text=오늘 회의 요약해줘')).toBeVisible()
  })

  test('800ms 후 AI 응답이 표시됩니다', async ({ page }) => {
    await page.getByRole('button', { name: 'AI 도우미 열기' }).click()
    const input = page.locator('input[placeholder*="무엇이든"]')
    await input.fill('테스트')
    await page.getByRole('button', { name: '전송' }).click()

    await expect(
      page.locator('text=네, 확인했습니다. 해당 내용은 회의 기록에 반영하겠습니다.'),
    ).toBeVisible({ timeout: 2000 })
  })

  test('닫기 버튼 클릭 시 패널이 닫힙니다', async ({ page }) => {
    await page.getByRole('button', { name: 'AI 도우미 열기' }).click()
    await page.getByRole('button', { name: '닫기' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })

  test('Escape 키 입력 시 패널이 닫힙니다', async ({ page }) => {
    await page.getByRole('button', { name: 'AI 도우미 열기' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })
})
