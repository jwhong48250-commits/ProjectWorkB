import { CheckSquare, Square, AlertCircle, Clock } from 'lucide-react'
import clsx from 'clsx'
import { Avatar } from '../ui/Avatar'
import type { ActionItem, Priority } from '../../types/meeting'
import { formatDateShort, isPast } from '../../utils/format'

const priorityConfig: Record<Priority, { label: string; color: string }> = {
  urgent: { label: '긴급', color: 'text-red-500' },
  high:   { label: '높음', color: 'text-orange-500' },
  medium: { label: '보통', color: 'text-yellow-500' },
  low:    { label: '낮음', color: 'text-muted-foreground' },
}

interface ActionItemsListProps {
  items: ActionItem[]
}

export default function ActionItemsList({ items }: ActionItemsListProps) {
  const pending = items.filter((i) => !i.done)
  const overdue = pending.filter((i) => isPast(i.dueDate))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <CheckSquare size={14} className="text-accent" />
          미완료 액션 아이템
        </h2>
        <div className="flex items-center gap-2">
          {overdue.length > 0 && (
            <span className="flex items-center gap-1 text-mini text-red-500 font-medium">
              <AlertCircle size={11} />
              {overdue.length}개 기한 초과
            </span>
          )}
          <span className="text-mini text-muted-foreground">{pending.length}개</span>
        </div>
      </div>

      <div className="flex flex-col divide-y divide-border">
        {pending.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            완료되지 않은 액션 아이템이 없습니다 🎉
          </p>
        ) : (
          pending.map((item) => (
            <ActionRow key={item.id} item={item} />
          ))
        )}
      </div>
    </div>
  )
}

function ActionRow({ item }: { item: ActionItem }) {
  const { color } = priorityConfig[item.priority]
  const overdue = isPast(item.dueDate)

  return (
    <div className="flex items-start gap-3 py-2.5 group">
      {/* Checkbox placeholder */}
      <button
        className="mt-0.5 shrink-0 text-muted-foreground hover:text-accent transition-colors"
        aria-label="완료 표시"
        // TODO: implement toggle done action
      >
        <Square size={14} />
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground leading-snug">{item.title}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-micro text-muted-foreground">{item.meetingTitle}</span>
          <span className="text-micro text-muted-foreground">·</span>
          <span className={clsx('flex items-center gap-0.5 text-micro font-medium', color)}>
            {priorityConfig[item.priority].label}
          </span>
        </div>
      </div>

      {/* Right meta */}
      <div className="flex items-center gap-2 shrink-0">
        <span className={clsx(
          'flex items-center gap-1 text-micro',
          overdue ? 'text-red-500 font-medium' : 'text-muted-foreground',
        )}>
          <Clock size={10} />
          {formatDateShort(item.dueDate)}
        </span>
        <Avatar participant={item.assignee} size="sm" />
      </div>
    </div>
  )
}
