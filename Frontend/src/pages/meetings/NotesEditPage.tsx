import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Save, Loader2, ArrowLeft } from 'lucide-react'
import { getCurrentWorkspaceId } from '../../api/client'
import { getMinutes, patchMinutes } from '../../api/actions'

export default function NotesEditPage() {
  const { meetingId } = useParams()
  const navigate = useNavigate()
  const workspaceId = getCurrentWorkspaceId()

  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!meetingId) return
    getMinutes(meetingId, workspaceId)
      .then((data) => setContent(data.content ?? ''))
      .catch(() => setContent(''))
      .finally(() => setLoading(false))
  }, [meetingId])

  async function handleSave() {
    if (!meetingId) return
    setSaving(true)
    try {
      await patchMinutes(meetingId, workspaceId, content)
      navigate(`/meetings/${meetingId}/reports?tab=minutes`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <button
            onClick={() => navigate(`/meetings/${meetingId}/reports?tab=minutes`)}
            className="flex items-center gap-1.5 text-mini text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <ArrowLeft size={12} /> 회의록으로 돌아가기
          </button>
          <h1 className="text-xl font-semibold text-foreground">회의록 편집</h1>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 disabled:opacity-60 transition-colors"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          저장
        </button>
      </div>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={32}
        className="w-full px-4 py-3 rounded-xl border border-border bg-card text-sm font-mono leading-relaxed outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent resize-none"
        placeholder="회의록 내용을 입력하세요..."
      />
    </div>
  )
}
