import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { AuthProvider, useAuth } from '../../../context/AuthContext'

// localStorage mock
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()

Object.defineProperty(window, 'localStorage', { value: localStorageMock })

vi.mock('../../../api/auth', () => ({
  logout: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../api/client', () => ({
  clearAuthTokens: vi.fn(),
  ensureAuthSession: vi.fn().mockResolvedValue(true),
  getRefreshToken: vi.fn(() => null),
  getStoredUser: vi.fn(() => null),
  hasStoredSession: vi.fn(() => false),
  setStoredUser: vi.fn(),
  syncStoredUserFromToken: vi.fn(() => null),
}))

import type { ReactNode } from 'react'
import React from 'react'

function wrapper({ children }: { children: ReactNode }) {
  return React.createElement(AuthProvider, null, children)
}

describe('useAuth', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('AuthProvider 외부에서 useAuth를 호출하면 에러가 발생합니다', () => {
    expect(() => {
      renderHook(() => useAuth())
    }).toThrow('useAuth must be used within AuthProvider')
  })

  it('초기 상태에서 user는 null이고 isAuthenticated는 false입니다', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(result.current.user).toBeNull()
    expect(result.current.isAuthenticated).toBe(false)
  })

  it('초기 상태에서 isAdmin은 false입니다', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(result.current.isAdmin).toBe(false)
  })

  it('saveUser 호출 시 user 상태가 업데이트됩니다', async () => {
    const { setStoredUser } = await import('../../../api/client')
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    const testUser = {
      id: 1,
      email: 'test@example.com',
      name: '홍길동',
      role: 'admin' as const,
      workspace_id: 1,
    }

    await act(async () => {
      result.current.saveUser(testUser)
    })

    expect(setStoredUser).toHaveBeenCalledWith(testUser)
    expect(result.current.user).toEqual(testUser)
  })

  it('saveUser로 admin 유저를 설정하면 isAdmin이 true가 됩니다', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    await act(async () => {
      result.current.saveUser({
        id: 1,
        email: 'admin@test.com',
        name: '관리자',
        role: 'admin',
        workspace_id: 1,
      })
    })

    expect(result.current.isAdmin).toBe(true)
  })

  it('signOut 호출 시 user가 null로 초기화됩니다', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    await act(async () => {
      result.current.saveUser({
        id: 1,
        email: 'test@test.com',
        name: '테스트',
        role: 'member',
        workspace_id: 1,
      })
    })

    await act(async () => {
      await result.current.signOut()
    })

    expect(result.current.user).toBeNull()
  })

  it('refreshSession에서 세션 없으면 null을 반환합니다', async () => {
    const { hasStoredSession } = await import('../../../api/client')
    vi.mocked(hasStoredSession).mockReturnValue(false)

    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    const refreshResult = await act(async () => {
      return result.current.refreshSession()
    })

    expect(refreshResult).toBeNull()
  })

  it('로딩 완료 후 loading이 false가 됩니다', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(result.current.loading).toBe(false)
  })
})
