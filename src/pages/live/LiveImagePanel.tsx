import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Image as ImageIcon, UploadCloud } from 'lucide-react'
import { uploadMinutePhoto, type MinutePhoto } from '../../api/meetings'

interface Props {
  workspaceId: number
  meetingId: number
  camOn: boolean
  stream: MediaStream | null
  cameraError?: string
}

type CaptureItem = {
  localUrl: string
  photo: MinutePhoto
}

const MAX_CAPTURES = 30

export default function LiveImagePanel({ workspaceId, meetingId, camOn, stream, cameraError }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [uploading, setUploading] = useState(false)
  const [captures, setCaptures] = useState<CaptureItem[]>([])
  const [error, setError] = useState<string | null>(null)

  const canPreview = camOn && Boolean(stream)

  useEffect(() => {
    if (!videoRef.current) return
    videoRef.current.srcObject = stream
    if (stream) {
      void videoRef.current.play().catch(() => undefined)
    }
  }, [stream])

  useEffect(() => {
    return () => {
      captures.forEach((c) => URL.revokeObjectURL(c.localUrl))
    }
  }, [captures])

  const statusText = useMemo(() => {
    if (!camOn) return '웹캠이 꺼져 있습니다.'
    if (cameraError) return `웹캠 오류: ${cameraError}`
    if (!stream) return '웹캠을 켜는 중입니다...'
    return '웹캠이 켜져 있습니다.'
  }, [camOn, cameraError, stream])

  async function handleCapture() {
    setError(null)
    if (!camOn) {
      setError('웹캠이 꺼져 있습니다. 상단의 카메라 버튼으로 켜주세요.')
      return
    }
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) {
      setError('웹캠 화면이 준비되지 않았습니다.')
      return
    }

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)

    setUploading(true)
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (!b) reject(new Error('캡처에 실패했습니다.'))
          else resolve(b)
        }, 'image/png')
      })

      const saved = await uploadMinutePhoto(workspaceId, meetingId, blob)
      const localUrl = URL.createObjectURL(blob)
      setCaptures((prev) => {
        const next: CaptureItem[] = [{ localUrl, photo: saved }, ...prev]
        if (next.length <= MAX_CAPTURES) return next

        // drop overflow items + cleanup URLs
        const overflow = next.slice(MAX_CAPTURES)
        overflow.forEach((c) => URL.revokeObjectURL(c.localUrl))
        return next.slice(0, MAX_CAPTURES)
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <ImageIcon size={16} className="text-accent" aria-hidden="true" />
        <p className="text-sm font-semibold text-foreground">이미지</p>
      </div>

      <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
        <div className="px-3 py-2 border-b border-border bg-card">
          <p className="text-mini text-muted-foreground">{statusText}</p>
        </div>

        <div className="aspect-video bg-black/10 flex items-center justify-center overflow-hidden relative">
          {canPreview ? (
            <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 p-4 text-center">
              <Camera size={28} className="text-muted-foreground/30" />
              <p className="text-mini text-muted-foreground">
                {camOn ? '웹캠 스트림을 가져오지 못했습니다.' : '상단의 카메라 버튼을 눌러 웹캠을 켜주세요.'}
              </p>
            </div>
          )}
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-mini text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleCapture()}
          disabled={!camOn || uploading}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Camera size={14} />
          {uploading ? '캡처 저장 중...' : '캡처'}
        </button>

        {captures[0]?.photo && (
          <span className="text-mini text-muted-foreground inline-flex items-center gap-1">
            <UploadCloud size={12} className="text-muted-foreground" />
            저장됨
          </span>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden flex flex-col min-h-0">
        <div className="px-3 py-2 border-b border-border">
          <p className="text-mini font-medium text-foreground">
            캡처 목록 {captures.length > 0 ? `(${captures.length})` : ''}
          </p>
          <p className="text-micro text-muted-foreground mt-0.5">
            새로 캡처할수록 위에 추가됩니다. 최대 {MAX_CAPTURES}장까지 보관합니다.
          </p>
        </div>

        <div className="max-h-72 overflow-y-auto">
          {captures.length === 0 ? (
            <div className="px-3 py-6 text-center text-mini text-muted-foreground">
              아직 캡처된 이미지가 없습니다.
            </div>
          ) : (
            <div className="flex flex-col">
              {captures.map((c) => (
                <div key={c.photo.id} className="border-t border-border first:border-t-0">
                  <img src={c.localUrl} alt={`캡처 ${c.photo.id}`} className="w-full h-auto block" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

