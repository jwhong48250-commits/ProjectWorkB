import type { ChatMessage } from '../types/chat'

export const GLOBAL_CHAT_MESSAGES: ChatMessage[] = [
  {
    id: 'c1',
    role: 'assistant',
    content: '안녕하세요! Workb AI 도우미입니다. 회의 내용 요약, 자료 검색, 일정 등록 등을 도와드릴게요.',
    timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  },
  {
    id: 'c2',
    role: 'user',
    content: '지난주 스프린트 플래닝에서 결정된 사항 알려줘.',
    timestamp: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
  },
  {
    id: 'c3',
    role: 'assistant',
    content: '스프린트 플래닝 #12 (4월 4일)에서 결정된 사항입니다:\n\n1. STT 연동 에픽 최우선 진행\n2. 총 23개 태스크 배정 완료\n3. 보고서 자동화는 Q3로 이관\n\n자세한 내용은 회의록 상세 페이지에서 확인하실 수 있어요.',
    timestamp: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
  },
  {
    id: 'c4',
    role: 'user',
    content: '다음 회의 언제야?',
    timestamp: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  },
  {
    id: 'c5',
    role: 'assistant',
    content: '다음 예정 회의는 **백엔드 API 설계 논의**입니다.\n\n📅 오늘 오후 4:00 (약 2시간 후)\n👥 김수민, 박준혁, 정민준\n\n캘린더에 등록되어 있습니다.',
    timestamp: new Date(Date.now() - 1 * 60 * 1000).toISOString(),
  },
]

export const HISTORY_CHAT_MESSAGES: ChatMessage[] = [
  {
    id: 'h1',
    role: 'assistant',
    content: '과거 회의 내용에 대해 질문해보세요. 예: "지난 달 투자 관련 회의에서 결정된 사항은?"',
    timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  },
  {
    id: 'h2',
    role: 'user',
    content: '투자자 미팅에서 IR 덱 관련해서 뭐가 결정됐어?',
    timestamp: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
  },
  {
    id: 'h3',
    role: 'assistant',
    content: '**투자자 미팅 준비** (4월 6일) 회의에서 IR 덱 관련 결정 사항:\n\n• IR 덱 최종 검토 완료\n• 핵심 지표 슬라이드 업데이트 필요 → 정민준님 담당 (내일까지)\n• 데모 시나리오 확정\n\n회의록 전문을 보려면 해당 회의를 클릭해보세요.',
    timestamp: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
  },
]
