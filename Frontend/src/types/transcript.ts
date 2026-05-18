export interface Utterance {
  id: string
  speakerId: string
  speakerName: string
  speakerColor: string
  startTime: number // seconds from meeting start
  text: string
  isDecision?: boolean
  isActionItem?: boolean
}

export interface TranscriptSegment {
  meetingId: string
  utterances: Utterance[]
}
