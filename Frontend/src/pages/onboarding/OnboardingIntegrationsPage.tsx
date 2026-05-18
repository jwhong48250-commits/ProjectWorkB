import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'
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
  saveJiraMapping,
  type IntegrationItem,
  type ServiceName,
  type OAuthService,
  type JiraProject,
  type SlackChannel,
  type GoogleCalendarItem,
} from '../../api/integrations'

const OAUTH_SERVICES: OAuthService[] = ['google_calendar', 'slack', 'jira']

const SERVICE_META: Record<ServiceName, { name: string; description: string; icon: string; buttonLabel: string }> = {
  jira:            { name: 'JIRA',            description: 'WBS 태스크를 JIRA 이슈로 내보내고 진행 상태를 동기화', icon: '🔵', buttonLabel: 'JIRA 연결' },
  slack:           { name: 'Slack',           description: '회의 요약 및 액션 아이템 알림',                       icon: '💬', buttonLabel: 'Slack에 추가' },
  notion:          { name: 'Notion',          description: '회의록 자동 내보내기',                               icon: '📝', buttonLabel: 'Notion 연결' },
  google_calendar: { name: 'Google Calendar', description: '회의 일정 연동 및 자동 등록',                        icon: '📅', buttonLabel: 'Google 연결' },
  kakao:           { name: '카카오톡 알림',   description: '회의 요약·액션 아이템 알림 발송',                    icon: '💛', buttonLabel: 'API Key 입력' },
}

const WORKB_STATUS_LABELS: Record<string, string> = {
  todo: '할 일',
  in_progress: '진행 중',
  done: '완료',
}

