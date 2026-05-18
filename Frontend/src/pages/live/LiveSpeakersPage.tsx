import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Mic, CheckCircle, AlertCircle, UserPlus } from 'lucide-react'
import { PARTICIPANTS } from '../../data/mockData'

const MOCK_SPEAKERS = [
  { id: 'p1', name: '김수민', status: 'matched' as const, confidence: 98, utterances: 24 },
  { id: 'p2', name: '이지현', status: 'matched' as const, confidence: 95, utterances: 18 },
  { id: 'p3', name: '박준혁', status: 'matched' as const, confidence: 91, utterances: 15 },
  { id: 'p4', name: '최은영', status: 'unmatched' as const, confidence: 0, utterances: 7 },
]

export default function LiveSpeakersPage() {
  const { meetingId } = useParams()
  const navigate = useNavigate()
  const [assignments, setAssignments] = useState<Record<string, string>>({})

  function assignSpeaker(speakerId: string, participantId: string) {
    setAssignments((prev) => ({ ...prev, [speakerId]: participantId }))
    // TODO: update speaker diarization mapping
    console.log('TODO: assign speaker', { speakerId, participantId })
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-center gap-2 mb-5">
        <button onClick={() => navigate(`/live/${meetingId}`)} className="text-muted-foreground hover:text-foreground transition-colors" aria-label="뒤로">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-semibold text-foreground">화자 등록 · 확인</h1>
          <p className="text-sm text-muted-foreground">참석자 음성을 매핑하고 미인식 화자를 교정하세요.</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 mb-5">
        {MOCK_SPEAKERS.map((speaker) => {
          const p = PARTICIPANTS.find((p) => p.id === speaker.id)
          const assigned = assignments[speaker.id]
          const assignedP = PARTICIPANTS.find((p) => p.id === assigned)

          return (
            <div key={speaker.id} className="p-3.5 rounded-lg border border-border bg-card">
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold shrink-0"
                  style={{ backgroundColor: p?.color ?? '#888' }}
                >
                  {speaker.status === 'unmatched' ? '?' : speaker.name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {assigned ? assignedP?.name : (speaker.status === 'unmatched' ? '미인식 화자' : speaker.name)}
                    </span>
                    {speaker.status === 'matched' && !assigned ? (
                      <span className="flex items-center gap-1 text-mini text-green-600 dark:text-green-400">
                        <CheckCircle size={12} /> {speaker.confidence}% 신뢰도
                      </span>
                    ) : speaker.status === 'unmatched' && !assigned ? (
                      <span className="flex items-center gap-1 text-mini text-yellow-600 dark:text-yellow-400">
                        <AlertCircle size={12} /> 수동 교정 필요
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Mic size={11} className="text-muted-foreground" />
                    <span className="text-mini text-muted-foreground">{speaker.utterances}회 발화</span>
                  </div>
                </div>
                {(speaker.status === 'unmatched' || assigned) && (
                  <select
                    value={assigned ?? ''}
                    onChange={(e) => assignSpeaker(speaker.id, e.target.value)}
                    className="h-8 px-2 rounded-lg border border-border bg-background text-sm outline-none"
                  >
                    <option value="">화자 선택</option>
                    {PARTICIPANTS.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <button
        onClick={() => {
          console.log('TODO: register new speaker during meeting')
        }}
        className="flex items-center gap-1.5 w-full h-9 px-3 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:border-accent hover:text-accent transition-colors mb-5"
      >
        <UserPlus size={14} /> 신규 참석자 즉시 등록
      </button>

      <button
        onClick={() => navigate(`/live/${meetingId}`)}
        className="w-full h-10 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors"
      >
        저장하고 회의로 돌아가기
      </button>
    </div>
  )
}
