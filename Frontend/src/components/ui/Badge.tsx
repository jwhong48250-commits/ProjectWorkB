import clsx from 'clsx'

type BadgeVariant = 'inprogress' | 'upcoming' | 'completed' | 'default'

const variantClass: Record<BadgeVariant, string> = {
  inprogress: 'bg-status-inprogress-bg text-status-inprogress',
  upcoming:   'bg-status-upcoming-bg text-status-upcoming',
  completed:  'bg-status-completed-bg text-status-completed',
  default:    'bg-muted text-muted-foreground',
}

const variantLabel: Record<BadgeVariant, string> = {
  inprogress: '진행 중',
  upcoming:   '예정',
  completed:  '완료',
  default:    '',
}

interface BadgeProps {
  variant?: BadgeVariant
  label?: string
  dot?: boolean
  className?: string
}

export default function Badge({ variant = 'default', label, dot = false, className }: BadgeProps) {
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-mini font-medium',
      variantClass[variant],
      className,
    )}>
      {dot && (
        <span className={clsx(
          'w-1.5 h-1.5 rounded-full shrink-0',
          variant === 'inprogress' && 'bg-status-inprogress animate-pulse',
          variant === 'upcoming'   && 'bg-status-upcoming',
          variant === 'completed'  && 'bg-status-completed',
          variant === 'default'    && 'bg-muted-foreground',
        )} />
      )}
      {label ?? variantLabel[variant]}
    </span>
  )
}
