import type { Integration } from '../types/integrations'

export const INTEGRATIONS: Integration[] = [
  {
    id: 1,
    service: 'jira',
    is_connected: true,
    updated_at: new Date().toISOString(),
    name: 'JIRA',
    description: '이슈 자동 생성 및 WBS 매핑',
    icon: '🔵',
  },
  {
    id: 2,
    service: 'slack',
    is_connected: true,
    updated_at: new Date().toISOString(),
    name: 'Slack',
    description: '회의 요약 및 액션 아이템 알림',
    icon: '💬',
  },
  {
    id: 3,
    service: 'notion',
    is_connected: false,
    updated_at: new Date().toISOString(),
    name: 'Notion',
    description: '회의록 자동 내보내기',
    icon: '📝',
  },
  {
    id: 4,
    service: 'google_calendar',
    is_connected: true,
    updated_at: new Date().toISOString(),
    name: 'Google Calendar',
    description: '회의 일정 연동 및 자동 등록',
    icon: '📅',
  },
  {
    id: 5,
    service: 'kakao',
    is_connected: false,
    updated_at: new Date().toISOString(),
    name: '카카오톡 알림',
    description: '회의 요약·액션 아이템 알림 발송',
    icon: '💛',
  },
]
