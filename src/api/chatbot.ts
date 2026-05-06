import { apiRequest } from './client'
import type { WebSource} from '../types/chat'

export interface SendMessageResponse {
    session_id: string
    function_type: string
    answer: string
    result: { sources?: WebSource[]; action_button?: string | null }
    timestamp: string
}

export interface HistoryMessage {
    role: 'user' | 'assistant'
    content: string
    function_type: string
    timestamp: string
}

export interface HistoryResponse {
    messages: HistoryMessage[]
}

export interface PastMeeting {
    meeting_id: number
    title: string
    created_at: string
}

export interface PastMeetingsResponse {
    meetings: PastMeeting[]
    total: number
}

export interface DocumentAnalysis {
    filename: string
    title: string
    summary: string
    key_points: string[]
    timestmap: string
}

// 메시지 전송
// sessionId 없으면 서버가 새 UUID 발급 -> 응답의 session_id를 sessionStorage에 저장해야 함
export async function sendChatMessage(
    workspaceId: number,
    message: string,
    meetingId: number | null,
    sessionId: string | null,
    pastMeetingIds: number[] | null = null,
): Promise<SendMessageResponse> {
    const params = sessionId ? `session_id=${sessionId}` : ''
    return apiRequest<SendMessageResponse> (
        `/knowledges/workspace/${workspaceId}/chatbot/message?${params}`,
        {
            method: 'POST',
            body: JSON.stringify({
                message,
                meeting_id: meetingId ?? undefined,
                past_meeting_ids: pastMeetingIds ?? undefined,
            }),
        },
    )
}

// 대화 히스토리 조회 - 탭 새로 열 때 이전 대화 복원용
export async function getChatHistory(
    workspaceId: number,
    sessionId: string,
): Promise<HistoryResponse>{
    return apiRequest<HistoryResponse> (
        `/knowledges/workspace/${workspaceId}/chatbot/history?session_id=${sessionId}`,
    )
}

// 이전 회의 목록 조회 - ChatFAB 열릴 때 호출해서 선택 UI에 사용
export async function getPastMeetings(
    workspaceId: number,
): Promise<PastMeetingsResponse> {
    return apiRequest<PastMeetingsResponse> (
        `/knowledges/workspace/${workspaceId}/past_meetings`,
    )
}

export interface ChatSession {
    session_id: string
    created_at: string
    title: string | null
    preview: string
}

export async function createChatSession(workspaceId: number): Promise<{ session_id: string }> {
    return apiRequest(`/knowledges/workspace/${workspaceId}/chatbot/sessions`, { method: 'POST' })
}

export async function listChatSessions(workspaceId: number): Promise<{ sessions: ChatSession[] }> {
    return apiRequest(`/knowledges/workspace/${workspaceId}/chatbot/sessions`)
}

export async function renameChatSession(workspaceId: number, sessionId: string, title: string): Promise<void> {
    await apiRequest(`/knowledges/workspace/${workspaceId}/chatbot/sessions/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
    })
}

export async function deleteChatSession(workspaceId: number, sessionId: string): Promise<void> {
    await apiRequest(`/knowledges/workspace/${workspaceId}/chatbot/sessions/${sessionId}`, { method: 'DELETE' })
}

export async function uploadDocument(workspaceId: number, file: File): Promise<void> {
    const form = new FormData()
    form.append('file', file)
    await apiRequest(`/knowledges/workspaces/${workspaceId}/documents`, {
        method: 'POST',
        body: form,
    })
}

export async function analyzeDocument(workspaceId: number, file: File): Promise<DocumentAnalysis> {
    const form = new FormData()
    form.append('file', file)
    return apiRequest<DocumentAnalysis>(
        `/knowledges/workspace/${workspaceId}/documents/analyze`,
        { method: 'POST', body: form }
    )
}

export async function generateQuickReport(
    workspaceId: number,
    meetingId: number,
): Promise<void> {
    await apiRequest(
        `/knowledges/workspace/${workspaceId}/chatbot/quick_report`,
        {
            method: 'POST',
            body: JSON.stringify({ meeting_id: meetingId }),
        },
    )
}
