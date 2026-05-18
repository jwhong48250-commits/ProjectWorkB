export interface AgendaItem {
  id: string
  order: number
  title: string
  presenter?: string
  durationMin: number
  attachments?: string[]
  note?: string
}
