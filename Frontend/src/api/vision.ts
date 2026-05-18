import { apiRequest  } from "./client";

// 단일 화면 캡처 분석 결과
export interface ScreenAnalysis{
    meeting_id: number
    ocr_text: string    // 화면에서 추출한 텍스트
    chart_description: string // 차트 설명 (차트 없으면 빈 문자열)
    key_points: string[]    // 핵심 포인트 목록
    timestamp: string       // 분석 시각 ISO 문자열
}

// PPT 슬라이드 단건 결과
export interface PptSlideResult {
    slide_number: number
    ocr_text: string
    chart_description: string
    key_points: string[]
    summary: string         // 슬라이드 요약 (화면 캡처 분석엔 없고 PPT 전용)
}

export interface PptUploadResponse {
    meeting_id: number
    totla_slides: number
    slides: PptSlideResult[]
}

// 화면 캡처 이미지 -> 분석 API
// file: canvas.toBlob()으로 만든 Blob을 FormData에 담아 전송
// relatedUtteranceSeq: 캡처 시점의 발화 인덱스 (없으면 전체 발화 fallback)
export async function analyzeScreen(
    workspaceId: number,
    meetingId:number,
    imageBlob: Blob,
    relatedUtteranceSeq?: number,
): Promise<ScreenAnalysis> {
    const form = new FormData()
    form.append('file', imageBlob, 'capture.png')
    if (relatedUtteranceSeq !== undefined) {
        form.append(`related_utterance_seq`, String(relatedUtteranceSeq))
    }
    // meeting_id는 query param으로 전달 (router.py 참고: Form이 아닌 query)
    return apiRequest<ScreenAnalysis>(
        `/visions/workspace/${workspaceId}/screen-share/analyze?meeting_id=${meetingId}`,
        { method: 'POST', body: form },
    )
}

// 특정 회의의 분석 결과 전체 조회 - 페이지 마운트 시 기존 결과 복원용
export async function getAnalyses(
    workspaceId: number,
    meetingId: number,
): Promise<{ meeting_id: number; analyses: ScreenAnalysis[] }> {
    return apiRequest(
        `/visions/workspace/${workspaceId}/screen-share/analyses?meeting_id=${meetingId}`,
    )
}

// PPT 파일 업로드 -> 슬라이드별 분석
// file: <input type='file'>에서 받은 File 객체
export async function uploadPpt(
    workspaceId: number,
    meetingId: number,
    file: File,
): Promise<PptUploadResponse> {
    const form = new FormData()
    form.append('file', file)
    return apiRequest<PptUploadResponse>(
        `/visions/workspace/${workspaceId}/screen-share/upload-ppt?meeting_id=${meetingId}`,
        { method: 'POST', body: form },
    )
}