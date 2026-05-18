import { HelpCircle, BookOpen, MessageCircle, Mail, ChevronRight } from 'lucide-react'

const SUPPORT_ITEMS = [
  {
    icon: BookOpen,
    title: '사용 가이드',
    desc: 'Workb의 기능과 사용 방법을 단계별로 안내합니다.',
    action: '가이드 보기',
  },
  {
    icon: MessageCircle,
    title: '자주 묻는 질문 (FAQ)',
    desc: '자주 접수되는 질문과 해결 방법을 확인하세요.',
    action: 'FAQ 보기',
  },
  {
    icon: Mail,
    title: '이메일 문의',
    desc: '지원팀에 직접 문의를 보내면 빠르게 도와드립니다.',
    action: '문의하기',
  },
] as const

export default function SupportPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
      {/* 페이지 헤더 */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <HelpCircle size={20} className="text-accent" />
          <h1 className="text-xl font-semibold text-foreground">고객지원</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Workb 사용 중 도움이 필요하신가요? 아래 지원 채널을 통해 문의해 주세요.
        </p>
      </div>

      {/* 지원 채널 목록 */}
      <div className="flex flex-col gap-3 mb-8">
        {SUPPORT_ITEMS.map(({ icon: Icon, title, desc, action }) => (
          <div
            key={title}
            role="button"
            tabIndex={0}
            className="flex items-center gap-4 p-4 rounded-lg border border-border bg-card hover:border-accent/40 cursor-pointer group transition-colors"
            onClick={() => console.log(`TODO: ${action}`)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                console.log(`TODO: ${action}`)
              }
            }}
          >
            <div className="w-10 h-10 rounded-lg bg-accent-subtle flex items-center justify-center shrink-0">
              <Icon size={18} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
            </div>
            <ChevronRight
              size={16}
              className="text-muted-foreground group-hover:text-accent transition-colors shrink-0"
            />
          </div>
        ))}
      </div>

      {/* 운영 시간 안내 */}
      <div className="p-4 rounded-lg border border-border bg-muted/20">
        <p className="text-sm font-medium text-foreground mb-2">운영 시간</p>
        <p className="text-xs text-muted-foreground">
          평일 오전 9시 ~ 오후 6시 (한국 표준시, KST)
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          이메일 문의는 영업일 기준 1~2일 이내 답변 드립니다.
        </p>
      </div>
    </div>
  )
}
