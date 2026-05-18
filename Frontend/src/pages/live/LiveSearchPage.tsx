import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Search, Globe, Database, History, ArrowLeft, ExternalLink } from 'lucide-react'
import clsx from 'clsx'

type Source = 'all' | 'web' | 'db' | 'history'

const MOCK_RESULTS = [
  {
    id: 'r1',
    source: 'internet' as Source,
    title: 'Redis Streams 공식 문서',
    snippet: 'Redis Streams는 append-only log 자료구조로 실시간 데이터 처리에 최적화...',
    url: 'https://redis.io/docs/data-types/streams/',
  },
  {
    id: 'r2',
    source: 'internal_db' as Source,
    title: '[내부] STT API 설계 문서 v2',
    snippet: '화자 분리 모델 연동 스펙 및 Redis 저장 포맷 정의. 컬럼: 화자 ID / 발언 시각 / 발언 내용',
    url: '',
  },
  {
    id: 'r3',
    source: 'past_meeting' as Source,
    title: '스프린트 플래닝 #12 — Redis 스키마 논의',
    snippet: 'STT 전문을 Redis Streams에 저장하는 방식으로 결정. 보존 기간 7일 설정.',
    url: '',
  },
]

export default function LiveSearchPage() {
  const { meetingId } = useParams()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<Source>('all')
  const [searched, setSearched] = useState(false)

  const filtered = MOCK_RESULTS.filter((r) => source === 'all' || r.source === source)

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    // TODO: search across web, DB, meeting history
    console.log('TODO: search', { query, source })
    setSearched(true)
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-center gap-2 mb-5">
        <button onClick={() => navigate(`/live/${meetingId}`)} className="text-muted-foreground hover:text-foreground transition-colors" aria-label="뒤로">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-semibold text-foreground">즉석 자료 검색</h1>
          <p className="text-sm text-muted-foreground">회의 중 궁금한 내용을 바로 검색하세요.</p>
        </div>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2 mb-4">
        <div className="flex items-center gap-2 flex-1 h-10 px-3 rounded-lg border border-border bg-card">
          <Search size={14} className="text-muted-foreground shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="자연어로 검색... 예: Redis Streams 저장 방식"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
            autoFocus
          />
        </div>
        <button type="submit" className="h-10 px-4 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors">
          검색
        </button>
      </form>

      {/* Source filter */}
      <div className="flex gap-2 mb-5">
        {([
          { id: 'all', label: '전체', icon: Search },
          { id: 'web', label: '인터넷', icon: Globe },
          { id: 'db', label: '회사 DB', icon: Database },
          { id: 'history', label: '과거 회의', icon: History },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setSource(id)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors',
              source === id ? 'border-accent bg-accent-subtle text-accent' : 'border-border text-muted-foreground hover:border-foreground',
            )}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {searched && (
        <div className="flex flex-col gap-3">
          {filtered.map((result) => (
            <div key={result.id} className="p-3 rounded-lg border border-border bg-card">
              <div className="flex items-start justify-between gap-2 mb-1">
                <h3 className="text-sm font-medium text-foreground">{result.title}</h3>
                <span className={clsx(
                  'px-1.5 py-0.5 rounded text-micro font-medium shrink-0',
                  result.source === 'web' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' :
                  result.source === 'db' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' :
                  'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
                )}>
                  {result.source === 'web' ? '인터넷' : result.source === 'db' ? '회사 DB' : '과거 회의'}
                </span>
              </div>
              <p className="text-mini text-muted-foreground mb-2">{result.snippet}</p>
              {result.url && (
                <a
                  href="#"
                  onClick={(e) => e.preventDefault()}
                  className="flex items-center gap-1 text-mini text-accent hover:underline"
                >
                  <ExternalLink size={11} /> 원문 보기
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {!searched && (
        <div className="flex flex-col items-center justify-center py-16 gap-2">
          <Search size={32} className="text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">검색어를 입력하면 인터넷, 회사 DB, 과거 회의를 통합 검색합니다.</p>
        </div>
      )}
    </div>
  )
}
