export type ServiceName = 'jira' | 'slack' | 'notion' | 'google_calendar' | 'kakao'
export type IntegrationStatus = 'connected' | 'disconnected' | 'error'

export interface Integration {
  id: number
  service: ServiceName
  is_connected: boolean
  updated_at: string
  // UI 전용
  name: string
  description: string
  icon: string
}
