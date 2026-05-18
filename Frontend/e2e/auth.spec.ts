import { test, expect, type Page } from '@playwright/test'

/**
 * 로그인·회원가입 E2E 테스트.
 *
 * 전제: 백엔드가 http://localhost:8000에서 실행 중이거나 MSW로 대체됨.
 * storageState를 사용해 인증 상태를 fixture로 재사용합니다.
 */

const BASE = 'http://localhost:5173'

async function fillLoginForm(page: Page, email: string, password: string) {
  await page.fill('input[placeholder*="이메일"]', email)
  await page.fill('input[placeholder*="비밀번호"]', password)
}

test.describe('로그인 플로우', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/login`)
    // 로컬스토리지 초기화
    await page.evaluate(() => localStorage.clear())
  })

  test('로그인 페이지가 렌더링됩니다', async ({ page }) => {
    await expect(page.locator('input[placeholder*="이메일"]')).toBeVisible()
    await expect(page.locator('input[placeholder*="비밀번호"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /로그인/ })).toBeVisible()
  })

  test('빈 폼으로 제출 시 에러가 표시됩니다', async ({ page }) => {
    await page.getByRole('button', { name: /로그인/ }).click()
    // 브라우저 기본 유효성 검사 또는 커스텀 에러 메시지 확인
    await expect(
      page.locator('input[placeholder*="이메일"]'),
    ).toBeFocused()
  })

  test('회원가입 화면에서 멤버 탭 선택 시 초대코드 입력창이 나타납니다', async ({ page }) => {
    await page.goto(`${BASE}/signup`)
    await page.getByRole('tab', { name: /멤버/ }).click()
    await expect(page.locator('input[placeholder*="초대코드"]')).toBeVisible()
  })

  test('회원가입 화면에서 짧은 초대코드(6자 미만) 확인 시 에러 메시지가 표시됩니다', async ({ page }) => {
    await page.goto(`${BASE}/signup`)
    await page.getByRole('tab', { name: /멤버/ }).click()
    await page.locator('input[placeholder*="초대코드"]').fill('ABC')
    await page.getByRole('button', { name: /확인/ }).click()
    await expect(page.locator('text=초대코드를 확인해주세요')).toBeVisible()
  })
})

test.describe('회원가입 플로우', () => {
  test('멤버 회원가입 페이지가 기본으로 표시됩니다', async ({ page }) => {
    await page.goto(`${BASE}/signup`)
    await expect(page.getByRole('heading', { name: '멤버 회원가입' })).toBeVisible()
  })

  test('관리자 탭 선택 시 관리자 회원가입 제목과 워크스페이스 생성 가입 버튼이 표시됩니다', async ({ page }) => {
    await page.goto(`${BASE}/signup`)
    await page.getByRole('tab', { name: /관리자/ }).click()
    await expect(page.getByRole('heading', { name: '관리자 회원가입' })).toBeVisible()
    await expect(page.getByRole('button', { name: /워크스페이스 생성/ })).toBeVisible()
    await expect(page).not.toHaveURL(/error/)
  })
})
