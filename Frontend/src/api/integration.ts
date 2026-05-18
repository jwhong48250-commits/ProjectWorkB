import { apiRequest } from './client'

export interface IntegrationItemResponse {
  service: string
  is_connected: boolean
  created_at: string
}

export async function getWorkspaceIntegrations(
  workspaceId: number,
): Promise<IntegrationItemResponse[]> {
  const response = await apiRequest<{ integrations: IntegrationItemResponse[] }>(
    `/integrations/workspaces/${workspaceId}`,
  )
  return response.integrations
}

export function connectIntegration(
  workspaceId: number,
  service: string,
): Promise<IntegrationItemResponse> {
  return apiRequest<IntegrationItemResponse>(
    `/integrations/workspaces/${workspaceId}/${service}/connect`,
    { method: 'PATCH' },
  )
}

export function disconnectIntegration(
  workspaceId: number,
  service: string,
): Promise<IntegrationItemResponse> {
  return apiRequest<IntegrationItemResponse>(
    `/integrations/workspaces/${workspaceId}/${service}/disconnect`,
    { method: 'PATCH' },
  )
}
