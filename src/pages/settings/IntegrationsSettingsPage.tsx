import { useEffect, useState } from 'react'
import { Check, Unlink } from 'lucide-react'
import { getCurrentWorkspaceId } from '../../api/client'
import {
  getIntegrations,
  getOAuthUrl,
  disconnectIntegration,
  getSlackChannels,
  saveSlackChannel,
  getGoogleCalendars,
  createGoogleCalendar,
  selectGoogleCalendar,
  getJiraProjects,
  saveJiraProject,
  getJiraStatuses,
  resetJiraLinks,
  saveJiraMapping,
  getJiraSites,
  selectJiraSite,
  type IntegrationItem,
  type ServiceName,
  type OAuthService,
  type JiraProject,
  type JiraSite,
  type SlackChannel,
  type GoogleCalendarItem,
} from '../../api/integrations'

const OAUTH_SERVICES: OAuthService[] = ['google_calendar', 'slack', 'jira']

const SERVICE_META: Record<ServiceName, { name: string; description: string; icon: string; buttonLabel: string }> = {
  jira:             { name: 'JIRA',            description: 'WBS 태스크를 JIRA 이슈로 내보내고 진행 상태를 동기화', icon: '🔵', buttonLabel: 'JIRA 연결' },
  slack:            { name: 'Slack',           description: '회의 요약 및 액션 아이템 알림',                       icon: '💬', buttonLabel: 'Slack에 추가' },
  notion:           { name: 'Notion',          description: '회의록 자동 내보내기',                               icon: '📝', buttonLabel: 'Notion 연결' },
  google_calendar:  { name: 'Google Calendar', description: '회의 일정 연동 및 자동 등록',                        icon: '📅', buttonLabel: 'Google 연결' },
  kakao:            { name: '카카오톡 알림',    description: '회의 요약·액션 아이템 알림 발송',                    icon: '💛', buttonLabel: 'API Key 입력' },
}

const WORKB_STATUS_LABELS: Record<string, string> = {
  todo: '할 일',
  in_progress: '진행 중',
  done: '완료',
}

