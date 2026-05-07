import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'

interface BirthDateSelectProps {
  value: string
  onChange: (value: string) => void
  compact?: boolean
}

interface PickerProps {
  label: string
  placeholder: string
  value: string
  options: string[]
  formatLabel: (value: string) => string
  onChange: (value: string) => void
  compact?: boolean
}

function pad(value: string): string {
  return value.padStart(2, '0')
}

function daysInMonth(year: string, month: string): number {
  if (!year || !month) return 31
  return new Date(Number(year), Number(month), 0).getDate()
}

function Picker({ label, placeholder, value, options, formatLabel, onChange, compact = false }: PickerProps) {
  const [open, setOpen] = useState(false)
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false)
      }
    }

    function updatePosition() {
      const rect = rootRef.current?.getBoundingClientRect()
      if (rect) setMenuRect(rect)
    }

    updatePosition()
    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  function toggleOpen() {
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect) setMenuRect(rect)
    setOpen((next) => !next)
  }

  const menu = open && (
    <div
      ref={menuRef}
      className={clsx(
        'z-50 max-h-48 overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-lg',
        compact ? 'fixed' : 'absolute left-0 right-0 top-11',
      )}
      style={compact && menuRect ? {
        left: menuRect.left,
        top: menuRect.bottom + 4,
        width: menuRect.width,
      } : undefined}
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => {
            onChange(option)
            setOpen(false)
          }}
          className={clsx(
            'block w-full text-left transition-colors hover:bg-muted',
          compact ? 'h-8 px-2 text-mini' : 'h-9 px-3 text-sm',
            compact ? 'text-center' : 'text-left',
            option === value ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground',
          )}
        >
          {formatLabel(option)}
        </button>
      ))}
    </div>
  )

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={toggleOpen}
        className={clsx(
          'relative flex w-full items-center rounded-lg border border-border bg-card text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30',
          compact ? 'justify-center text-center' : 'justify-between text-left',
          compact ? 'h-8 px-2 text-mini' : 'h-10 px-3',
          value ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        <span className={compact ? 'whitespace-nowrap text-center' : 'truncate'}>{value ? formatLabel(value) : placeholder}</span>
        <span className={clsx('text-muted-foreground', compact ? 'absolute right-2' : 'ml-2')}>⌄</span>
      </button>
      {compact && menu ? createPortal(menu, document.body) : menu}
    </div>
  )
}

export default function BirthDateSelect({ value, onChange, compact = false }: BirthDateSelectProps) {
  const [year, setYear] = useState(() => value.split('-')[0] ?? '')
  const [month, setMonth] = useState(() => value.split('-')[1] ?? '')
  const [day, setDay] = useState(() => value.split('-')[2] ?? '')

  const currentYear = new Date().getFullYear()
  const years = useMemo(
    () => Array.from({ length: 121 }, (_, index) => String(currentYear - index)),
    [currentYear],
  )
  const months = useMemo(
    () => Array.from({ length: 12 }, (_, index) => pad(String(index + 1))),
    [],
  )
  const days = useMemo(
    () => Array.from({ length: daysInMonth(year, month) }, (_, index) => pad(String(index + 1))),
    [year, month],
  )

  useEffect(() => {
    setYear(value.split('-')[0] ?? '')
    setMonth(value.split('-')[1] ?? '')
    setDay(value.split('-')[2] ?? '')
  }, [value])

  useEffect(() => {
    if (day && !days.includes(day)) {
      setDay(days[days.length - 1] ?? '')
      return
    }

    const nextValue = year && month && day ? `${year}-${month}-${day}` : ''
    if (nextValue !== value) {
      onChange(nextValue)
    }
  }, [year, month, day, days, onChange, value])

  return (
    <div className={clsx('grid', compact ? 'grid-cols-[4.5rem_3.5rem_3.5rem] gap-1.5' : 'grid-cols-[1.2fr_1fr_1fr] gap-2')}>
      <Picker
        label="생년"
        placeholder="연도"
        value={year}
        options={years}
        formatLabel={(item) => `${item}년`}
        onChange={setYear}
        compact={compact}
      />
      <Picker
        label="생월"
        placeholder="월"
        value={month}
        options={months}
        formatLabel={(item) => `${Number(item)}월`}
        onChange={setMonth}
        compact={compact}
      />
      <Picker
        label="생일"
        placeholder="일"
        value={day}
        options={days}
        formatLabel={(item) => `${Number(item)}일`}
        onChange={setDay}
        compact={compact}
      />
    </div>
  )
}
