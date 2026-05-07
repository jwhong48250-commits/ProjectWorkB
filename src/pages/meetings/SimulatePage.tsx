import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Upload, FileAudio, Loader2, CheckCircle2 } from 'lucide-react'
import { getCurrentWorkspaceId } from '../../utils/workspace'
import { startWorkspaceMeeting, endWorkspaceMeeting } from '../../api/meetings'

const ASR_BASE =
  ((import.meta.env.VITE_ASR_SERVER as string | undefined) ?? 'http://localhost:8888')
    .trim()
    .replace(/\/+$/, '')

type SimStatus = 'idle' | 'uploading' | 'done' | 'error'

export default function SimulatePage() {
  const { meetingId } = useParams<{ meetingId: string }>()
  const navigate = useNavigate()

  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<SimStatus>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null
    if (selected && !selected.name.toLowerCase().endsWith('.wav')) {
      setErrorMsg('WAV(.wav) 파일만 선택할 수 있습니다.')
      setFile(null)
      return
    }
    setFile(selected)
    setErrorMsg(null)
    setStatus('idle')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !meetingId) return

    setStatus('uploading')
    setErrorMsg(null)

    try {
      const workspaceId = getCurrentWorkspaceId()

      // 1. 회의 시작 (in_progress 전환)
      await startWorkspaceMeeting(workspaceId, Number(meetingId))

      // 2. ASR 서버 오프라인 화자분리
      const params = new URLSearchParams({
        meeting_id: meetingId,
        workspace_id: String(workspaceId),
      })

      const form = new FormData()
      form.append('file', file)

      const res = await fetch(
        `${ASR_BASE}/meeting/test?${params}`,
        { method: 'POST', body: form },
      )

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`ASR 서버 오류 (${res.status})${text ? `: ${text}` : ''}`)
      }

      // 3. 회의 종료 + LangGraph 후처리 파이프라인
      await endWorkspaceMeeting(workspaceId, Number(meetingId))

      setStatus('done')
      navigate(`/meetings/${meetingId}/notes`)
    } catch (err) {
      setStatus('error')
      setErrorMsg(
        err instanceof Error
          ? err.message
          : '시뮬레이션에 실패했습니다. 잠시 후 다시 시도해 주세요.',
      )
    }
  }

  const isUploading = status === 'uploading'

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-xl mx-auto px-4 py-8">

        {/* 헤더 */}
        <div className="flex items-center gap-3 mb-8">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-lg font-semibold">WAV 시뮬레이션</h1>
            <p className="text-sm text-muted-foreground">개발·QA 전용 — 관리자만 사용 가능</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 파일 선택 */}
          <div
            className="border-2 border-dashed border-muted rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer hover:border-accent transition-colors"
            onClick={() => !isUploading && inputRef.current?.click()}
          >
            <FileAudio size={40} className="text-muted-foreground" />
            <div className="text-center">
              <p className="font-medium">{file ? file.name : 'WAV 파일을 선택하세요'}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {file
                  ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
                  : '클릭하거나 파일을 드롭하세요 (최대 300 MB)'}
              </p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".wav,audio/wav,audio/wave,audio/x-wav"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {errorMsg && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2.5">
              {errorMsg}
            </p>
          )}

          {status === 'done' && (
            <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 rounded-lg px-4 py-2.5">
              <CheckCircle2 size={16} />
              <span>완료 — 회의록 페이지로 이동 중…</span>
            </div>
          )}

          <button
            type="submit"
            disabled={!file || isUploading || status === 'done'}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-accent text-accent-foreground font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {isUploading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                화자분리 처리 중…
              </>
            ) : (
              <>
                <Upload size={16} />
                회의 시뮬레이션 시작
              </>
            )}
          </button>
        </form>

        {/* 안내 */}
        <div className="mt-8 rounded-xl bg-muted/50 px-5 py-4 text-sm text-muted-foreground space-y-1.5">
          <p className="font-medium text-foreground">동작 방식</p>
          <p>1. 회의 상태를 진행 중(in_progress)으로 전환합니다.</p>
          <p>2. WAV 파일을 ASR 서버에 업로드해 화자분리를 실행합니다.</p>
          <p>3. ASR 서버가 발화·화자 데이터를 저장합니다.</p>
          <p>4. 회의 상태를 완료(done)로 전환하고 회의록 페이지로 이동합니다.</p>
        </div>
      </div>
    </div>
  )
}
