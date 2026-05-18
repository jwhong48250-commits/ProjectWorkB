import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Plus, Trash2, GripVertical, Clock, User, Paperclip, Play } from 'lucide-react'
import { AGENDA_M1 } from '../../data/mockAgenda'
import type { AgendaItem } from '../../types/agenda'
import { startWorkspaceMeeting } from '../../api/meetings'
import { getCurrentWorkspaceId } from '../../utils/workspace'

export default function AgendaPage() {
  const { meetingId } = useParams()
  const navigate = useNavigate()
  const [items, setItems] = useState<AgendaItem[]>(AGENDA_M1)

  function addItem() {
    const newItem: AgendaItem = {
      id: `ag-${Date.now()}`,
      order: items.length + 1,
      title: '',
      durationMin: 15,
    }
    setItems((prev) => [...prev, newItem])
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  function updateItem(id: string, field: keyof AgendaItem, value: string | number) {
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, [field]: value } : i))
  }

  const totalMin = items.reduce((sum, i) => sum + i.durationMin, 0)

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">아젠다 설정</h1>
          <p className="text-sm text-muted-foreground mt-0.5">회의 ID: {meetingId} · 총 예상 시간: {totalMin}분</p>
        </div>
        <button
          onClick={async () => {
            const wsid = getCurrentWorkspaceId()
            const numericId = Number(meetingId)
            if (Number.isFinite(numericId) && numericId > 0) {
              try {
                await startWorkspaceMeeting(wsid, numericId)
              } catch (err) {
                alert(err instanceof Error ? err.message : '회의 시작에 실패했습니다.')
                return
              }
            }
            navigate(`/live/${meetingId}`)
          }}
          className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors"
        >
          <Play size={14} /> 회의 시작
        </button>
      </div>

      <div className="flex flex-col gap-3 mb-4">
        {items.map((item, idx) => (
          <div key={item.id} className="flex items-start gap-2 p-3 rounded-lg border border-border bg-card">
            <button className="mt-2 text-muted-foreground cursor-grab" aria-label="순서 변경">
              <GripVertical size={16} />
            </button>
            <div className="flex items-center justify-center w-5 h-5 rounded-full bg-accent-subtle text-accent text-mini font-bold mt-2 shrink-0">
              {idx + 1}
            </div>
            <div className="flex-1 min-w-0 flex flex-col gap-2">
              <input
                type="text"
                value={item.title}
                onChange={(e) => updateItem(item.id, 'title', e.target.value)}
                placeholder="안건 제목"
                className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
              />
              <div className="flex gap-2">
                <div className="flex items-center gap-1.5 h-8 px-2 rounded border border-border bg-background flex-1">
                  <User size={12} className="text-muted-foreground shrink-0" />
                  <input
                    type="text"
                    value={item.presenter ?? ''}
                    onChange={(e) => updateItem(item.id, 'presenter', e.target.value)}
                    placeholder="발표자"
                    className="flex-1 bg-transparent outline-none text-sm"
                  />
                </div>
                <div className="flex items-center gap-1.5 h-8 px-2 rounded border border-border bg-background w-24">
                  <Clock size={12} className="text-muted-foreground shrink-0" />
                  <input
                    type="number"
                    value={item.durationMin}
                    onChange={(e) => updateItem(item.id, 'durationMin', Number(e.target.value))}
                    min={5}
                    max={120}
                    className="flex-1 bg-transparent outline-none text-sm w-0"
                  />
                  <span className="text-mini text-muted-foreground">분</span>
                </div>
              </div>
              {item.attachments && item.attachments.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {item.attachments.map((a) => (
                    <span key={a} className="flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-mini text-muted-foreground">
                      <Paperclip size={10} /> {a}
                    </span>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => console.log('TODO: attach file')}
                className="flex items-center gap-1 text-mini text-muted-foreground hover:text-accent transition-colors w-fit"
              >
                <Paperclip size={11} /> 자료 첨부
              </button>
            </div>
            <button
              onClick={() => removeItem(item.id)}
              className="mt-2 text-muted-foreground hover:text-red-500 transition-colors"
              aria-label="삭제"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={addItem}
        className="flex items-center gap-1.5 w-full h-9 px-3 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:border-accent hover:text-accent transition-colors mb-6"
      >
        <Plus size={14} /> 안건 추가
      </button>

      <div className="flex gap-3">
        <button
          onClick={() => navigate(-1)}
          className="flex-1 h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted/50 transition-colors"
        >
          뒤로
        </button>
        <button
          onClick={() => {
            console.log('TODO: save agenda', items)
            navigate(`/live/${meetingId}`)
          }}
          className="flex-1 h-10 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors"
        >
          저장하고 회의 시작
        </button>
      </div>
    </div>
  )
}
