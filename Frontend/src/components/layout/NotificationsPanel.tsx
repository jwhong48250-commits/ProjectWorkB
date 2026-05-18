import { useEffect, useMemo, useState } from 'react'
import { Bell, X } from 'lucide-react'
import clsx from 'clsx'
import { apiRequest } from '../../api/client'
import { getCurrentWorkspaceId } from '../../utils/workspace'

interface Notification {
  id: number
  type: string
  title: string
  body: string
  link?: string | null
  created_at: string
  read_at?: string | null
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  const min = Math.floor(diff / 60000)
  if (min < 1) return '방금'
  if (min < 60) return `${min}분 전`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}시간 전`
  const day = Math.floor(hr / 24)
  return `${day}일 전`
}

interface NotificationsPanelProps {
  onClose: () => void
  onUnreadCountChange?: (count: number) => void
}

export default function NotificationsPanel({ onClose, onUnreadCountChange }: NotificationsPanelProps) {
  const [items, setItems] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)

  async function fetchNotifications(): Promise<void> {
    const workspaceId = getCurrentWorkspaceId()
    setLoading(true)
    try {
      const res = await apiRequest<{ notifications: Notification[]; unread_count: number }>(
        `/notifications/workspaces/${workspaceId}?limit=30`,
      )
      const nextItems = Array.isArray(res.notifications) ? res.notifications : []
      const nextUnread = Number(res.unread_count ?? 0) || 0
      setItems(nextItems)
      setUnreadCount(nextUnread)
      onUnreadCountChange?.(nextUnread)
    } catch {
      setItems([])
      setUnreadCount(0)
      onUnreadCountChange?.(0)
    } finally {
      setLoading(false)
    }
  }

  // ESC 키로 닫기
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  useEffect(() => {
    let mounted = true
    fetchNotifications().catch(() => {
      /* handled in fetchNotifications */
    })
    return () => {
      mounted = false
    }
  }, [])

  const unreadIds = useMemo(
    () => items.filter((n) => !n.read_at).map((n) => n.id),
    [items],
  )
  const readCount = useMemo(() => items.filter((n) => Boolean(n.read_at)).length, [items])

  return (
    <div
      role="dialog"
      aria-label="알림 목록"
      aria-modal="false"
      className="absolute right-0 top-full mt-1 z-50 w-80 rounded-lg border border-border bg-card shadow-lg"
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Bell size={14} className="text-accent" />
          <span className="text-sm font-semibold text-foreground">알림</span>
          {unreadCount > 0 && (
            <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-accent-foreground text-xs font-medium">
              {unreadCount}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label="알림 닫기"
        >
          <X size={14} />
        </button>
      </div>

      {/* 알림 목록 */}
      {loading ? (
        <div className="px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        </div>
      ) : items.length > 0 ? (
        <ul className="divide-y divide-border max-h-72 overflow-y-auto" role="list">
          {items.map((n) => {
            const isRead = Boolean(n.read_at)
            return (
            <li
              key={String(n.id)}
              className={clsx(
                'flex gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors',
                isRead && 'opacity-60',
              )}
              onClick={async () => {
                try {
                  const workspaceId = getCurrentWorkspaceId()
                  await apiRequest(`/notifications/workspaces/${workspaceId}/read`, {
                    method: 'PATCH',
                    body: JSON.stringify({ ids: [n.id] }),
                  })
                } catch {
                  // ignore
                }
                // 패널/TopBar 즉시 동기화
                try {
                  await fetchNotifications()
                } catch {
                  // ignore
                }
                if (n.link) {
                  window.location.href = n.link
                }
                onClose()
              }}
            >
              <span
                className={clsx(
                  'mt-1.5 w-1.5 h-1.5 rounded-full shrink-0',
                  isRead ? 'bg-transparent' : 'bg-accent',
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{n.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                <p className="text-xs text-muted-foreground/60 mt-1">{timeAgo(n.created_at)}</p>
              </div>
            </li>
          )})}
        </ul>
      ) : (
        <div className="px-4 py-10 text-center">
          <Bell size={28} className="text-muted-foreground mx-auto mb-2 opacity-30" />
          <p className="text-sm text-muted-foreground">새로운 알림이 없습니다.</p>
        </div>
      )}

      {/* 푸터 */}
      <div className="px-4 py-2 border-t border-border flex items-center justify-between">
        <button
          className="text-xs text-accent hover:underline transition-colors"
          onClick={async () => {
            try {
              const workspaceId = getCurrentWorkspaceId()
              await apiRequest(`/notifications/workspaces/${workspaceId}/read-all`, { method: 'POST' })
            } catch {
              // ignore
            }
            // 버튼 클릭 시 즉시 새로고침 (목록 + 종 옆 점)
            try {
              await fetchNotifications()
            } catch {
              // ignore
            }
          }}
          disabled={unreadIds.length === 0}
        >
          모두 읽음으로 표시
        </button>
        <button
          className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={async () => {
            try {
              const workspaceId = getCurrentWorkspaceId()
              await apiRequest<{ deleted_count: number }>(`/notifications/workspaces/${workspaceId}/read`, {
                method: 'DELETE',
              })
            } catch {
              // ignore
            }
            // 버튼 클릭 시 즉시 새로고침 (목록 + 종 옆 점)
            try {
              await fetchNotifications()
            } catch {
              // ignore
            }
          }}
          disabled={readCount === 0}
          title={readCount === 0 ? '삭제할 읽은 알림이 없습니다.' : '읽은 알림을 삭제합니다.'}
        >
          읽은 알림 삭제
        </button>
      </div>
    </div>
  )
}
