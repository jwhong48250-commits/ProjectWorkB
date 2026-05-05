import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'

interface BirthDateSelectProps {
  value: string
  onChange: (value: string) => void
}

interface PickerProps {
  label: string
  placeholder: string
  value: string
  options: string[]
  formatLabel: (value: string) => string
  onChange: (value: string) => void
}

function pad(value: string): string {
  return value.padStart(2, '0')
}

function daysInMonth(year: string, month: string): number {
  if (!year || !month) return 31
  return new Date(Number(year), Number(month), 0).getDate()
}

function Picker({ label, placeholder, value, options, formatLabel, onChange }: PickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((next) => !next)}
        className={clsx(
          'flex h-10 w-full items-center justify-between rounded-lg border border-border bg-card px-3 text-left text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30',
          value ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        <span className="truncate">{value ? formatLabel(value) : placeholder}</span>
        <span className="ml-2 text-muted-foreground">⌄</span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-11 z-50 max-h-48 overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-lg">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                onChange(option)
                setOpen(false)
              }}
              className={clsx(
                'block h-9 w-full px-3 text-left text-sm transition-colors hover:bg-muted',
                option === value ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground',
              )}
            >
              {formatLabel(option)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function BirthDateSelect({ value, onChange }: BirthDateSelectProps) {
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
    if (day && !days.includes(day)) {
      setDay(days[days.length - 1] ?? '')
      return
    }

    onChange(year && month && day ? `${year}-${month}-${day}` : '')
  }, [year, month, day, days, onChange])

  return (
    <div className="grid grid-cols-[1.2fr_1fr_1fr] gap-2">
      <Picker
        label="생년"
        placeholder="연도"
        value={year}
        options={years}
        formatLabel={(item) => `${item}년`}
        onChange={setYear}
      />
      <Picker
        label="생월"
        placeholder="월"
        value={month}
        options={months}
        formatLabel={(item) => `${Number(item)}월`}
        onChange={setMonth}
      />
      <Picker
        label="생일"
        placeholder="일"
        value={day}
        options={days}
        formatLabel={(item) => `${Number(item)}일`}
        onChange={setDay}
      />
    </div>
  )
}
