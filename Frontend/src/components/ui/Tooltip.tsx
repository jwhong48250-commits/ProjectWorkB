import { useState } from 'react'
import clsx from 'clsx'

interface TooltipProps {
  label: string
  children: React.ReactNode
  placement?: 'top' | 'right' | 'bottom' | 'left'
  /** 레이아웃 흐름에 맞게 full-width 블록처럼 동작 */
  block?: boolean
  className?: string
}

/**
 * 간단한 hover/focus 툴팁 래퍼.
 * label이 비어있으면 툴팁을 표시하지 않습니다.
 */
export default function Tooltip({ label, children, placement = 'right', block, className }: TooltipProps) {
  const [visible, setVisible] = useState(false)

  return (
    <span
      className={clsx(
        'relative',
        block ? 'flex w-full' : 'inline-flex',
        className,
      )}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && label && (
        <span
          role="tooltip"
          className={clsx(
            'absolute z-50 whitespace-nowrap px-2 py-1 rounded text-xs',
            'bg-foreground text-background shadow-md pointer-events-none',
            placement === 'right' && 'left-full ml-2 top-1/2 -translate-y-1/2',
            placement === 'top' && 'bottom-full mb-2 left-1/2 -translate-x-1/2',
            placement === 'bottom' && 'top-full mt-2 left-1/2 -translate-x-1/2',
            placement === 'left' && 'right-full mr-2 top-1/2 -translate-y-1/2',
          )}
        >
          {label}
        </span>
      )}
    </span>
  )
}
