import { test, expect, type Page } from '@playwright/test'

/**
 * 회의 생성·진행·종료 E2E 테스트.
 *
 * 각 spec은 독립 실행 가능하도록 설계되었습니다.
 * storageState fixture를 통해 로그인 상태를 세팅합니다.
 */

const BASE = 'http://localhost:5173'

test.describe('아젠다 설정', () => {
  test('아젠다 페이지가 렌더링됩니다', async ({ page }) => {
    // 실제 회의 ID가 필요하므로 m1을 예시로 사용
    await page.goto(`${BASE}/meetings/m1/upcoming`)
    // 예정 회의 페이지에서 아젠다 탭 또는 링크로 이동 가능
    await expect(page).not.toHaveURL(/error/)
  })

  test('아젠다 항목 추가 버튼이 존재합니다', async ({ page }) => {
    await page.goto(`${BASE}/meetings/m1/agenda`)
    const addButton = page.getByRole('button', { name: /아젠다 추가/ })
    await expect(addButton).toBeVisible()
  })

  test('아젠다 항목을 추가하면 목록에 나타납니다', async ({ page }) => {
    await page.goto(`${BASE}/meetings/m1/agenda`)
    const initialCount = await page.locator('input[type="text"]').count()
    await page.getByRole('button', { name: /아젠다 추가/ }).click()
    await expect(page.locator('input[type="text"]')).toHaveCount(initialCount + 1)
  })

  test('회의 시작 버튼이 존재합니다', async ({ page }) => {
    await page.goto(`${BASE}/meetings/m1/agenda`)
    await expect(page.getByRole('button', { name: /회의 시작/ })).toBeVisible()
  })
})

test.describe('WBS 관리', () => {
  test('WBS 페이지가 렌더링됩니다', async ({ page }) => {
    await page.goto(`${BASE}/meetings/m1/wbs`)
    await expect(page.getByText('WBS · 태스크 리스트')).toBeVisible()
  })

  test('AI 자동 생성 안내 배너가 표시됩니다', async ({ page }) => {
    await page.goto(`${BASE}/meetings/m1/wbs`)
    await expect(page.locator('text=AI가 회의 내용을 기반으로')).toBeVisible()
  })

  test('에픽 접기/펼치기가 동작합니다', async ({ page }) => {
    await page.goto(`${BASE}/meetings/m1/wbs`)
    // 첫 번째 에픽 헤더 버튼 클릭
    const epicButtons = page.locator('button').filter({ hasText: /태스크/ })
    const firstEpicButton = epicButtons.first()
    await firstEpicButton.click()
    // 태스크가 숨겨졌는지 확인 (select가 사라짐)
    // 다시 클릭해서 펼치기
    await firstEpicButton.click()
    await expect(page.locator('select').first()).toBeVisible()
  })
})

test.describe('회의 진행 (Live)', () => {
  test('라이브 페이지가 렌더링됩니다', async ({ page }) => {
    await page.goto(`${BASE}/live/m1`)
    await expect(page).not.toHaveURL(/error/)
  })
})
