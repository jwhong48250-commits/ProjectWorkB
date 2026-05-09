import { useEffect, useState } from 'react'
import { UserPlus, Copy, Check, Shield } from 'lucide-react'
import { getCurrentWorkspaceId } from '../../api/client'
import {
  getDepartments,
  getWorkspace,
  getWorkspaceMembers,
  issueInviteCode,
  updateMemberDepartment,
  updateMemberProfile,
  updateMemberRole,
  type Department,
  type UserRole,
  type WorkspaceMember,
} from '../../api/workspace'
import { useProfileImage } from '../../utils/profileImage'
import BirthDateSelect from '../../components/auth/BirthDateSelect'
import { createAvatarColorMap, pickAvatarColor } from '../../utils/avatarColor'

type Role = '관리자' | '멤버' | '뷰어'
type Gender = 'male' | 'female'

const ROLE_STYLES: Record<Role, string> = {
  관리자: 'bg-accent-subtle text-accent',
  멤버: 'bg-muted text-muted-foreground',
  뷰어: 'bg-muted text-muted-foreground',
}

const ROLE_TO_BACKEND: Record<Role, UserRole> = {
  관리자: 'admin',
  멤버: 'member',
  뷰어: 'viewer',
}

const BACKEND_TO_ROLE: Record<UserRole, Role> = {
  admin: '관리자',
  member: '멤버',
  viewer: '뷰어',
}

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'female', label: '여성' },
  { value: 'male', label: '남성' },
]
const DESKTOP_MEMBER_GRID = 'md:grid-cols-[minmax(14rem,1fr)_6rem_8.5rem_13rem_4rem_6rem_6rem] md:min-w-[61rem]'

function getInitial(name: string): string {
  return name.trim().charAt(0) || '?'
}

function formatAge(age: number | null): string {
  return age === null ? '-' : `${age}세`
}

function genderLabel(gender: WorkspaceMember['gender']): string {
  return GENDER_OPTIONS.find((option) => option.value === gender)?.label ?? '성별 미입력'
}

function getSettingsErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof TypeError && err.message === 'Failed to fetch') {
    return '서버 연결에 실패했습니다. 백엔드 서버 실행 상태를 확인해 주세요.'
  }

  return err instanceof Error ? err.message : fallback
}

