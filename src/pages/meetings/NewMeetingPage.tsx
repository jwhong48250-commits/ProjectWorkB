import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Users, Tag, Search, X, UsersRound } from 'lucide-react'
import type { Meeting, Participant } from '../../types/meeting'
import DatePicker from '../../components/ui/DatePicker'
import TimePicker from '../../components/ui/TimePicker'
import { getCurrentWorkspaceId, WORKSPACE_CHANGED_EVENT } from '../../utils/workspace'
import { apiRequest } from '../../api/client'
import { getDepartments, getWorkspaceMembers, type Department as WorkspaceDepartment } from '../../api/workspace'
import { getIntegrations, type IntegrationItem } from '../../api/integrations'

const MEETING_TYPES = ['일반 회의', '스프린트 플래닝', '스탠드업', '회고', '브레인스토밍', '투자자 미팅']

function localDateTimeParts(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}` }
}

export default function NewMeetingPage() {
  const [title, setTitle] = useState('')
  const [roomName, setRoomName] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [duration, setDuration] = useState('60')
  const [meetingType, setMeetingType] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [selectedParticipants, setSelectedParticipants] = useState<Participant[]>([])
  const [allParticipants, setAllParticipants] = useState<Participant[]>([])
  const [departments, setDepartments] = useState<WorkspaceDepartment[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const processedDraftKeyRef = useRef<string | null>(null)
  const editMeetingIdRef = useRef<string | null>(null)
  const syncTouchedRef = useRef(false)
  const [workspaceId, setWorkspaceId] = useState(() => getCurrentWorkspaceId())
  const [googleConnected, setGoogleConnected] = useState(false)
  const [syncGoogleCalendar, setSyncGoogleCalendar] = useState(false)
  const [editHasGoogleEvent, setEditHasGoogleEvent] = useState<boolean | null>(null)

  function todayYmd() {
    const d = new Date()
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }

  function isPastScheduled(nextDate: string, nextTime: string) {
    if (!nextDate || !nextTime) return false
    const dt = new Date(`${nextDate}T${nextTime}:00`)
    return dt.getTime() < Date.now()
  }

  const trimmed = searchQuery.trim().toLowerCase()

  useEffect(() => {
    let mounted = true
    Promise.all([getWorkspaceMembers(workspaceId), getDepartments(workspaceId)])
      .then(([memberRows, departmentRows]) => {
        if (!mounted) return
        setDepartments(Array.isArray(departmentRows) ? departmentRows : [])

        const palette = ['#6b78f6', '#22c55e', '#f97316', '#ec4899', '#eab308', '#14b8a6', '#8b5cf6', '#64748b']
        const ui: Participant[] = (Array.isArray(memberRows) ? memberRows : []).map((r) => {
          const initials = r.name.length >= 2 ? r.name.slice(0, 2) : r.name.length === 1 ? r.name : '?'
          return {
            id: `u${r.user_id}`,
            userId: r.user_id,
            name: r.name,
            avatarInitials: initials,
            color: palette[Math.abs(r.user_id) % palette.length],
            // 부서는 "멤버·권한 관리"에서 지정된 department만 내려옴 (없으면 null)
            department: r.department ?? undefined,
          }
        })
        setAllParticipants(ui)
      })
      .catch(() => {
        if (!mounted) return
        setDepartments([])
        setAllParticipants([])
      })
    return () => {
      mounted = false
    }
  }, [workspaceId])

  useEffect(() => {
    let mounted = true
    getIntegrations(workspaceId)
      .then((res) => {
        if (!mounted) return
        const items: IntegrationItem[] = Array.isArray(res.integrations) ? res.integrations : []
        const google = items.find((x) => x.service === 'google_calendar')
        const connected = Boolean(google?.is_connected)
        setGoogleConnected(connected)
        // 기본값: 연동돼 있으면 자동 등록 ON
        if (!connected) {
          setSyncGoogleCalendar(false)
        } else if (!editMeetingIdRef.current && !syncTouchedRef.current) {
          setSyncGoogleCalendar(true)
        }
      })
      .catch(() => {
        if (!mounted) return
        setGoogleConnected(false)
        setSyncGoogleCalendar(false)
      })
    return () => {
      mounted = false
    }
  }, [workspaceId])

  useEffect(() => {
    function onWsChanged(e: Event) {
      const id = (e as CustomEvent<{ id: number }>).detail?.id
      if (typeof id === 'number' && Number.isFinite(id)) {
        setWorkspaceId(id)
        setSelectedParticipants([])
      }
    }
    window.addEventListener(WORKSPACE_CHANGED_EVENT, onWsChanged)
    return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, onWsChanged)
  }, [])

  // 매칭된 개별 직원 (이름 또는 부서명으로 검색)
  // 부서 목록은 "부서 관리"에 등록된 것 기준으로 노출해야 함.
  // 멤버에게 부서가 1명도 지정되지 않았더라도, 등록된 부서는 드롭다운에 보여줘야 한다.
  const hasDepartments = departments.length > 0

  const filteredCandidates = allParticipants.filter(
    (p) =>
      !selectedParticipants.some((s) => s.id === p.id) &&
      (trimmed === '' ||
        p.name.toLowerCase().includes(trimmed) ||
        (hasDepartments && (p.department?.toLowerCase().includes(trimmed) ?? false)))
  )

  // 부서 선택 UX: "부서 관리"에서 생성된 부서만 노출
  const matchedDepartments = hasDepartments
    ? departments.filter((d) => trimmed === '' || d.name.toLowerCase().includes(trimmed))
    : []

  // 드롭다운 아이템 총 수 (부서 그룹 + 개별 직원)
  const totalItems = matchedDepartments.length + filteredCandidates.length

  useEffect(() => {
    setHighlightedIndex(0)
  }, [searchQuery])

  /** 예정 상세 등에서 `state.draftMeeting`으로 넘어온 값으로 폼 채움 */
  useEffect(() => {
    const draft = (location.state as { draftMeeting?: Meeting } | null)?.draftMeeting
    if (!draft) {
      processedDraftKeyRef.current = null
      editMeetingIdRef.current = null
      syncTouchedRef.current = false
      setEditHasGoogleEvent(null)
      return
    }
    const dedupeKey = `${location.key}|${draft.id}|${draft.startAt}`
    if (processedDraftKeyRef.current === dedupeKey) return
    processedDraftKeyRef.current = dedupeKey

    setTitle(draft.title)
    setMeetingType(draft.meetingType ?? '')
    setRoomName(draft.roomName ?? '')
    editMeetingIdRef.current = draft.id
    const { date: dStr, time: tStr } = localDateTimeParts(draft.startAt)
    setDate(dStr)
    setTime(tStr)
    setSelectedParticipants(
      draft.participants?.length ? draft.participants.map((p) => ({ ...p })) : [],
    )
    syncTouchedRef.current = false
    setEditHasGoogleEvent(Boolean(draft.googleCalendarEventId))
  }, [location.key, location.state])

  // 수정 화면: draft 로딩 + googleConnected 로딩이 끝난 뒤에도 기본 체크 상태를 동기화
  useEffect(() => {
    if (!editMeetingIdRef.current) return
    if (editHasGoogleEvent === null) return
    if (syncTouchedRef.current) return
    setSyncGoogleCalendar(Boolean(editHasGoogleEvent) || googleConnected)
  }, [googleConnected, editHasGoogleEvent])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        searchRef.current &&
        !searchRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function addParticipant(p: Participant) {
    if (selectedParticipants.some((s) => s.id === p.id)) return
    setSelectedParticipants((prev) => [...prev, p])
  }

  function addDepartment(deptName: string) {
    const members = allParticipants.filter((p) => p.department === deptName)
    setSelectedParticipants((prev) => {
      const existingIds = new Set(prev.map((p) => p.id))
      const toAdd = members.filter((p) => !existingIds.has(p.id))
      return [...prev, ...toAdd]
    })
    setSearchQuery('')
    setDropdownOpen(false)
    searchRef.current?.focus()
  }

  function removeParticipant(id: string) {
    setSelectedParticipants((prev) => prev.filter((p) => p.id !== id))
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!dropdownOpen || totalItems === 0) {
      if (e.key === 'ArrowDown' && totalItems > 0) setDropdownOpen(true)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex((i) => Math.min(i + 1, totalItems - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightedIndex < matchedDepartments.length) {
        addDepartment(matchedDepartments[highlightedIndex].name)
      } else {
        const candidate = filteredCandidates[highlightedIndex - matchedDepartments.length]
        if (candidate) {
          addParticipant(candidate)
          setSearchQuery('')
          setDropdownOpen(false)
          searchRef.current?.focus()
        }
      }
    } else if (e.key === 'Escape') {
      setDropdownOpen(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (!date || !time) {
      alert('날짜와 시간을 선택해 주세요.')
      return
    }
    if (isPastScheduled(date, time)) {
      alert('현재보다 이전 시간으로 회의를 예약할 수 없습니다.')
      return
    }

    // 참석자 저장은 반드시 DB의 users.id (= userId)만 사용
    const participant_ids = selectedParticipants
      .map((p) => p.userId)
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))

    if (selectedParticipants.length > 0 && participant_ids.length === 0) {
      alert('선택된 직원에 userId가 없어 참석자를 저장할 수 없습니다.')
      return
    }

    const body = {
      title,
      meeting_type: meetingType || '일반 회의',
      room_name: roomName.trim() || '미지정',
      scheduled_at: new Date(`${date}T${time}:00`).toISOString(),
      participant_ids,
      sync_google_calendar: syncGoogleCalendar,
      duration_minutes: Number(duration) || 60,
    }

    const workspaceId = getCurrentWorkspaceId()
    const editId = editMeetingIdRef.current

    try {
      setSubmitting(true)
      await apiRequest(
        editId
          ? `/meetings/workspaces/${workspaceId}/${editId}`
          : `/meetings/workspaces/${workspaceId}`,
        {
          method: editId ? 'PATCH' : 'POST',
          body: JSON.stringify(body),
        },
      )
    } catch (err) {
      setSubmitting(false)
      alert(`${editId ? '회의 수정' : '회의 생성'} 실패\n${err instanceof Error ? err.message : String(err)}`)
      return
    }

    // success -> go home
    navigate('/')
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">회의 생성 · 예약</h1>
        <p className="text-sm text-muted-foreground mt-0.5">새 회의를 예약하세요.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <fieldset disabled={submitting} className="space-y-5">
        {/* 회의 제목 */}
        <div>
          <label className="flex items-center gap-1.5 text-sm font-medium text-foreground mb-1.5">
            <Tag size={14} aria-hidden="true" /> 회의 제목 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: Q2 제품 로드맵 리뷰"
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
            required
          />
        </div>

        {/* 회의룸 */}
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">회의룸 (회의실)</label>
          <input
            type="text"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder="예: 회의실 A / Zoom / Google Meet"
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
          />
          <p className="text-mini text-muted-foreground mt-1">
            비워두면 <span className="font-medium">미지정</span>으로 저장됩니다.
          </p>
        </div>

        {/* 날짜 & 시간 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-foreground mb-1.5">
              날짜
            </label>
            <DatePicker
              value={date}
              onChange={(next) => {
                if (next < todayYmd()) {
                  alert('현재보다 이전 날짜로 회의를 예약할 수 없습니다.')
                  return
                }
                setDate(next)
                // If selecting today and time already set to a past time, reset time.
                if (time && isPastScheduled(next, time)) setTime('')
              }}
              placeholder="날짜 선택"
            />
          </div>
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-foreground mb-1.5">
              시간
            </label>
            <TimePicker
              value={time}
              onChange={(next) => {
                if (date && isPastScheduled(date, next)) {
                  alert('현재보다 이전 시간으로 회의를 예약할 수 없습니다.')
                  return
                }
                setTime(next)
              }}
              placeholder="시간 선택"
            />
          </div>
        </div>

        {/* 예상 소요 시간 */}
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">예상 소요 시간</label>
          <div className="flex gap-2 flex-wrap">
            {['30', '60', '90', '120'].map((min) => (
              <button
                key={min}
                type="button"
                onClick={() => setDuration(min)}
                className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                  duration === min
                    ? 'border-accent bg-accent-subtle text-accent'
                    : 'border-border text-muted-foreground hover:border-foreground'
                }`}
              >
                {min}분
              </button>
            ))}
          </div>
        </div>

        {/* 회의 유형 */}
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">회의 유형</label>
          <select
            value={meetingType}
            onChange={(e) => setMeetingType(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
          >
            <option value="">유형 선택 (선택사항)</option>
            {MEETING_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {/* 직원 검색 */}
        <div>
          <label className="flex items-center gap-1.5 text-sm font-medium text-foreground mb-1.5">
            <Users size={14} aria-hidden="true" /> 직원 검색
          </label>

          {/* 선택된 직원 Chip 목록 */}
          {selectedParticipants.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {selectedParticipants.map((p) => (
                <span
                  key={p.id}
                  className="flex items-center gap-1.5 pl-1.5 pr-1 py-0.5 rounded-full border border-accent bg-accent-subtle text-accent text-sm"
                >
                  <span
                    className="w-4 h-4 rounded-full flex items-center justify-center text-white text-micro shrink-0"
                    style={{ backgroundColor: p.color }}
                    aria-hidden="true"
                  >
                    {p.avatarInitials[0]}
                  </span>
                  {p.name}
                  {p.department && (
                    <span className="text-micro text-accent/60">({p.department})</span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeParticipant(p.id)}
                    className="ml-0.5 hover:text-accent/60 transition-colors"
                    aria-label={`${p.name} 제거`}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* 검색 입력 + 드롭다운 */}
          <div className="relative">
            <div className="flex items-center gap-2 h-10 px-3 rounded-lg border border-border bg-card focus-within:ring-2 focus-within:ring-accent/30 focus-within:border-accent">
              <Search size={14} className="text-muted-foreground shrink-0" aria-hidden="true" />
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setDropdownOpen(true)
                }}
                onFocus={() => setDropdownOpen(true)}
                onKeyDown={handleSearchKeyDown}
                placeholder={hasDepartments ? '이름 또는 부서명으로 검색...' : '이름으로 검색...'}
                className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                aria-label="직원 검색"
                aria-expanded={dropdownOpen}
                aria-haspopup="listbox"
                role="combobox"
                aria-autocomplete="list"
              />
            </div>

            {dropdownOpen && totalItems > 0 && (
              <div
                ref={dropdownRef}
                role="listbox"
                aria-label="직원 및 부서 목록"
                className="absolute z-20 top-full left-0 right-0 mt-1 rounded-lg border border-border bg-card shadow-lg overflow-hidden max-h-64 overflow-y-auto"
              >
                {/* 부서 그룹 섹션 */}
                {hasDepartments && matchedDepartments.length > 0 && (
                  <>
                    <div className="px-3 py-1.5 text-micro font-medium text-muted-foreground uppercase tracking-wide bg-muted/40 border-b border-border">
                      부서 전체 추가
                    </div>
                    {matchedDepartments.map((dept, idx) => {
                      const membersInDept = allParticipants.filter((p) => p.department === dept.name)
                      const alreadyAdded = membersInDept.filter((p) =>
                        selectedParticipants.some((s) => s.id === p.id)
                      ).length
                      const newCount = membersInDept.length - alreadyAdded
                      const isHighlighted = idx === highlightedIndex
                      const isEmptyDept = membersInDept.length === 0
                      return (
                        <button
                          key={dept.department_id}
                          type="button"
                          role="option"
                          aria-selected={isHighlighted}
                          aria-disabled={isEmptyDept}
                          onMouseEnter={() => setHighlightedIndex(idx)}
                          onClick={() => {
                            if (isEmptyDept) return
                            addDepartment(dept.name)
                          }}
                          className={`flex items-center justify-between w-full px-3 py-2 text-sm transition-colors ${
                            isEmptyDept
                              ? 'opacity-50 cursor-not-allowed text-muted-foreground'
                              : isHighlighted
                                ? 'bg-accent-subtle text-accent'
                                : 'text-foreground hover:bg-muted/50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <UsersRound size={14} className="shrink-0" aria-hidden="true" />
                            <span>{dept.name}</span>
                          </div>
                          <span className="text-mini text-muted-foreground">
                            {isEmptyDept ? '직원 없음' : newCount > 0 ? `+${newCount}명 추가` : '모두 추가됨'}
                          </span>
                        </button>
                      )
                    })}
                  </>
                )}

                {/* 개별 직원 섹션 */}
                {filteredCandidates.length > 0 && (
                  <>
                    {hasDepartments && matchedDepartments.length > 0 && (
                      <div className="px-3 py-1.5 text-micro font-medium text-muted-foreground uppercase tracking-wide bg-muted/40 border-b border-border">
                        직원
                      </div>
                    )}
                    {filteredCandidates.map((p, idx) => {
                      const itemIdx = matchedDepartments.length + idx
                      const isHighlighted = itemIdx === highlightedIndex
                      return (
                        <button
                          key={p.id}
                          type="button"
                          role="option"
                          aria-selected={isHighlighted}
                          onMouseEnter={() => setHighlightedIndex(itemIdx)}
                          onClick={() => {
                            addParticipant(p)
                            setSearchQuery('')
                            setDropdownOpen(false)
                            searchRef.current?.focus()
                          }}
                          className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm transition-colors text-left ${
                            isHighlighted
                              ? 'bg-accent-subtle text-accent'
                              : 'text-foreground hover:bg-muted/50'
                          }`}
                        >
                          <span
                            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-micro shrink-0"
                            style={{ backgroundColor: p.color }}
                            aria-hidden="true"
                          >
                            {p.avatarInitials[0]}
                          </span>
                          <span className="flex-1">{p.name}</span>
                          {p.department && (
                            <span className="text-mini text-muted-foreground">{p.department}</span>
                          )}
                        </button>
                      )
                    })}
                  </>
                )}
              </div>
            )}

            {dropdownOpen && trimmed !== '' && totalItems === 0 && (
              <div className="absolute z-20 top-full left-0 right-0 mt-1 rounded-lg border border-border bg-card shadow-lg px-3 py-2.5 text-sm text-muted-foreground">
                검색 결과가 없습니다.
              </div>
            )}
          </div>

          {selectedParticipants.length === 0 && (
            <p className="text-mini text-muted-foreground mt-1.5">
              {hasDepartments
                ? '이름 또는 부서명으로 검색해 추가하세요. 부서 선택 시 소속 직원이 일괄 추가됩니다.'
                : '이름으로 검색해 직원을 추가하세요.'}
            </p>
          )}
        </div>

        {/* Google Calendar 연동 */}
        <div className="p-3 rounded-lg border border-border bg-muted/20 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">📅 Google Calendar 연동</p>
              <p className="text-mini text-muted-foreground mt-0.5">회의 일정을 캘린더에 자동 등록합니다.</p>
            </div>
            <span
              className={`px-2 py-0.5 rounded-full text-micro font-medium ${
                googleConnected
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {googleConnected ? '연동됨' : '연동 안됨'}
            </span>
          </div>

          <label className="flex items-center justify-between gap-3">
            <span className="text-sm text-foreground">이 회의를 Google Calendar에 등록</span>
            <input
              type="checkbox"
              checked={syncGoogleCalendar}
              onChange={(e) => {
                syncTouchedRef.current = true
                setSyncGoogleCalendar(e.target.checked)
              }}
              disabled={!googleConnected}
              aria-label="Google Calendar 자동 등록"
            />
          </label>

          {!googleConnected && (
            <p className="text-mini text-muted-foreground">
              먼저 <span className="font-medium">설정 → 연동 관리</span>에서 Google Calendar를 연결해 주세요.
            </p>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex-1 h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted/50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            취소
          </button>
          <button
            type="submit"
            className="flex-1 h-10 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <span className="inline-flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-accent-foreground/30 border-t-accent-foreground rounded-full animate-spin" />
                회의 생성중...
              </span>
            ) : (
              '회의 생성'
            )}
          </button>
        </div>
        </fieldset>
      </form>
    </div>
  )
}
