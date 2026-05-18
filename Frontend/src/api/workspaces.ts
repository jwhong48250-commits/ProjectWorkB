import { apiRequest, getAccessToken, getRefreshToken } from './client'
import { getApiOrigin } from './baseUrl'
import { isUsableWorkspaceLogoUrl } from '../utils/workspaceLogo'

export type WorkspaceRole = 'admin' | 'member' | 'viewer' | string

export interface WorkspaceListItem {
  id: number
  name: string
  role: WorkspaceRole
  logo_url: string | null
}

interface WorkspaceListResponse {
  success: boolean
  workspaces: WorkspaceListItem[]
  message?: string
}

export async function fetchMyWorkspaces(): Promise<WorkspaceListItem[]> {
  if (!getAccessToken() && !getRefreshToken()) return []

  const data = await apiRequest<WorkspaceListResponse>('/workspaces')
  return Array.isArray(data.workspaces)
    ? data.workspaces.map((workspace) => ({
      ...workspace,
      logo_url: !isUsableWorkspaceLogoUrl(workspace.logo_url)
        ? null
        : workspace.logo_url.startsWith('http')
        ? workspace.logo_url
        : `${getApiOrigin()}${workspace.logo_url}`,
    }))
    : []
}
