import { test, expect } from '@playwright/test'

/**
 * WBS 생성·수정·삭제 E2E 테스트.
 *
 * 현재 WBS는 mockWbs 데이터를 사용합니다.
 * AI 자동 생성 확인 → 에픽·태스크 수정 시나리오를 검증합니다.
 */

const BASE = 'http://localhost:5173'

test.describe('WBS 페이지', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/meetings/m1/wbs`)
  })

  test('WBS 페이지 제목이 표시됩니다', async ({ page }) => {
    await expect(page.getByText('WBS · 태스크 리스트')).toBeVisible()
  })

  test('AI 자동 생성 배너가 표시됩니다', async ({ page }) => {
    await expect(page.locator('text=AI가 회의 내용을 기반으로')).toBeVisible()
  })

  test('에픽 목록이 표시됩니다', async ({ page }) => {
    // mockWbs의 첫 번째 에픽 제목 확인
    const epicTitles = page.locator('button').filter({ hasText: /태스크/ })
    await expect(epicTitles.first()).toBeVisible()
  })

  test('태스크 상태를 변경할 수 있습니다', async ({ page }) => {
    const selects = page.locator('select')
    const firstSelect = selects.first()
    await firstSelect.selectOption('done')
    await expect(firstSelect).toHaveValue('done')
  })

  test('에픽 접기 토글이 동작합니다', async ({ page }) => {
    // 에픽 헤더 버튼 클릭해서 접기
    const epicHeaders = page.locator('button').filter({ hasText: /태스크/ })
    const count = await selects_before(page)

    await epicHeaders.first().click()
    // select(상태 드롭다운)가 줄어야 함
    const countAfter = await page.locator('select').count()
    expect(countAfter).toBeLessThan(count)
  })

  test('JIRA 동기화 버튼이 존재합니다', async ({ page }) => {
    await expect(page.getByRole('button', { name: /JIRA 동기화/ })).toBeVisible()
  })

  test('에픽 추가 버튼이 존재합니다', async ({ page }) => {
    await expect(page.getByRole('button', { name: /에픽 추가/ })).toBeVisible()
  })

  test('태스크 추가 버튼이 존재합니다', async ({ page }) => {
    await expect(page.getByRole('button', { name: /태스크 추가/ }).first()).toBeVisible()
  })
})

async function selects_before(page: import('@playwright/test').Page) {
  return page.locator('select').count()
}
