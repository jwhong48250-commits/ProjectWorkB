import type { AgendaItem } from '../types/agenda'

export const AGENDA_M1: AgendaItem[] = [
  {
    id: 'ag1',
    order: 1,
    title: 'Q1 회고',
    presenter: '이지현',
    durationMin: 20,
    note: 'KPI 달성 현황 공유',
  },
  {
    id: 'ag2',
    order: 2,
    title: 'Q2 목표 설정',
    presenter: '김수민',
    durationMin: 30,
    attachments: ['Q2_OKR_초안.pdf'],
  },
  {
    id: 'ag3',
    order: 3,
    title: '리소스 배분',
    presenter: '박준혁',
    durationMin: 20,
    note: '팀별 에픽 배분 검토',
  },
]

export const AGENDA_M2: AgendaItem[] = [
  {
    id: 'ag4',
    order: 1,
    title: '인증 엔드포인트 설계',
    presenter: '박준혁',
    durationMin: 25,
  },
  {
    id: 'ag5',
    order: 2,
    title: 'STT 연동 API 스펙',
    presenter: '정민준',
    durationMin: 30,
  },
  {
    id: 'ag6',
    order: 3,
    title: 'Redis 스키마 검토',
    presenter: '박준혁',
    durationMin: 15,
  },
]
