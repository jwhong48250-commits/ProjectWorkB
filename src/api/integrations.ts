// src/api/integrations.ts
import { apiFetch } from './client'

export type ServiceName = 'jira' | 'slack' | 'notion' | 'google_calendar' | 'kakao'
export type OAuthService = 'google_calendar' | 'slack' | 'jira'

export interface IntegrationItem {
  id: number
  service: ServiceName
  is_connected: boolean
  updated_at: string
  selected_channel_id?: string
  selected_calendar_id?: string
  selected_calendar_name?: string
  selected_project_key?: string
}

export interface IntegrationListResponse {
  integrations: IntegrationItem[]
}

export interface JiraProject {
  key: string
  name: string
}

// --- 목록 조회 ---
export function getIntegrations(workspaceId: number) {
  return apiFetch<IntegrationListResponse>(`/integrations/workspaces/${workspaceId}`)
}

// --- OAuth 방식 (Google / Slack / JIRA) ---
const OAUTH_PATHS: Record<OAuthService, string> = {
  google_calendar: 'google',
  slack: 'slack',
  jira: 'jira',
}

export function getOAuthUrl(service: OAuthService, workspaceId: number) {
  return apiFetch<{ auth_url: string }>(
    `/integrations/${OAUTH_PATHS[service]}/auth?workspace_id=${workspaceId}`
  )
}

// --- JIRA 사이트 선택 (멀티 사이트) ---
export interface JiraSite {
  id: string
  name: string
  url: string
}

export function getJiraSites(workspaceId: number) {
  return apiFetch<{ sites: JiraSite[] }>(
    `/integrations/workspaces/${workspaceId}/jira/sites`
  )
}

export function selectJiraSite(workspaceId: number, cloudId: string, siteUrl: string) {
  return apiFetch<{ status: string }>(
    `/integrations/workspaces/${workspaceId}/jira/site/select`,
    { method: 'POST', body: JSON.stringify({ cloud_id: cloudId, site_url: siteUrl }) }
  )
}

// --- JIRA OAuth 후속 설정 ---
export function getJiraProjects(workspaceId: number) {
  return apiFetch<{ projects: JiraProject[] }>(
    `/integrations/workspaces/${workspaceId}/jira/projects`
  )
}

export function saveJiraProject(workspaceId: number, projectKey: string) {
  return apiFetch<{ status: string }>(
    `/integrations/workspaces/${workspaceId}/jira/project/select`,
    { method: 'POST', body: JSON.stringify({ project_key: projectKey }) }
  )
}

export function getJiraStatuses(workspaceId: number) {
  return apiFetch<{ statuses: string[] }>(
    `/integrations/workspaces/${workspaceId}/jira/statuses`
  )
}

export function saveJiraMapping(workspaceId: number, statusMapping: Record<string, string>) {
  return apiFetch<{ status: string }>(
    `/integrations/workspaces/${workspaceId}/jira/mapping`,
    { method: 'POST', body: JSON.stringify({ status_mapping: statusMapping }) }
  )
}

export function resetJiraLinks(workspaceId: number) {
  return apiFetch<{ status: string }>(
    `/integrations/workspaces/${workspaceId}/jira/reset-links`,
    { method: 'POST' },
  )
}

// --- 공통 ---
export function disconnectIntegration(workspaceId: number, service: ServiceName) {
  return apiFetch<IntegrationItem>(
    `/integrations/workspaces/${workspaceId}/${service}/disconnect`,
    { method: 'POST' }
  )
}

export function testIntegration(workspaceId: number, service: ServiceName) {
  return apiFetch<{ success: boolean; message: string }>(
    `/integrations/workspaces/${workspaceId}/${service}/test`,
    { method: 'POST' }
  )
}

// --- Slack 채널 ---
export interface SlackChannel {
  id: string
  name: string
}

export function getSlackChannels(workspaceId: number) {
  return apiFetch<{ channels: SlackChannel[] }>(
    `/integrations/workspaces/${workspaceId}/slack/channels`
  )
}

export function saveSlackChannel(workspaceId: number, channelId: string) {
  return apiFetch<{ status: string }>(
    `/integrations/slack/channel?workspace_id=${workspaceId}`,
    { method: 'PATCH', body: JSON.stringify({ channel_id: channelId }) }
  )
}

// --- Google Calendar events ---
export interface GoogleCalendarEvent {
  id: string
  title: string
  start: string
  end: string
  description?: string | null
  html_link?: string | null
}

export interface GoogleCalendarItem {
  id: string
  summary: string
  primary?: boolean
  access_role?: string | null
}

export function getGoogleCalendarEvents(
  workspaceId: number,
  timeMin?: string,
  maxResults = 50,
) {
  const params = new URLSearchParams({ workspace_id: String(workspaceId), max_results: String(maxResults) })
  if (timeMin) params.append('time_min', timeMin)
  return apiFetch<{ events: GoogleCalendarEvent[] }>(`/integrations/google/events?${params}`)
}

// --- Google Calendar calendars (list/create/select) ---
export function getGoogleCalendars(workspaceId: number) {
  const params = new URLSearchParams({ workspace_id: String(workspaceId) })
  return apiFetch<{ calendars: GoogleCalendarItem[] }>(`/integrations/google/calendars?${params}`)
}

export function createGoogleCalendar(workspaceId: number, name: string) {
  const params = new URLSearchParams({ workspace_id: String(workspaceId) })
  return apiFetch<{ calendar_id: string; summary: string }>(`/integrations/google/calendars?${params}`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function selectGoogleCalendar(workspaceId: number, calendarId: string, calendarName?: string) {
  const params = new URLSearchParams({ workspace_id: String(workspaceId) })
  return apiFetch<IntegrationItem>(`/integrations/google/calendars/select?${params}`, {
    method: 'POST',
    body: JSON.stringify({ calendar_id: calendarId, calendar_name: calendarName }),
  })
}
