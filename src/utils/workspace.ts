const KEY = 'workb-workspace-id'
const LEGACY_KEY = 'workb-current-workspace-id'
const ROLE_KEY = 'workb-workspace-role'
export const WORKSPACE_CHANGED_EVENT = 'workb-workspace-changed'
export const WORKSPACE_ROLE_CHANGED_EVENT = 'workb-workspace-role-changed'

/**
 * 현재 선택된 워크스페이스 numeric id를 반환.
 * - 아직 백엔드 워크스페이스 목록 API가 없어서, 기본값은 1.
 */
export function getCurrentWorkspaceId(): number {
  const raw =
    sessionStorage.getItem(KEY) ??
    sessionStorage.getItem(LEGACY_KEY) ??
    localStorage.getItem(KEY) ??
    localStorage.getItem(LEGACY_KEY)
  const n = raw ? Number(raw) : NaN
  if (Number.isFinite(n) && n > 0) {
    sessionStorage.setItem(KEY, String(n))
    sessionStorage.setItem(LEGACY_KEY, String(n))
    localStorage.setItem(KEY, String(n))
    localStorage.setItem(LEGACY_KEY, String(n))
  }
  return Number.isFinite(n) && n > 0 ? n : 1
}

export function setCurrentWorkspaceId(id: number): void {
  if (!Number.isFinite(id) || id <= 0) return
  sessionStorage.setItem(KEY, String(id))
  sessionStorage.setItem(LEGACY_KEY, String(id))
  localStorage.setItem(KEY, String(id))
  localStorage.setItem(LEGACY_KEY, String(id))
  // 같은 탭에서는 storage 이벤트가 안 떠서 커스텀 이벤트로 통지
  window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGED_EVENT, { detail: { id } }))
}

export type WorkspaceRole = 'admin' | 'member' | 'viewer' | string

export function getCurrentWorkspaceRole(): WorkspaceRole {
  const role = sessionStorage.getItem(ROLE_KEY) ?? localStorage.getItem(ROLE_KEY)
  if (role) {
    sessionStorage.setItem(ROLE_KEY, role)
    localStorage.setItem(ROLE_KEY, role)
  }
  return role ?? 'member'
}

export function setCurrentWorkspaceRole(role: WorkspaceRole): void {
  const normalized = typeof role === 'string' && role.length > 0 ? role : 'member'
  sessionStorage.setItem(ROLE_KEY, normalized)
  localStorage.setItem(ROLE_KEY, normalized)
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_ROLE_CHANGED_EVENT, { detail: { role: normalized } }),
  )
}
