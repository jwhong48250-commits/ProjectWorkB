import { apiRequest } from "./client";

export interface UtteranceItem {
  seq: number;
  speaker_id: number | null;
  speaker_label: string;
  timestamp: string;
  content: string;
  start: number;
  end: number;
  confidence: number | null;
}

export interface UtterancesData {
  meeting_id: string;
  utterances: UtteranceItem[];
  total_duration_sec: number | null;
  meeting_start_time: string | null;
}

interface UtterancesResponseBody {
  success: boolean;
  data: UtterancesData;
  message?: string;
}

export async function fetchMeetingUtterances(
  meetingId: string,
): Promise<UtterancesData> {
  const body = await apiRequest<UtterancesResponseBody>(
    `/intelligences/meetings/${meetingId}/utterances`,
  );
  return body.data;
}

export interface SpeakerReassignRequest {
  old_speaker_label: string;
  new_speaker_id: number | null;
  new_speaker_label: string;
  seq?: number;
  apply_all?: boolean;
}

interface SpeakerReassignResponseBody {
  success: boolean;
  data: { updated_count: number };
  message?: string;
}

export async function reassignSpeaker(
  meetingId: string,
  payload: SpeakerReassignRequest,
): Promise<number> {
  const body = await apiRequest<SpeakerReassignResponseBody>(
    `/intelligences/meetings/${meetingId}/utterances/speaker`,
    { method: "PATCH", body: JSON.stringify(payload) },
  );
  return body.data.updated_count;
}

export async function updateUtteranceContent(
  meetingId: string,
  seq: number,
  content: string,
): Promise<void> {
  await apiRequest<{ success: boolean }>(
    `/intelligences/meetings/${meetingId}/utterances/${seq}/content`,
    { method: "PATCH", body: JSON.stringify({ seq, content }) },
  );
}

export interface MeetingStatusData {
  meeting_id: number;
  status: string;
  is_done: boolean;
}

interface MeetingStatusResponseBody {
  success: boolean;
  data: MeetingStatusData;
  message?: string;
}

export async function checkMeetingStatus(
  meetingId: string | number,
): Promise<MeetingStatusData> {
  const body = await apiRequest<MeetingStatusResponseBody>(
    `/intelligences/meetings/${meetingId}/status`,
  );
  return body.data;
}