export default function OnboardingIntegrationsPage() {
  const [integrations, setIntegrations] = useState<IntegrationItem[]>([])
  const [googleCalendarModalOpen, setGoogleCalendarModalOpen] = useState(false)
  const [googleCalendars, setGoogleCalendars] = useState<GoogleCalendarItem[]>([])
  const [googleLoading, setGoogleLoading] = useState(false)
  const [googleCalendarName, setGoogleCalendarName] = useState('')
  const [slackChannels, setSlackChannels] = useState<SlackChannel[]>([])
  const [channelLoading, setChannelLoading] = useState(false)
  const [jiraStep, setJiraStep] = useState<'project' | 'mapping' | null>(null)
  const [jiraProjects, setJiraProjects] = useState<JiraProject[]>([])
  const [jiraProjectLoading, setJiraProjectLoading] = useState(false)
  const [jiraSelectedProject, setJiraSelectedProject] = useState('')
  const [jiraStatuses, setJiraStatuses] = useState<string[]>([])
  const [jiraMapping, setJiraMapping] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const workspaceId = getCurrentWorkspaceId()

  async function refreshList() {
    setError('')
    const response = await getIntegrations(workspaceId)
    setIntegrations(response.integrations)
    const slack = response.integrations.find((i) => i.service === 'slack')
    if (slack?.is_connected) {
      setChannelLoading(true)
      getSlackChannels(workspaceId)
        .then((r) => setSlackChannels(r.channels))
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
    } catch {
      setGoogleCalendars([])
    } finally {
      setGoogleLoading(false)
    }
  }

  async function openJiraProjectPicker() {
    setJiraStep('project')
    setJiraProjectLoading(true)
    setJiraSelectedProject('')
    try {
      const res = await getJiraProjects(workspaceId)
      setJiraProjects(res.projects)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'JIRA 프로젝트를 불러오지 못했습니다.')
      setJiraStep(null)
    } finally {
      setJiraProjectLoading(false)
    }
  }

  async function handleJiraProjectSelect(projectKey: string) {
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
      await refreshList()
    } catch (err) {
      setError(err instanceof Error ? err.message : '상태 매핑 저장에 실패했습니다.')
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const status = params.get('status')
    const service = params.get('service') as ServiceName | null
    if (status) window.history.replaceState({}, '', '/onboarding/integrations')
    if (status === 'connected' && service === 'google_calendar') void openGoogleCalendarPicker()
    if (status === 'connected' && service === 'jira') void openJiraProjectPicker()
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

  async function handleDisconnect(service: ServiceName) {
    try {
      await disconnectIntegration(workspaceId, service)
      await refreshList()
    } catch (err) {
      setError(err instanceof Error ? err.message : '연동 해제에 실패했습니다.')
    }
  }

  return (
    <div className="w-full max-w-md">
      <div className="flex items-center gap-2 mb-8">
        {['워크스페이스', '연동 설정', '멤버 초대'].map((step, index) => (
          <div key={step} className="flex items-center gap-2 flex-1">
            <div className={`flex items-center justify-center w-6 h-6 rounded-full text-mini font-bold ${index === 1 ? 'bg-accent text-accent-foreground' : index < 1 ? 'bg-accent/30 text-accent' : 'bg-muted text-muted-foreground'}`}>
              {index < 1 ? <Check size={12} /> : index + 1}
            </div>
            <span className={`text-mini flex-1 ${index === 1 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{step}</span>
            {index < 2 && <div className="w-4 h-px bg-border" />}
          </div>
        ))}
      </div>

      <h1 className="text-2xl font-bold text-foreground mb-1">외부 서비스 연동</h1>
      <p className="text-sm text-muted-foreground mb-6">나중에도 설정에서 변경할 수 있습니다.</p>
      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      <div className="flex flex-col gap-3 mb-6">
        {loading && <p className="text-sm text-muted-foreground">연동 상태를 불러오는 중입니다...</p>}
        {integrations.map((item) => {
          const meta = SERVICE_META[item.service]
          const isSlack = item.service === 'slack'
          return (
            <div key={item.service} className="p-3 rounded-lg border border-border bg-card">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{meta.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{meta.name}</p>
                  <p className="text-mini text-muted-foreground">{meta.description}</p>
                </div>
                {item.is_connected ? (
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-mini font-medium">
                      <Check size={11} /> 연결됨
                    </span>
                    <button type="button" onClick={() => handleDisconnect(item.service)} className="text-mini text-muted-foreground hover:text-foreground">
                      해제
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleConnect(item.service)}
                    className="px-3 py-1.5 rounded-lg border border-accent text-accent text-mini font-medium hover:bg-accent-subtle transition-colors"
                  >
                    {meta.buttonLabel}
                  </button>
                )}
              </div>

              {isSlack && item.is_connected && (
                <div className="mt-2.5 pt-2.5 border-t border-border">
                  <p className="text-mini text-muted-foreground mb-1">기본 전송 채널</p>
                  {channelLoading ? (
                    <p className="text-mini text-muted-foreground">채널 불러오는 중...</p>
                  ) : (
                    <select
                      onChange={(e) => saveSlackChannel(workspaceId, e.target.value).catch(console.error)}
                      defaultValue={item.selected_channel_id ?? ''}
                      className="w-full h-8 px-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      <option value="" disabled>채널 선택</option>
                      {slackChannels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
                    </select>
                  )}
                </div>
              )}

              {item.service === 'jira' && item.is_connected && (
                <div className="mt-2.5 pt-2.5 border-t border-border flex items-center justify-between">
                  <p className="text-mini text-muted-foreground">프로젝트 및 상태 매핑</p>
                  <button onClick={openJiraProjectPicker} className="text-mini text-accent hover:underline">설정 변경</button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <button onClick={() => navigate('/onboarding/invite')} className="w-full h-10 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors">
        다음 → 멤버 초대
      </button>
      <button onClick={() => navigate('/onboarding/invite')} className="w-full h-9 text-sm text-muted-foreground hover:text-foreground transition-colors mt-1">
        건너뛰기
      </button>

      {/* JIRA 프로젝트 선택 */}
      {jiraStep === 'project' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-xl border border-border p-6 w-full max-w-sm mx-4">
            <h2 className="text-base font-semibold text-foreground mb-1">JIRA 프로젝트 선택</h2>
            <p className="text-mini text-muted-foreground mb-4">WBS와 연동할 JIRA 프로젝트를 선택하세요.</p>
            {jiraProjectLoading ? (
              <p className="text-sm text-muted-foreground py-4 text-center">불러오는 중...</p>
            ) : jiraProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">접근 가능한 프로젝트가 없습니다.</p>
            ) : (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border mb-4">
                {jiraProjects.map((p) => (
                  <button key={p.key} onClick={() => handleJiraProjectSelect(p.key)} className="w-full px-3 py-2.5 text-left hover:bg-muted/40 transition-colors">
                    <p className="text-sm font-medium text-foreground">{p.name}</p>
                    <p className="text-micro text-muted-foreground">{p.key}</p>
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-end">
              <button onClick={() => setJiraStep(null)} className="h-8 px-3 rounded-lg border border-border text-sm hover:bg-muted/50 transition-colors">취소</button>
            </div>
          </div>
        </div>
      )}

      {/* JIRA 상태 매핑 */}
      {jiraStep === 'mapping' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-xl border border-border p-6 w-full max-w-sm mx-4">
            <h2 className="text-base font-semibold text-foreground mb-1">상태 매핑 설정</h2>
            <p className="text-micro text-muted-foreground mb-4">프로젝트: <span className="font-medium text-accent">{jiraSelectedProject}</span></p>
            <div className="flex flex-col gap-2 mb-4 max-h-48 overflow-y-auto">
              {jiraStatuses.map((s) => (
                <div key={s} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-muted/30">
                  <span className="text-sm text-foreground flex-1">{s}</span>
                  <span className="text-mini text-muted-foreground">→</span>
                  <select
                    value={jiraMapping[s] ?? 'todo'}
                    onChange={(e) => setJiraMapping((prev) => ({ ...prev, [s]: e.target.value }))}
                    className="h-7 px-2 rounded border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    {Object.entries(WORKB_STATUS_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setJiraStep('project')} className="h-8 px-3 rounded-lg border border-border text-sm hover:bg-muted/50 transition-colors">이전</button>
              <button onClick={handleJiraMappingSave} className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors">
                <Check size={13} /> 저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Google Calendar */}
      {googleCalendarModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-xl border border-border p-6 w-full max-w-sm mx-4">
            <h2 className="text-base font-semibold text-foreground mb-1">Google Calendar 선택</h2>
            <p className="text-mini text-muted-foreground mb-4">워크스페이스에서 사용할 캘린더를 선택하거나 새로 생성하세요.</p>
            <div className="mb-4">
              <p className="text-mini text-muted-foreground mb-1.5">새 캘린더 생성</p>
              <div className="flex gap-2">
                <input value={googleCalendarName} onChange={(e) => setGoogleCalendarName(e.target.value)} placeholder="예: WorkB - 팀방" className="flex-1 h-9 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-accent" />
                <button
                  type="button"
                  disabled={!googleCalendarName.trim() || googleLoading}
                  onClick={async () => {
                    const name = googleCalendarName.trim()
                    if (!name) return
                    setGoogleLoading(true)
                    try {
                      const created = await createGoogleCalendar(workspaceId, name)
                      await selectGoogleCalendar(workspaceId, created.calendar_id)
                      setGoogleCalendarModalOpen(false)
                      setGoogleCalendarName('')
                      await refreshList()
                    } catch (err) {
                      setError(err instanceof Error ? err.message : '캘린더 생성에 실패했습니다.')
                    } finally {
                      setGoogleLoading(false)
                    }
                  }}
                  className="h-9 px-3 rounded-lg bg-accent text-accent-foreground text-sm font-medium disabled:opacity-40 hover:bg-accent/90 transition-colors"
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
                <div className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                  {googleCalendars.map((c) => (
                    <button key={c.id} type="button"
                      onClick={async () => {
                        setGoogleLoading(true)
                        try {
                          await selectGoogleCalendar(workspaceId, c.id)
                          setGoogleCalendarModalOpen(false)
                          await refreshList()
                        } catch (err) {
                          setError(err instanceof Error ? err.message : '캘린더 선택에 실패했습니다.')
                        } finally { setGoogleLoading(false) }
                      }}
                      className="w-full px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                    >
                      <p className="text-sm font-medium text-foreground">{c.summary || '(제목 없음)'}{c.primary ? ' (primary)' : ''}</p>
                      {c.id && <p className="text-mini text-muted-foreground truncate">{c.id}</p>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={() => setGoogleCalendarModalOpen(false)} className="h-8 px-3 rounded-lg border border-border text-sm hover:bg-muted/50 transition-colors">닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