export default function IntegrationsSettingsPage() {
  const [integrations, setIntegrations] = useState<IntegrationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [googleCalendarModalOpen, setGoogleCalendarModalOpen] = useState(false)
  const [googleCalendars, setGoogleCalendars] = useState<GoogleCalendarItem[]>([])
  const [googleLoading, setGoogleLoading] = useState(false)
  const [googleCalendarName, setGoogleCalendarName] = useState('')
  const [slackChannels, setSlackChannels] = useState<SlackChannel[]>([])
  const [channelLoading, setChannelLoading] = useState(false)
  // JIRA 사이트 선택 + 프로젝트 + 상태 매핑 모달
  const [jiraStep, setJiraStep] = useState<'site' | 'project' | 'mapping' | null>(null)
  const [jiraSites, setJiraSites] = useState<JiraSite[]>([])
  const [jiraSiteLoading, setJiraSiteLoading] = useState(false)
  const [jiraProjects, setJiraProjects] = useState<JiraProject[]>([])
  const [jiraProjectLoading, setJiraProjectLoading] = useState(false)
  const [jiraSelectedProject, setJiraSelectedProject] = useState('')
  const [jiraProjectSearch, setJiraProjectSearch] = useState('')
  const [jiraStatuses, setJiraStatuses] = useState<string[]>([])
  const [jiraMapping, setJiraMapping] = useState<Record<string, string>>({})
  const workspaceId = getCurrentWorkspaceId()

  async function refreshList() {
    setError('')
    const response = await getIntegrations(workspaceId)
    setIntegrations(response.integrations)

    const slack = response.integrations.find((integration) => integration.service === 'slack')
    if (slack?.is_connected) {
      setChannelLoading(true)
      getSlackChannels(workspaceId)
        .then((result) => setSlackChannels(result.channels))
        .catch(() => setSlackChannels([]))
        .finally(() => setChannelLoading(false))
    } else {
      setSlackChannels([])
    }
  }

  async function openGoogleCalendarPicker() {
    setGoogleCalendarModalOpen(true)
    setGoogleLoading(true)
    try {
      const res = await getGoogleCalendars(workspaceId)
      setGoogleCalendars(Array.isArray(res.calendars) ? res.calendars : [])
      setError('')
    } catch (err) {
      setGoogleCalendars([])
      setError(err instanceof Error ? err.message : '캘린더 목록을 불러오지 못했습니다.')
    } finally {
      setGoogleLoading(false)
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const status = params.get('status')
    const service = params.get('service') as ServiceName | null

    if (status === 'connected' && service) {
      setSuccessMessage(`${SERVICE_META[service]?.name ?? service} 연동이 완료되었습니다!`)
      window.history.replaceState({}, '', '/settings/integrations')
      setTimeout(() => setSuccessMessage(null), 4000)
      if (service === 'google_calendar') {
        void openGoogleCalendarPicker()
      }
      if (service === 'jira') {
        void openJiraProjectPicker()
      }
    } else if (status === 'select_site' && service === 'jira') {
      // 멀티 사이트 — 사이트 선택 모달 먼저
      window.history.replaceState({}, '', '/settings/integrations')
      void openJiraSitePicker()
    } else if (status === 'error') {
      setError('연동 중 오류가 발생했습니다. 다시 시도해주세요.')
      window.history.replaceState({}, '', '/settings/integrations')
    }

    refreshList()
      .catch((err) => setError(err instanceof Error ? err.message : '연동 상태를 불러오지 못했습니다.'))
      .finally(() => setLoading(false))
  }, [workspaceId])

  async function handleConnect(service: ServiceName) {
    try {
      if (OAUTH_SERVICES.includes(service as OAuthService)) {
        const { auth_url } = await getOAuthUrl(service as OAuthService, workspaceId)
        window.location.href = auth_url
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '연동 요청에 실패했습니다.')
    }
  }

  async function openJiraSitePicker() {
    setJiraStep('site')
    setJiraSiteLoading(true)
    try {
      const res = await getJiraSites(workspaceId)
      setJiraSites(res.sites)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'JIRA 사이트 목록을 불러오지 못했습니다.')
      setJiraStep(null)
    } finally {
      setJiraSiteLoading(false)
    }
  }

  async function handleJiraSiteSelect(cloudId: string, siteUrl: string) {
    try {
      await selectJiraSite(workspaceId, cloudId, siteUrl)
      setJiraStep(null)
      await refreshList()
      // 사이트 선택 완료 → 바로 프로젝트 선택으로 이동
      void openJiraProjectPicker()
    } catch (err) {
      setError(err instanceof Error ? err.message : '사이트 선택에 실패했습니다.')
    }
  }

  async function openJiraProjectPicker() {
    setJiraStep('project')
    setJiraProjectLoading(true)
    setJiraSelectedProject('')
    setJiraProjectSearch('')
    try {
      const res = await getJiraProjects(workspaceId)
      setJiraProjects(res.projects)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'JIRA 프로젝트 목록을 불러오지 못했습니다.')
      setJiraStep(null)
    } finally {
      setJiraProjectLoading(false)
    }
  }

  async function handleJiraProjectSelect(projectKey: string) {
    const currentProjectKey = integrations.find((i) => i.service === 'jira')?.selected_project_key
    if (currentProjectKey && currentProjectKey !== projectKey) {
      if (!confirm(
        `프로젝트를 "${currentProjectKey}"에서 "${projectKey}"로 변경합니다.\n기존 JIRA 연동 ID가 초기화됩니다.\n계속하시겠습니까?`
      )) return
    }
    try {
      await saveJiraProject(workspaceId, projectKey)
      setJiraSelectedProject(projectKey)
      setJiraProjectLoading(true)
      const res = await getJiraStatuses(workspaceId)
      const defaultMapping: Record<string, string> = {}
      res.statuses.forEach((s) => {
        const lower = s.toLowerCase()
        if (lower.includes('done') || lower.includes('완료')) defaultMapping[s] = 'done'
        else if (lower.includes('progress') || lower.includes('진행')) defaultMapping[s] = 'in_progress'
        else defaultMapping[s] = 'todo'
      })
      setJiraStatuses(res.statuses)
      setJiraMapping(defaultMapping)
      setJiraStep('mapping')
    } catch (err) {
      setError(err instanceof Error ? err.message : '프로젝트 선택에 실패했습니다.')
    } finally {
      setJiraProjectLoading(false)
    }
  }

  async function handleJiraMappingSave() {
    try {
      await saveJiraMapping(workspaceId, jiraMapping)
      setJiraStep(null)
      setSuccessMessage('JIRA 프로젝트 및 상태 매핑이 저장되었습니다.')
      setTimeout(() => setSuccessMessage(null), 4000)
      await refreshList()
    } catch (err) {
      setError(err instanceof Error ? err.message : '상태 매핑 저장에 실패했습니다.')
    }
  }

  async function handleJiraResetLinks() {
    if (!confirm(
      'WBS의 모든 JIRA 연동 ID를 초기화합니다.\n' +
      '다른 JIRA 프로젝트로 전환할 때 사용하세요.\n\n' +
      '초기화 후 다시 내보내기를 실행하면 새 JIRA 이슈가 생성됩니다.\n' +
      '계속하시겠습니까?'
    )) return
    try {
      await resetJiraLinks(workspaceId)
      setSuccessMessage('JIRA 연동 ID가 초기화되었습니다.')
      setTimeout(() => setSuccessMessage(null), 4000)
    } catch (err) {
      setError(err instanceof Error ? err.message : '초기화에 실패했습니다.')
    }
  }

  async function handleDisconnect(service: ServiceName) {
    try {
      await disconnectIntegration(workspaceId, service)
      await refreshList()
    } catch (err) {
      setError(err instanceof Error ? err.message : '연동 해제에 실패했습니다.')
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">불러오는 중...</div>
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
      <h1 className="text-xl font-semibold text-foreground mb-1">연동 관리</h1>
      <p className="text-sm text-muted-foreground mb-6">외부 서비스와의 연동 상태를 관리합니다.</p>

      {successMessage && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 text-sm">
          {successMessage}
        </div>
      )}
      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {integrations.map((item) => (
          <IntegrationCard
            key={item.service}
            item={item}
            onConnect={() => handleConnect(item.service)}
            onDisconnect={() => handleDisconnect(item.service)}
            slackChannels={item.service === 'slack' ? slackChannels : undefined}
            slackSelectedChannelId={item.service === 'slack' ? item.selected_channel_id : undefined}
            channelLoading={item.service === 'slack' ? channelLoading : false}
            onChannelChange={(channelId) => saveSlackChannel(workspaceId, channelId).catch(console.error)}
            selectedCalendarId={item.service === 'google_calendar' ? item.selected_calendar_id : undefined}
            selectedCalendarName={item.service === 'google_calendar' ? item.selected_calendar_name : undefined}
            onCalendarChange={openGoogleCalendarPicker}
            onJiraSetup={item.service === 'jira' && item.is_connected ? openJiraProjectPicker : undefined}
            onJiraResetLinks={item.service === 'jira' && item.is_connected ? handleJiraResetLinks : undefined}
          />
        ))}
      </div>

      {/* JIRA 사이트 선택 모달 (멀티 사이트) */}
      {jiraStep === 'site' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-xl border border-border p-6 w-full max-w-md mx-4">
            <h2 className="text-base font-semibold text-foreground mb-1">Atlassian 사이트 선택</h2>
            <p className="text-mini text-muted-foreground mb-4">
              연결할 Atlassian 사이트를 선택하세요. 사이트마다 별도 프로젝트가 있습니다.
            </p>
            {jiraSiteLoading ? (
              <p className="text-sm text-muted-foreground py-4 text-center">불러오는 중...</p>
            ) : jiraSites.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">접근 가능한 사이트가 없습니다.</p>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border mb-4">
                {jiraSites.map((site) => (
                  <button
                    key={site.id}
                    onClick={() => handleJiraSiteSelect(site.id, site.url)}
                    className="w-full px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
                  >
                    <p className="text-sm font-medium text-foreground">{site.name}</p>
                    <p className="text-micro text-muted-foreground">{site.url}</p>
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-end">
              <button
                onClick={() => setJiraStep(null)}
                className="h-8 px-3 rounded-lg border border-border text-sm hover:bg-muted/50 transition-colors"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* JIRA 프로젝트 선택 모달 */}
      {jiraStep === 'project' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-xl border border-border p-6 w-full max-w-md mx-4">
            <h2 className="text-base font-semibold text-foreground mb-1">JIRA 프로젝트 선택</h2>
            <p className="text-mini text-muted-foreground mb-3">WBS와 연동할 JIRA 프로젝트를 선택하세요.</p>
            <input
              value={jiraProjectSearch}
              onChange={(e) => setJiraProjectSearch(e.target.value)}
              placeholder="프로젝트 이름 또는 키 검색"
              className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm mb-3 focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {jiraProjectLoading ? (
              <p className="text-sm text-muted-foreground py-4 text-center">불러오는 중...</p>
            ) : jiraProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">접근 가능한 프로젝트가 없습니다.</p>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border mb-4">
                {jiraProjects
                  .filter((p) => {
                    const q = jiraProjectSearch.toLowerCase()
                    return !q || p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)
                  })
                  .map((p) => (
                    <button
                      key={p.key}
                      onClick={() => handleJiraProjectSelect(p.key)}
                      className="w-full px-3 py-2.5 text-left hover:bg-muted/40 transition-colors flex items-center justify-between"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{p.name}</p>
                        <p className="text-micro text-muted-foreground">{p.key}</p>
                      </div>
                      <Check size={14} className="text-accent opacity-0 group-hover:opacity-100" />
                    </button>
                  ))}
              </div>
            )}
            <div className="flex justify-end">
              <button onClick={() => setJiraStep(null)} className="h-8 px-3 rounded-lg border border-border text-sm hover:bg-muted/50 transition-colors">
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* JIRA 상태 매핑 모달 */}
      {jiraStep === 'mapping' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-xl border border-border p-6 w-full max-w-md mx-4">
            <h2 className="text-base font-semibold text-foreground mb-1">상태 매핑 설정</h2>
            <p className="text-mini text-muted-foreground mb-1">JIRA 상태를 WorkB 상태로 매핑하세요.</p>
            <p className="text-micro text-muted-foreground mb-4">프로젝트: <span className="font-medium text-accent">{jiraSelectedProject}</span></p>
            <div className="flex flex-col gap-2 mb-4 max-h-56 overflow-y-auto">
              {jiraStatuses.map((status) => (
                <div key={status} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-muted/30">
                  <span className="text-sm text-foreground flex-1">{status}</span>
                  <span className="text-mini text-muted-foreground">→</span>
                  <select
                    value={jiraMapping[status] ?? 'todo'}
                    onChange={(e) => setJiraMapping((prev) => ({ ...prev, [status]: e.target.value }))}
                    className="h-7 px-2 rounded border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    {Object.entries(WORKB_STATUS_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 justify-end">
              <button onClick={() => setJiraStep('project')} className="h-8 px-3 rounded-lg border border-border text-sm hover:bg-muted/50 transition-colors">
                이전
              </button>
              <button onClick={handleJiraMappingSave} className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors">
                <Check size={13} /> 저장
              </button>
            </div>
          </div>
        </div>
      )}

      {googleCalendarModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-xl border border-border p-6 w-full max-w-md mx-4">
            <h2 className="text-base font-semibold text-foreground mb-1">Google Calendar 선택</h2>
            <p className="text-mini text-muted-foreground mb-2">워크스페이스에서 사용할 캘린더를 선택하거나 새로 생성하세요.</p>
            <p className="text-mini text-amber-600 dark:text-amber-400 mb-4">⚠️ 한 번 선택한 캘린더는 신중하게 변경해야 합니다. 기존에 등록된 일정은 이전 캘린더에 그대로 남습니다.</p>

            <div className="mb-4">
              <p className="text-mini text-muted-foreground mb-1.5">새 캘린더 생성</p>
              <div className="flex gap-2">
                <input
                  value={googleCalendarName}
                  onChange={(e) => setGoogleCalendarName(e.target.value)}
                  placeholder="예: WorkB - 팀방"
                  className="flex-1 h-9 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <button
                  type="button"
                  disabled={!googleCalendarName.trim() || googleLoading}
                  onClick={async () => {
                    const name = googleCalendarName.trim()
                    if (!name) return
                    setGoogleLoading(true)
                    try {
                      const created = await createGoogleCalendar(workspaceId, name)
                      await selectGoogleCalendar(workspaceId, created.calendar_id, created.summary || name)
                      setSuccessMessage('캘린더가 생성/선택되었습니다.')
                      setTimeout(() => setSuccessMessage(null), 3000)
                      setGoogleCalendarModalOpen(false)
                      setGoogleCalendarName('')
                      await refreshList()
                    } catch (err) {
                      setError(err instanceof Error ? err.message : '캘린더 생성에 실패했습니다.')
                    } finally {
                      setGoogleLoading(false)
                    }
                  }}
                  className="h-9 px-3 rounded-lg bg-accent text-accent-foreground text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/90 transition-colors"
                >
                  생성
                </button>
              </div>
            </div>

            <div className="mb-4">
              <p className="text-mini text-muted-foreground mb-1.5">기존 캘린더 선택</p>
              {googleLoading ? (
                <p className="text-sm text-muted-foreground">불러오는 중...</p>
              ) : googleCalendars.length === 0 ? (
                <p className="text-sm text-muted-foreground">캘린더가 없습니다.</p>
              ) : (
                <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                  {googleCalendars.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={async () => {
                        setGoogleLoading(true)
                        try {
                          await selectGoogleCalendar(workspaceId, c.id, c.summary)
                          setSuccessMessage('캘린더가 선택되었습니다.')
                          setTimeout(() => setSuccessMessage(null), 3000)
                          setGoogleCalendarModalOpen(false)
                          await refreshList()
                        } catch (err) {
                          setError(err instanceof Error ? err.message : '캘린더 선택에 실패했습니다.')
                        } finally {
                          setGoogleLoading(false)
                        }
                      }}
                      className="w-full px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                    >
                      <p className="text-sm text-foreground font-medium">
                        {c.summary || '(제목 없음)'}
                        {c.primary ? ' (primary)' : ''}
                      </p>
                      {c.id && <p className="text-mini text-muted-foreground truncate">{c.id}</p>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setGoogleCalendarModalOpen(false)}
                className="h-8 px-3 rounded-lg border border-border text-sm hover:bg-muted/50 transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function IntegrationCard({
  item,
  onConnect,
  onDisconnect,
  slackChannels,
  slackSelectedChannelId,
  channelLoading,
  onChannelChange,
  selectedCalendarId,
  selectedCalendarName,
  onCalendarChange,
  onJiraSetup,
  onJiraResetLinks,
}: {
  item: IntegrationItem
  onConnect: () => void
  onDisconnect: () => void
  slackChannels?: SlackChannel[]
  slackSelectedChannelId?: string
  channelLoading?: boolean
  onChannelChange?: (channelId: string) => void
  selectedCalendarId?: string
  selectedCalendarName?: string
  onCalendarChange?: () => void
  onJiraSetup?: () => void
  onJiraResetLinks?: () => void
}) {
  const meta = SERVICE_META[item.service]
  const isConnected = item.is_connected

  return (
    <div className="p-4 rounded-xl border border-border bg-card">
      <div className="flex items-start gap-3 mb-3">
        <span className="text-3xl">{meta.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-sm font-semibold text-foreground">{meta.name}</h3>
            <span className={`px-2 py-0.5 rounded-full text-micro font-medium ${isConnected ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}>
              {isConnected ? '연결됨' : '연결 안됨'}
            </span>
          </div>
          <p className="text-mini text-muted-foreground">{meta.description}</p>
        </div>
      </div>

      {item.service === 'slack' && isConnected && (
        <div className="mb-3 pt-3 border-t border-border">
          <p className="text-mini text-muted-foreground mb-1.5">기본 전송 채널</p>
          {channelLoading ? (
            <p className="text-mini text-muted-foreground">채널 불러오는 중...</p>
          ) : (
            <select
              onChange={(event) => onChannelChange?.(event.target.value)}
              defaultValue={slackSelectedChannelId ?? ''}
              className="w-full h-8 px-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="" disabled>채널 선택</option>
              {slackChannels?.map((channel) => (
                <option key={channel.id} value={channel.id}>#{channel.name}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {item.service === 'jira' && isConnected && (
        <div className="mb-3 pt-3 border-t border-border">
          <div className="flex items-center justify-between">
            <p className="text-mini text-muted-foreground">프로젝트 및 상태 매핑</p>
            <div className="flex items-center gap-2">
              <button
                onClick={onJiraSetup}
                className="text-mini text-accent hover:underline transition-colors"
              >
                설정 변경
              </button>
              <span className="text-muted-foreground text-mini">·</span>
              <button
                onClick={onJiraResetLinks}
                className="text-mini text-muted-foreground hover:text-red-500 transition-colors"
              >
                연동 ID 초기화
              </button>
            </div>
          </div>
        </div>
      )}

      {item.service === 'google_calendar' && isConnected && (
        <div className="mb-3 pt-3 border-t border-border">
          <p className="text-mini text-muted-foreground mb-1.5">사용 중인 캘린더</p>
          {selectedCalendarId ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-foreground truncate">{selectedCalendarName || selectedCalendarId}</span>
              <button
                onClick={() => {
                  if (confirm('기존 등록된 일정은 이전 캘린더에 그대로 남습니다.\n정말 변경하시겠습니까?')) {
                    onCalendarChange?.()
                  }
                }}
                className="text-mini text-muted-foreground hover:text-accent transition-colors shrink-0"
              >
                변경 ⚠️
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-mini text-amber-600 dark:text-amber-400">캘린더가 선택되지 않았습니다.</span>
              <button onClick={onCalendarChange} className="text-mini text-accent transition-colors shrink-0">선택</button>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 justify-end">
        {isConnected ? (
          <button
            onClick={onDisconnect}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-red-200 dark:border-red-800 text-red-500 text-sm hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
          >
            <Unlink size={13} /> 연결 해제
          </button>
        ) : (
          <button
            onClick={onConnect}
            className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors"
          >
            <Check size={13} /> {meta.buttonLabel}
          </button>
        )}
      </div>
    </div>
  )
}
