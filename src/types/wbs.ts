export type WbsStatus = 'todo' | 'inprogress' | 'done' | 'blocked'
export type WbsPriority = 'urgent' | 'high' | 'medium' | 'low'

export interface WbsTask {
  id: string
  epicId?: string
  title: string
  description?: string
  assigneeId?: string
  assigneeName?: string
  priority: WbsPriority
  urgency?: string
  status: WbsStatus
  dueDate?: string
  progress: number
  orderIndex: number
  jiraIssueId?: string
}

export interface WbsEpic {
  id: string
  title: string
  orderIndex: number
  tasks: WbsTask[]
  progress: number
}
