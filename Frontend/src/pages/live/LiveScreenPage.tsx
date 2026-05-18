import { useState, useEffect, useRef } from 'react'
import { Monitor, Sparkles, FileText, BarChart2, Upload, StopCircle, Camera } from 'lucide-react'
import { getCurrentWorkspaceId } from '../../api/client'
import { analyzeScreen, getAnalyses, uploadPpt } from '../../api/vision'
import type { ScreenAnalysis, PptSlideResult } from '../../api/vision'
import { analyzeDocument } from '../../api/chatbot'
import type { DocumentAnalysis } from '../../api/chatbot'

// 화면 캡처 결과와 PPT 슬라이드 결과를 통합 리스트로 표시
type AnalysisItem =
    | { kind: 'screen'; data: ScreenAnalysis }
    | { kind: 'slide'; data: PptSlideResult & { timestamp: string } }
    | { kind: 'document'; data: DocumentAnalysis}

interface Props {
  meetingId: number
  // LivePage 패널 안에 들어갈 때는 compact, LiveScreenPage 단독일 때는 full
  compact?: boolean
}

export default function LiveScreenPage({ meetingId, compact = false }: Props) {
    const workspaceId = getCurrentWorkspaceId()

    const [items, setItems] = useState<AnalysisItem[]>([])
    const [isSharing, setIsSharing] = useState(false)
    const [isAnalyzing, setIsAnalyzing] = useState(false) // 수동 캡처 분석 중
    const [pptLoading, setPptLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [docLoading, setDocLoading] = useState(false)

    // 화면 공유 스트림 ref — 리렌더링 없이 cleanup
    const streamRef = useRef<MediaStream | null>(null)
    const videoRef = useRef<HTMLVideoElement>(null)   // 미리보기용
    const canvasRef = useRef<HTMLCanvasElement>(null) // 캡처용 offscreen canvas

    // 마운트 시 기존 분석 결과 복원
    useEffect(() => {
        getAnalyses(workspaceId, meetingId)
            .then(({ analyses }) =>
                setItems(analyses.map((d) => ({ kind: 'screen', data: d })))
            )
            .catch(() => {})
    }, [meetingId]) // eslint-disable-line react-hooks/exhaustive-deps

    // 언마운트 시 스트림 정리
    useEffect(() => () => stopSharing(), [])

    async function startSharing() {
        setError(null)
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true })
            streamRef.current = stream
            if (videoRef.current) {
                videoRef.current.srcObject = stream
                await videoRef.current.play()
            }
            setIsSharing(true)
            // 브라우저 공유 중지 버튼 누를 때도 상태 동기화
            stream.getVideoTracks()[0].addEventListener('ended', stopSharing)
        } catch (e: unknown) {
            // 사용자가 다이얼로그 취소한 경우는 에러 표시 안 함
            if (e instanceof Error && e.name !== 'NotAllowedError') {
                setError('화면 공유를 시작할 수 없습니다.')
            }
        }
    }

    function stopSharing() {
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        setIsSharing(false)
    }

    // 수동 캡처 → 현재 video 프레임을 canvas에 그려 Blob 변환 → analyzeScreen API
    async function handleCapture() {
        const video = videoRef.current
        const canvas = canvasRef.current
        if (!video || !canvas || video.readyState < 2) return

        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        canvas.getContext('2d')!.drawImage(video, 0, 0)

        canvas.toBlob(async (blob) => {
            if (!blob) return
            setIsAnalyzing(true)
            try {
                const result = await analyzeScreen(workspaceId, meetingId, blob)
                // 최신 캡처를 리스트 맨 앞에 추가
                setItems((prev) => [{ kind: 'screen', data: result }, ...prev])
            } catch {
                setError('화면 분석 중 오류가 발생했습니다.')
            } finally {
                setIsAnalyzing(false)
            }
        }, 'image/png')
    }

    // PPT 업로드 → 슬라이드별 분석 결과를 기존 캡처 결과와 함께 리스트에 추가
    // 사용자가 화면에 노출된 PPT를 직접 업로드하면 캡처 결과와 대조 가능
    async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return
        e.target.value = '' // 같은 파일 재업로드 허용

        const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
        const isImage = ['png', 'jpg', 'jpeg', 'webp'].includes(ext)
        const isPpt = ['ppt', 'pptx'].includes(ext)

        if (isImage) {
          setIsAnalyzing(true)
          setError(null)
          try {
            const blob = new Blob([await file.arrayBuffer()], { type: file.type })
            const result = await analyzeScreen(workspaceId, meetingId, blob)
            setItems((prev) => [{ kind: 'screen', data: result }, ...prev])
          } catch {
            setError('이미지 분석 중 오류가 발생했습니다.')
          } finally {
            setIsAnalyzing(false)
          }
        } else if (isPpt) {
          setPptLoading(true)
          setError(null)
          try {
              const { slides } = await uploadPpt(workspaceId, meetingId, file)
              const now = new Date().toISOString()
              setItems((prev) => [                                                                                     
                  ...slides.map((s): AnalysisItem => ({
                      kind: 'slide',                                                                                   
                      data: { ...s, timestamp: now },                                                                
                  })),
                  ...prev,                                                                                             
              ])
          } catch {
              setError('PPT 분석 중 오류가 발생했습니다.')
          } finally {
              setPptLoading(false)
          }
        } else {
          // pdf, docx, xlsx 등 → LLM 요약 + 백그라운드 ChromaDB 인제스트
          setDocLoading(true)
          setError(null)
          try {
            const result = await analyzeDocument(workspaceId, file)
            setItems((prev) => [{ kind: 'document', data: result }, ...prev])
          } catch {
            setError('문서 분석 중 오류가 발생했습니다.')
          } finally {
            setDocLoading(false)
          }
        }
    }

    // compact 모드(LivePage 패널)와 full 모드(LiveScreenPage)의 크기 차이                                           
    const previewAspect = compact ? 'aspect-video' : 'aspect-video'
    const iconSize = compact ? 20 : 36                                                                               
    const btnSize = compact ? 'px-2.5 py-1.5 text-mini' : 'px-4 py-2 text-sm'

    return (                                                                                                       
      <div className="flex flex-col h-full">                                                                       
          {/* 화면 공유 미리보기 */}                                                                               
          <div className={`rounded-lg border-2 border-dashed border-border bg-muted/20 ${previewAspect} flex 
flex-col items-center justify-center mb-3 overflow-hidden relative shrink-0`}>                                       
              {/* video는 항상 DOM에 존재 — startSharing() 시 srcObject 설정 후 visible */}                      
              <video                                                                                               
                  ref={videoRef}                                                                                 
                  className={`w-full h-full object-contain ${isSharing ? 'block' : 'hidden'}`}                     
                  muted                                                                                            
                  playsInline                                                                                      
              />                                                                                                   
              {!isSharing && (
                  <>
                      <Monitor size={iconSize} className="text-muted-foreground/30" />
                      <p className={`${compact ? 'text-mini' : 'text-sm'} text-muted-foreground`}>
                          화면 공유 미리보기
                      </p>
                      <button
                        onClick={startSharing}
                        className={`mt-1 flex items-center gap-1 ${btnSize} rounded-lg bg-accent text-accent-foreground font-medium hover:bg-accent/90 transition-colors`}
                    >
                        <Monitor size={compact ? 12 : 15} />
                        화면 공유 시작
                      </button>
                  </>
              )}
              {isAnalyzing && (                                                                                  
                  <div className="absolute inset-0 bg-black/30 flex items-center justify-center">                  
                      <span className="text-white text-sm font-medium">분석 중...</span>
                  </div>                                                                                           
              )}                                                                                                 
          </div>                                                                                                   
                                                                                                                 
          {/* offscreen canvas */}
          <canvas ref={canvasRef} className="hidden" />
                                                                                                                   
          {/* 컨트롤 버튼 */}
          <div className="flex flex-wrap gap-1.5 mb-3 shrink-0">                                                  
              {isSharing && (                                                                                       
                  <button
                      onClick={stopSharing}                                                                        
                      className={`flex items-center gap-1 ${btnSize} rounded-lg bg-destructive text-destructive-foreground font-medium hover:bg-destructive/90 transition-colors`}>                                                                                                
                      <StopCircle size={compact ? 12 : 15} />                                                      
                      공유 중지                                                                                  
                  </button>
              )}
                 
              {/* 캡처 — 공유 중일 때만 활성화 */}                                                                 
              <button
                  onClick={handleCapture}                                                                          
                  disabled={!isSharing || isAnalyzing}                                                           
                  className={`flex items-center gap-1 ${btnSize} rounded-lg border border-border font-medium hover:bg-muted/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed`}                                
              >
                  <Camera size={compact ? 12 : 15} />                                                              
                  캡처                                                                                           
              </button>

              {/* 업로드 */}
              <label className={`flex items-center gap-1 ${btnSize} rounded-lg border border-border font-medium hover:bg-muted/60 transition-colors cursor-pointer`}>                                                                
                  <Upload size={compact ? 12 : 15} />
                  {pptLoading || isAnalyzing || docLoading ? '처리 중...' : '파일'}                                                              
                  <input                                                                                           
                      type="file"
                      accept=".pptx,.ppt,.png,.jpg,.jpeg,.webp,.pdf,.docx,.doc,.xlsx,.xls,.html,.htm,.md"                                                                          
                      className="hidden"                                                                           
                      onChange={handleFileUpload}
                      disabled={pptLoading || isAnalyzing || docLoading}                                                                        
                  />                                                                                             
              </label>
          </div>

          {error && <p className={`${compact ? 'text-micro' : 'text-sm'} text-destructive mb-2 shrink-0`}>{error}</p>}
                                                                                                                   
          {/* 분석 결과 목록 */}                                                                                 
          <div className="flex items-center gap-1.5 mb-2 shrink-0">
              <Sparkles size={compact ? 11 : 14} className="text-accent" />                                        
              <span className={`${compact ? 'text-mini' : 'text-sm'} font-medium text-foreground`}>AI 분석 결과</span>                                                                                                          
              <span className={`${compact ? 'text-micro' : 'text-mini'} text-muted-foreground`}>{items.length}개</span>                                                                      
          </div>                                                                                                 
                                                                                                                   
          <div className="flex-1 overflow-y-auto flex flex-col gap-2 min-h-0">                                     
              {items.map((item, idx) => {
                  if (item.kind === 'document') {
                    const d = item.data
                    const time = new Date(d.timestmap).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit'})
                    return (
                      <div key={idx} className="p-2.5 rounded-lg border border-border bg-background shrink-0">
                      <div className="flex items-start gap-2 mb-1.5">                                                      
                          <div className="w-6 h-6 rounded bg-accent-subtle flex items-center justify-center shrink-0">   
                              <FileText size={12} className="text-accent" />                                               
                          </div>                                                                                           
                          <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-1">                                    
                                  <p className="text-mini font-medium text-foreground truncate">{d.title}</p>            
                                  <span className="text-micro text-muted-foreground shrink-0">{time}</span>                
                              </div>
                              <p className="text-micro text-muted-foreground mt-0.5 line-clamp-3">{d.summary}</p>          
                          </div>                                                                                           
                      </div>
                      {d.key_points.length > 0 && (                                                                        
                          <div className="flex flex-col gap-0.5 pt-1.5 border-t border-border">                          
                              {d.key_points.map((pt, i) => (                                                               
                                  <div key={i} className="flex items-center gap-1">
                                      <Sparkles size={10} className="text-accent" />                                       
                                      <span className="text-micro text-accent">{pt}</span>                                 
                                  </div>
                              ))}                                                                                          
                          </div>                                                                                         
                      )}
                      </div>
                    )
                  }
                  const isSlide = item.kind === 'slide'                                                            
                  const label = isSlide                                                                          
                      ? `슬라이드 ${(item.data as PptSlideResult).slide_number}`                                   
                      : '화면 캡처'
                  const time = new Date(item.data.timestamp).toLocaleTimeString('ko-KR', {                         
                      hour: '2-digit', minute: '2-digit',                                                        
                  })                                                                                               
                  const { ocr_text, chart_description, key_points } = item.data                                    
                                                                                                                   
                  return (                                                                                         
                      <div key={idx} className="p-2.5 rounded-lg border border-border bg-background shrink-0">     
                          <div className="flex items-start gap-2 mb-1.5">                                        
                              <div className="w-6 h-6 rounded bg-accent-subtle flex items-center justify-center shrink-0">                                                                                                           
                                  {chart_description
                                      ? <BarChart2 size={12} className="text-accent" />                            
                                      : <FileText size={12} className="text-accent" />                           
                                  }                                                                                
                              </div>
                              <div className="flex-1 min-w-0">                                                     
                                  <div className="flex items-center justify-between gap-1">                      
                                      <p className="text-mini font-medium text-foreground truncate">{label}</p>    
                                      <span className="text-micro text-muted-foreground shrink-0">{time}</span>
                                  </div>                                                                           
                                  {isSlide && (item.data as PptSlideResult).summary && (                         
                                      <p className="text-micro text-muted-foreground mt-0.5">                      
                                          {(item.data as PptSlideResult).summary}                                  
                                      </p>                                                                         
                                  )}                                                                               
                                  {ocr_text && (                                                                 
                                      <p className="text-micro text-muted-foreground mt-0.5 whitespace-pre-line line-clamp-2">                                                                                                       
                                          {ocr_text}
                                      </p>                                                                         
                                  )}                                                                             
                              </div>
                          </div>                                                                                   
                          {chart_description && (
                              <p className="text-micro text-foreground/70 mb-1">{chart_description}</p>            
                          )}                                                                                       
                          {key_points.length > 0 && (
                              <div className="flex flex-col gap-0.5 pt-1.5 border-t border-border">                
                                  {key_points.map((pt, i) => (                                                     
                                      <div key={i} className="flex items-center gap-1">
                                          <Sparkles size={10} className="text-accent" />                           
                                          <span className="text-micro text-accent">{pt}</span>                   
                                      </div>                                                                       
                                  ))}                                                                            
                              </div>                                                                               
                          )}
                      </div>                                                                                       
                  )                                                                                              
              })}
          </div>
      </div>
  )
}
