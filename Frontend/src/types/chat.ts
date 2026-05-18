export type ChatRole = 'user' | 'assistant'

export interface WebSource {
  title: string
  url: string
  snippet: string
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  timestamp: string
  sources?: WebSource[]
  function_type?: string
}
