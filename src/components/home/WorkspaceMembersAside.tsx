import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Users } from 'lucide-react'
import { getWorkspaceMembers, type UserRole, type WorkspaceMember } from '../../api/workspace'
import { useProfileImage } from '../../utils/profileImage'
import {
  getCurrentWorkspaceRole,
  WORKSPACE_ROLE_CHANGED_EVENT,
} from '../../utils/workspace'

const AVATAR_COLORS = ['#6b78f6', '#22c55e', '#f97316', '#ec4899', '#eab308', '#14b8a6', '#8b5cf6']

function getAvatarColor(userId: number): string {
  return AVATAR_COLORS[Math.abs(userId) % AVATAR_COLORS.length]
}

function getInitial(name: string): string {
  return name.trim().charAt(0) || '?'
}

const ROLE_LABEL: Record<UserRole, string> = {
  admin: '관리자',
  member: '멤버',
  viewer: '뷰어',
}

const ROLE_BADGE: Record<UserRole, string> = {
  admin: 'bg-accent-subtle text-accent',
  member: 'bg-muted text-muted-foreground',
  viewer: 'bg-muted text-muted-foreground',
}

function sortMembers(list: WorkspaceMember[]): WorkspaceMember[] {
  const order: Record<UserRole, number> = { admin: 0, member: 1, viewer: 2 }
  return [...list].sort((a, b) => {
    const ra = order[a.role] ?? 9
    const rb = order[b.role] ?? 9
    if (ra !== rb) return ra - rb
    return a.name.localeCompare(b.name, 'ko')
  })
}

function MemberAvatar({ member }: { member: WorkspaceMember }) {
  const profileImage = useProfileImage(member.user_id)

  if (profileImage) {
    return (
      <img
        src={profileImage}
        alt={member.name}
        className="w-8 h-8 rounded-full object-cover shrink-0"
      />
    )
  }

  return (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
      style={{ backgroundColor: getAvatarColor(member.user_id) }}
      aria-hidden
    >
      {getInitial(member.name)}
    </div>
  )
}

export default function WorkspaceMembersAside({ workspaceId }: { workspaceId: number }) {
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workspaceRole, setWorkspaceRole] = useState(() => getCurrentWorkspaceRole())

  useEffect(() => {
    setWorkspaceRole(getCurrentWorkspaceRole())
  }, [workspaceId])

  useEffect(() => {
    function onRoleChanged(e: Event) {
      const role = (e as CustomEvent<{ role: string }>).detail?.role
      if (typeof role === 'string') setWorkspaceRole(role)
    }
    window.addEventListener(WORKSPACE_ROLE_CHANGED_EVENT, onRoleChanged)
    return () => window.removeEventListener(WORKSPACE_ROLE_CHANGED_EVENT, onRoleChanged)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getWorkspaceMembers(workspaceId)
      .then((list) => {
        if (!cancelled) setMembers(list)
      })
      .catch((e) => {
        if (!cancelled) {
          setMembers([])
          setError(e instanceof Error ? e.message : '멤버를 불러오지 못했습니다.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  const sorted = useMemo(() => sortMembers(members), [members])

  return (
    <section className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <Users size={15} className="text-muted-foreground shrink-0" />
          <h2 className="text-sm font-semibold text-foreground truncate">멤버</h2>
          {!loading && (
            <span className="text-mini text-muted-foreground shrink-0">{sorted.length}</span>
          )}
        </div>
        {workspaceRole === 'admin' && (
          <Link
            to="/settings/members"
            className="text-mini text-accent hover:underline shrink-0"
          >
            관리
          </Link>
        )}
      </div>

      {error && (
        <p className="px-3 py-2 text-mini text-red-600 border-b border-border">{error}</p>
      )}

      {loading ? (
        <div className="px-3 py-6 text-center text-mini text-muted-foreground">불러오는 중...</div>
      ) : sorted.length === 0 ? (
        <div className="px-3 py-6 text-center text-mini text-muted-foreground">멤버가 없습니다.</div>
      ) : (
        <ul className="max-h-[min(22rem,calc(100vh-20rem))] overflow-y-auto divide-y divide-border">
          {sorted.map((m) => (
            <li key={m.user_id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted/30 transition-colors">
              <MemberAvatar member={m} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">{m.name}</p>
                <p className="text-[11px] text-muted-foreground truncate">{m.email}</p>
                {m.department && (
                  <p className="text-[10px] text-muted-foreground/90 truncate mt-0.5">{m.department}</p>
                )}
              </div>
              <span
                className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${ROLE_BADGE[m.role]}`}
              >
                {ROLE_LABEL[m.role]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