function MemberAvatar({
  member,
  avatarColorMap,
  className,
}: {
  member: WorkspaceMember
  avatarColorMap: Map<number, string>
  className?: string
}) {
  const profileImage = useProfileImage(member.user_id)

  if (profileImage) {
    return (
      <img
        src={profileImage}
        alt={member.name}
        className={`w-8 h-8 rounded-full object-cover shrink-0 ${className ?? ''}`}
      />
    )
  }

  return (
    <div
      className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0 ${className ?? ''}`}
      style={{ backgroundColor: pickAvatarColor(member.user_id, avatarColorMap) }}
    >
      {getInitial(member.name)}
    </div>
  )
}

export default function MembersSettingsPage() {
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [inviteCode, setInviteCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [issuingInvite, setIssuingInvite] = useState(false)
  const workspaceId = getCurrentWorkspaceId()
  const adminCount = members.filter((member) => member.role === 'admin').length
  const avatarColorMap = createAvatarColorMap(members.map((member) => member.user_id))

  useEffect(() => {
    let active = true

    async function loadMembers() {
      setLoading(true)
      setError('')

      try {
        const [workspace, memberList, departmentList] = await Promise.all([
          getWorkspace(workspaceId),
          getWorkspaceMembers(workspaceId),
          getDepartments(workspaceId),
        ])
        if (!active) return
        setInviteCode(workspace.invite_code)
        setMembers(memberList)
        setDepartments(departmentList)
      } catch (err) {
        if (!active) return
        setError(getSettingsErrorMessage(err, '멤버 정보를 불러오지 못했습니다.'))
      } finally {
        if (active) setLoading(false)
      }
    }

    loadMembers()

    return () => {
      active = false
    }
  }, [workspaceId])

  function handleCopy() {
    navigator.clipboard.writeText(inviteCode).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function changeRole(userId: number, role: Role) {
    const backendRole = ROLE_TO_BACKEND[role]
    setError('')

    try {
      await updateMemberRole(workspaceId, userId, backendRole)
      setMembers((prev) => prev.map((m) => m.user_id === userId ? { ...m, role: backendRole } : m))
    } catch (err) {
      setError(getSettingsErrorMessage(err, '역할 변경에 실패했습니다.'))
    }
  }

  async function changeDepartment(userId: number, departmentId: number | null) {
    setError('')

    try {
      const updated = await updateMemberDepartment(workspaceId, userId, departmentId)
      setMembers((prev) => prev.map((m) => (
        m.user_id === userId
          ? { ...m, department_id: updated.department_id, department: updated.department }
          : m
      )))
    } catch (err) {
      setError(getSettingsErrorMessage(err, '부서 변경에 실패했습니다.'))
    }
  }

  async function changeMemberProfile(
    userId: number,
    patch: Partial<Pick<WorkspaceMember, 'birth_date' | 'gender'>>,
  ) {
    const member = members.find((item) => item.user_id === userId)
    if (!member) return
    setError('')
    const nextBirthDate = Object.prototype.hasOwnProperty.call(patch, 'birth_date')
      ? patch.birth_date ?? null
      : member.birth_date
    const nextGender = Object.prototype.hasOwnProperty.call(patch, 'gender')
      ? patch.gender ?? null
      : member.gender

    if (nextBirthDate === member.birth_date && nextGender === member.gender) {
      return
    }

    setMembers((prev) => prev.map((m) => (
      m.user_id === userId
        ? { ...m, birth_date: nextBirthDate, gender: nextGender }
        : m
    )))

    try {
      const updated = await updateMemberProfile(workspaceId, userId, {
        birth_date: nextBirthDate,
        gender: nextGender,
      })
      setMembers((prev) => prev.map((m) => (
        m.user_id === userId
          ? { ...m, birth_date: updated.birth_date, age: updated.age, gender: updated.gender }
          : m
      )))
    } catch (err) {
      setError(getSettingsErrorMessage(err, '멤버 정보 변경에 실패했습니다.'))
    }
  }

  async function handleIssueInviteCode() {
    setIssuingInvite(true)
    setError('')

    try {
      const issued = await issueInviteCode(workspaceId)
      setInviteCode(issued.invite_code)
    } catch (err) {
      setError(getSettingsErrorMessage(err, '초대코드 발급에 실패했습니다.'))
    } finally {
      setIssuingInvite(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <p className="text-sm text-muted-foreground">멤버 정보를 불러오는 중입니다...</p>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">멤버 · 권한 관리</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{members.length}명의 멤버</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Invite code */}
      <div className="p-3.5 rounded-lg border border-border bg-muted/20 mb-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground mb-0.5">초대코드</p>
            <p className="text-mini text-muted-foreground">이 코드를 공유하면 누구나 참여할 수 있습니다.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm tracking-widest text-foreground bg-card px-3 py-2 rounded border border-border">
              {inviteCode}
            </span>
            <button onClick={handleCopy} className="flex items-center gap-1 px-3 py-2 rounded border border-border text-sm hover:bg-muted transition-colors">
              {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
              {copied ? '복사됨' : '복사'}
            </button>
            <button
              onClick={handleIssueInviteCode}
              disabled={issuingInvite}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <UserPlus size={13} /> {issuingInvite ? '발급 중...' : '새 코드 발급'}
            </button>
          </div>
        </div>
      </div>

      {/* Member table */}
      <div className="select-none rounded-lg border border-border overflow-x-auto bg-card">
        {/* Table header — desktop only */}
        <div className={`hidden md:grid ${DESKTOP_MEMBER_GRID} gap-3 px-4 py-2 bg-muted/40 border-b border-border text-center text-micro font-medium text-muted-foreground uppercase tracking-wide`}>
          <span>멤버</span>
          <span>역할</span>
          <span>부서</span>
          <span>생년월일</span>
          <span>나이</span>
          <span>성별</span>
          <span>권한</span>
        </div>
        {members.map((member) => (
          <div key={member.user_id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
            {/* Mobile layout */}
            <div className="flex items-center justify-between gap-2 px-4 pt-3 md:hidden">
              <div className="flex items-center gap-2.5 min-w-0">
                <MemberAvatar member={member} avatarColorMap={avatarColorMap} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{member.name}</p>
                  <p className="text-mini text-muted-foreground truncate">{member.email}</p>
                  <p className="text-micro text-muted-foreground truncate">
                    {member.department ?? '부서 없음'} · {formatAge(member.age)} · {genderLabel(member.gender)}
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 px-4 pb-3 md:hidden">
              <BirthDateSelect
                value={member.birth_date ?? ''}
                onChange={(value) => changeMemberProfile(member.user_id, { birth_date: value || null })}
                compact
              />
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={member.department_id ?? ''}
                  onChange={(e) => changeDepartment(member.user_id, e.target.value ? Number(e.target.value) : null)}
                  className="h-9 rounded border border-border bg-card px-2 text-mini outline-none"
                  aria-label="부서 변경"
                >
                  <option value="">부서 없음</option>
                  {departments.map((department) => (
                    <option key={department.department_id} value={department.department_id}>{department.name}</option>
                  ))}
                </select>
                <select
                  value={member.gender ?? ''}
                  onChange={(e) => changeMemberProfile(member.user_id, {
                    gender: e.target.value ? e.target.value as Gender : null,
                  })}
                  className="h-9 rounded border border-border bg-card px-2 text-mini outline-none"
                  aria-label="성별 변경"
                >
                  <option value="">성별 선택</option>
                  {GENDER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <select
                  value={BACKEND_TO_ROLE[member.role]}
                  onChange={(e) => changeRole(member.user_id, e.target.value as Role)}
                  disabled={member.role === 'admin' && adminCount <= 1}
                  className="h-9 rounded border border-border bg-card px-2 text-mini outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="권한 변경"
                  title={member.role === 'admin' && adminCount <= 1 ? '워크스페이스에는 최소 1명의 관리자가 필요합니다.' : undefined}
                >
                  {(['관리자', '멤버', '뷰어'] as Role[]).map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Desktop layout */}
            <div className={`hidden md:grid ${DESKTOP_MEMBER_GRID} gap-3 items-center px-4 py-3`}>
              <div className="flex items-center gap-2.5">
                <MemberAvatar member={member} avatarColorMap={avatarColorMap} />
                <div>
                  <p className="text-sm font-medium text-foreground">{member.name}</p>
                  <p className="text-mini text-muted-foreground">{member.email}</p>
                </div>
              </div>
              <div className="flex items-center justify-center gap-1.5">
                {member.role === 'admin' && <Shield size={12} className="text-accent" />}
                <span className={`px-2 py-0.5 rounded-full text-mini font-medium ${ROLE_STYLES[BACKEND_TO_ROLE[member.role]]}`}>
                  {BACKEND_TO_ROLE[member.role]}
                </span>
              </div>
              <select
                value={member.department_id ?? ''}
                onChange={(e) => changeDepartment(member.user_id, e.target.value ? Number(e.target.value) : null)}
                className="h-8 w-full rounded border border-border bg-card px-2 text-center text-mini outline-none cursor-pointer hover:border-foreground transition-colors"
                aria-label="부서 변경"
              >
                <option value="">부서 없음</option>
                {departments.map((department) => (
                  <option key={department.department_id} value={department.department_id}>
                    {department.name}
                  </option>
                ))}
              </select>
              <BirthDateSelect
                value={member.birth_date ?? ''}
                onChange={(value) => changeMemberProfile(member.user_id, { birth_date: value || null })}
                compact
              />
              <span className="text-center text-mini text-muted-foreground whitespace-nowrap">{formatAge(member.age)}</span>
              <select
                value={member.gender ?? ''}
                onChange={(e) => changeMemberProfile(member.user_id, {
                  gender: e.target.value ? e.target.value as Gender : null,
                })}
                className="h-8 w-full rounded border border-border bg-card px-2 text-center text-mini outline-none cursor-pointer hover:border-foreground transition-colors"
                aria-label="성별 변경"
              >
                <option value="">성별 선택</option>
                {GENDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <select
                value={BACKEND_TO_ROLE[member.role]}
                onChange={(e) => changeRole(member.user_id, e.target.value as Role)}
                disabled={member.role === 'admin' && adminCount <= 1}
                className="h-8 w-full rounded border border-border bg-card px-2 text-center text-mini outline-none cursor-pointer hover:border-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="역할 변경"
                title={member.role === 'admin' && adminCount <= 1 ? '워크스페이스에는 최소 1명의 관리자가 필요합니다.' : undefined}
              >
                {(['관리자', '멤버', '뷰어'] as Role[]).map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
