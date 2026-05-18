import { apiRequest } from './client'

export interface WorkspaceMemberApiItem {
  user_id: number
  name: string
  email?: string
  department?: string | null
  department_id?: number | null
  role: string
}

/** GET /workspaces/{id}/members — 백엔드 WorkspaceMemberListResponse */
interface WorkspaceMembersResponse {
  members: WorkspaceMemberApiItem[]
}

export async function fetchWorkspaceMembers(workspaceId: number): Promise<WorkspaceMemberApiItem[]> {
  const data = await apiRequest<WorkspaceMembersResponse>(`/workspaces/${workspaceId}/members`)
  return Array.isArray(data.members) ? data.members : []
}
