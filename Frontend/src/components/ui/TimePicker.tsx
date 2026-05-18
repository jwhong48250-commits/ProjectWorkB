import { useState, useRef, useEffect } from 'react'
import { Clock } from 'lucide-react'
import clsx from 'clsx'

interface TimePickerProps {
  value: string // HH:MM 형식
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = [0, 15, 30, 45]

/**
 * DatePicker와 동일한 디자인 언어를 사용하는 커스텀 시간 선택기.
 * 시(0–23)와 분(0, 15, 30, 45)을 각각 컬럼으로 선택.
 * 창을 다시 열면 선택이 비워지며, 시·분을 모두 다시 골라야 확정·닫힘.
 */
function parseTimeValue(v: string): [number | null, number | null] {
  if (!v || !v.includes(':')) return [null, null]
  const [hs, ms] = v.split(':')
  const h = Number(hs)
  const m = Number(ms)
  return [
    Number.isFinite(h) ? h : null,
    Number.isFinite(m) ? m : null,
  ]
}

export default function TimePicker({
  value,
  onChange,
  placeholder = '시간 선택',
  className,
}: TimePickerProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const hourListRef = useRef<HTMLDivElement>(null)

  /** 패널이 열려 있는 동안만 사용 — 시·분 둘 다 고른 뒤에만 확정·닫기 */
  const [draftHour, setDraftHour] = useState<number | null>(null)
  const [draftMin, setDraftMin] = useState<number | null>(null)

  const [selHour, selMin] = parseTimeValue(value)

  /** 다시 열면 시·분 선택을 비움 → 시와 분을 모두 다시 고른 뒤에만 확정 */
  function openPicker() {
    setDraftHour(null)
    setDraftMin(null)
    setOpen(true)
  }

  function togglePicker() {
    if (open) {
      setOpen(false)
    } else {
      openPicker()
    }
  }

  // 외부 클릭·ESC로 닫기
  useEffect(() => {
    if (!open) return
    function handleDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const hourForScroll = open ? draftHour : selHour

  // 패널 열릴 때 선택된 시간으로 스크롤
  useEffect(() => {
    if (!open || hourForScroll === null) return
    const el = hourListRef.current
    if (!el) return
    const btn = el.querySelector(`[data-hour="${hourForScroll}"]`) as HTMLElement | null
    btn?.scrollIntoView({ block: 'center' })
  }, [open, hourForScroll])

  function finalize(h: number, m: number) {
    const hh = String(h).padStart(2, '0')
    const mm = String(m).padStart(2, '0')
    onChange(`${hh}:${mm}`)
    setOpen(false)
  }

  function onHourClick(h: number) {
    setDraftHour(h)
    if (draftMin !== null) {
      finalize(h, draftMin)
    }
  }

  function onMinuteClick(m: number) {
    setDraftMin(m)
    if (draftHour !== null) {
      finalize(draftHour, m)
    }
  }

  const pickHour = open ? draftHour : selHour
  const pickMin = open ? draftMin : selMin

  function formatHm(h: number, m: number) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  // 닫혀 있을 때: 저장된 value 표시. 열려 있을 때: 새로 고르는 중(초기화) → 둘 다 고를 때까지 placeholder 또는 부분 선택만 표시
  let displayValue = ''
  if (!open) {
    if (selHour !== null && selMin !== null) displayValue = formatHm(selHour, selMin)
  } else {
    if (draftHour !== null && draftMin !== null) {
      displayValue = formatHm(draftHour, draftMin)
    } else if (draftHour !== null) {
      displayValue = `${String(draftHour).padStart(2, '0')}:--`
    } else if (draftMin !== null) {
      displayValue = `--:${String(draftMin).padStart(2, '0')}`
    }
  }

  return (
    <div ref={containerRef} className={clsx('relative', className)}>
      {/* 트리거 버튼 — DatePicker 트리거와 동일한 스타일 */}
      <button
        type="button"
        onClick={togglePicker}
        className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent flex items-center gap-2 text-left"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="시간 선택"
      >
        <Clock size={14} className="text-muted-foreground shrink-0" aria-hidden="true" />
        <span className={displayValue ? 'text-foreground' : 'text-muted-foreground'}>
          {displayValue || placeholder}
        </span>
      </button>

      {/* 드롭다운 패널 — DatePicker 달력 패널과 동일한 스타일 */}
      {open && (
        <div
          role="dialog"
          aria-label="시간 선택"
          className="absolute left-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-lg p-3 w-52"
        >
          <div className="flex gap-2">
            {/* 시(Hour) 컬럼 */}
            <div className="flex-1 flex flex-col">
              <p className="text-xs font-medium text-muted-foreground mb-1.5 text-center">시</p>
              <div
                ref={hourListRef}
                className="max-h-44 overflow-y-auto flex flex-col gap-0.5 scrollbar-none"
              >
                {HOURS.map((h) => (
                  <button
                    key={h}
                    data-hour={h}
                    type="button"
                    onClick={() => onHourClick(h)}
                    className={clsx(
                      'w-full h-7 rounded text-sm transition-colors',
                      pickHour === h
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'hover:bg-muted text-foreground',
                    )}
                    aria-pressed={pickHour === h}
                    aria-label={`${h}시`}
                  >
                    {String(h).padStart(2, '0')}
                  </button>
                ))}
              </div>
            </div>

            {/* 구분선 */}
            <div className="w-px bg-border shrink-0" />

            {/* 분(Minute) 컬럼 */}
            <div className="flex-1 flex flex-col">
              <p className="text-xs font-medium text-muted-foreground mb-1.5 text-center">분</p>
              <div className="flex flex-col gap-0.5">
                {MINUTES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onMinuteClick(m)}
                    className={clsx(
                      'w-full h-7 rounded text-sm transition-colors',
                      pickMin === m
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'hover:bg-muted text-foreground',
                    )}
                    aria-pressed={pickMin === m}
                    aria-label={`${m}분`}
                  >
                    {String(m).padStart(2, '0')}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
