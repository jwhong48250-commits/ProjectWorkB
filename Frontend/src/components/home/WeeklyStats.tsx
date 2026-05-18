import { Video, Clock, CheckSquare, TrendingUp } from 'lucide-react'
import type { WeeklyStats } from '../../types/meeting'

interface WeeklyStatsProps {
  stats: WeeklyStats
}

export default function WeeklyStatsCard({ stats }: WeeklyStatsProps) {
  const hasActions = stats.actionItemsTotal > 0
  const completionRate = hasActions
    ? Math.round((stats.actionItemsDone / stats.actionItemsTotal) * 100)
    : 0

  return (
    <div className="p-4 rounded-lg border bg-card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <TrendingUp size={14} className="text-accent" />
          이번 주 요약
        </h2>
        <span className="text-mini text-muted-foreground">
          {new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })} 기준
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <StatTile
          icon={<Video size={14} className="text-status-inprogress" />}
          value={`${stats.totalMeetings}개`}
          label="회의 수"
          bg="bg-status-inprogress-bg"
        />
        <StatTile
          icon={<Clock size={14} className="text-status-upcoming" />}
          value={`${Math.floor(stats.totalMinutes / 60)}시간 ${stats.totalMinutes % 60}분`}
          label="총 회의 시간"
          bg="bg-status-upcoming-bg"
        />
      </div>

      {/* Action items progress */}
      {/* <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-mini">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <CheckSquare size={12} />
            액션 아이템 완료율
          </span>
          <span className="font-medium text-foreground">
            {hasActions ? `${stats.actionItemsDone} / ${stats.actionItemsTotal}` : '0 / 0'}
          </span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-slow"
            style={{ width: `${completionRate}%` }}
          />
        </div>
        <span className="text-micro text-muted-foreground">
          {hasActions ? `${completionRate}% 완료` : '액션이 없습니다.'}
        </span>
      </div> */}
    </div>
  )
}

function StatTile({
  icon,
  value,
  label,
  bg,
}: {
  icon: React.ReactNode
  value: string | number
  label: string
  bg: string
}) {
  return (
    <div className={`flex flex-col gap-1.5 p-3 rounded-md ${bg}`}>
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-mini text-muted-foreground">{label}</span>
      </div>
      <span className="text-xl font-semibold text-foreground">{value}</span>
    </div>
  )
}
