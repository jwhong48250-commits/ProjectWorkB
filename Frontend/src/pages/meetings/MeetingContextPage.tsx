import { useState } from 'react'
import { Search, Calendar, Users, MessageSquare, Send, Sparkles } from 'lucide-react'
import { MEETINGS, PARTICIPANTS } from '../../data/mockData'
import { HISTORY_CHAT_MESSAGES } from '../../data/mockChatMessages'
import type { ChatMessage } from '../../types/chat'
import { useNavigate } from 'react-router-dom'

export default function MeetingContextPage() {
  const [query, setQuery] = useState('')
  const [chatInput, setChatInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>(HISTORY_CHAT_MESSAGES)
  const navigate = useNavigate()

  const completedMeetings = MEETINGS.filter((m) => m.status === 'completed')
  const filtered = completedMeetings.filter((m) =>
    query === '' || m.title.toLowerCase().includes(query.toLowerCase()) || m.tags.some((t) => t.includes(query))
  )

  function handleSend() {
    const text = chatInput.trim()
    if (!text) return
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg])
    setChatInput('')
    // TODO: AI query on meeting context
    console.log('TODO: query meeting context', text)
    setTimeout(() => {
      setMessages((prev) => [...prev, {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: '관련 회의 내용을 검색 중입니다... (TODO: AI 응답 연결)',
        timestamp: new Date().toISOString(),
      }])
    }, 600)
  }

  return (
    <div className="flex h-full">
      {/* Left: Meeting list */}
      <div className="flex-1 overflow-y-auto min-w-0">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={16} className="text-accent" />
              <h1 className="text-xl font-semibold text-foreground">이전 회의 열람 · 맥락 뷰</h1>
            </div>
            <p className="text-sm text-muted-foreground">키워드, 날짜, 참석자 기준으로 이전 회의를 검색하고 AI에게 질문하세요.</p>
          </div>

          {/* Search */}
          <div className="flex items-center gap-2 h-9 px-3 rounded-lg border border-border bg-card mb-4">
            <Search size={13} className="text-muted-foreground shrink-0" />
            <input
              type="search"
              placeholder="회의 제목, 태그, 키워드 검색..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
            />
          </div>

          {/* Filter chips */}
          <div className="flex flex-wrap gap-2 mb-5">
            <span className="text-mini text-muted-foreground flex items-center gap-1"><Calendar size={11} /> 최근 30일</span>
            <div className="flex flex-wrap gap-1">
              {PARTICIPANTS.slice(0, 3).map((p) => (
                <button key={p.id} className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-border text-mini text-muted-foreground hover:border-accent hover:text-accent transition-colors">
                  <Users size={10} /> {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Meeting list */}
          <div className="flex flex-col gap-3">
            {filtered.map((m) => (
              <div
                key={m.id}
                onClick={() => navigate(`/meetings/${m.id}/notes`)}
                className="p-4 rounded-lg border border-border bg-card cursor-pointer hover:border-accent/50 hover:bg-accent-subtle/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="text-sm font-medium text-foreground">{m.title}</h3>
                  <span className="text-mini text-muted-foreground shrink-0">
                    {new Date(m.startAt).toLocaleDateString('ko-KR')}
                  </span>
                </div>
                {m.summary && (
                  <p className="text-mini text-muted-foreground mb-2 line-clamp-2">{m.summary}</p>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  {m.tags.map((tag) => (
                    <span key={tag} className="px-1.5 py-0.5 rounded bg-muted text-micro text-muted-foreground">{tag}</span>
                  ))}
                  <span className="ml-auto text-mini text-muted-foreground">{m.participants.length}명 참석</span>
                </div>
              </div>
            ))}
          </div>

          {/* AI auto-link suggestion */}
          <div className="mt-5 p-3 rounded-lg border border-accent/20 bg-accent-subtle/30">
            <div className="flex items-center gap-1.5 mb-1">
              <Sparkles size={12} className="text-accent" />
              <span className="text-mini font-medium text-accent">AI 관련 회의 연결</span>
            </div>
            <p className="text-mini text-muted-foreground">
              현재 회의와 관련된 이전 회의: <span className="text-foreground font-medium">스프린트 플래닝 #12</span>, <span className="text-foreground font-medium">UI/UX 디자인 검토</span>
            </p>
          </div>
        </div>
      </div>

      {/* Right: Chatbot panel */}
      <aside className="hidden lg:flex flex-col w-80 shrink-0 border-l border-border">
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <MessageSquare size={15} className="text-accent" />
            <span className="text-sm font-medium text-foreground">과거 회의 질의 챗봇</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2.5">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] px-3 py-2 rounded-xl text-sm whitespace-pre-wrap ${msg.role === 'user' ? 'bg-accent text-accent-foreground rounded-br-sm' : 'bg-muted text-foreground rounded-bl-sm'}`}>
                {msg.content}
              </div>
            </div>
          ))}
        </div>
        <form
          className="flex items-center gap-2 px-3 py-2.5 border-t border-border"
          onSubmit={(e) => { e.preventDefault(); handleSend() }}
        >
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="과거 회의 내용 질문..."
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
          />
          <button type="submit" disabled={!chatInput.trim()} className="flex items-center justify-center w-7 h-7 rounded-full bg-accent text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed">
            <Send size={12} />
          </button>
        </form>
      </aside>
    </div>
  )
}
