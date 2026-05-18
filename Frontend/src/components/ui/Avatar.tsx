import clsx from 'clsx'
import type { Participant } from '../../types/meeting'
import { useProfileImage } from '../../utils/profileImage'

interface AvatarProps {
  participant: Participant
  size?: 'sm' | 'md'
  className?: string
}

export function Avatar({ participant, size = 'sm', className }: AvatarProps) {
  const sizeClass = size === 'sm' ? 'w-6 h-6 text-micro' : 'w-8 h-8 text-mini'
  const profileImage = useProfileImage(participant.userId)

  if (profileImage) {
    return (
      <img
        src={profileImage}
        alt={participant.name}
        title={participant.name}
        className={clsx('inline-flex rounded-full object-cover shrink-0 select-none', sizeClass, className)}
      />
    )
  }

  return (
    <span
      className={clsx(
        'inline-flex items-center justify-center rounded-full font-medium shrink-0 select-none',
        sizeClass,
        className,
      )}
      style={{ backgroundColor: participant.color + '33', color: participant.color }}
      title={participant.name}
    >
      {participant.avatarInitials.slice(0, 2)}
    </span>
  )
}

interface AvatarGroupProps {
  participants: Participant[]
  max?: number
  size?: 'sm' | 'md'
}

export function AvatarGroup({ participants, max = 4, size = 'sm' }: AvatarGroupProps) {
  const visible = participants.slice(0, max)
  const overflow = participants.length - max
  const sizeClass = size === 'sm' ? 'w-6 h-6 text-micro' : 'w-8 h-8 text-mini'

  return (
    <div className="flex items-center">
      {visible.map((p, i) => (
        <span key={p.id} style={{ marginLeft: i === 0 ? 0 : '-6px', zIndex: visible.length - i }}>
          <Avatar participant={p} size={size} className="ring-1 ring-card" />
        </span>
      ))}
      {overflow > 0 && (
        <span
          className={clsx(
            'inline-flex items-center justify-center rounded-full font-medium shrink-0',
            'bg-muted text-muted-foreground ring-1 ring-card',
            sizeClass,
          )}
          style={{ marginLeft: '-6px' }}
        >
          +{overflow}
        </span>
      )}
    </div>
  )
}
