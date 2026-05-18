import { apiRequest } from './client'

export type DiarizationMethod = 'stereo' | 'diarization'

export interface SpeakerProfileItem {
  user_id: number
  name: string
  email: string
  role: 'admin' | 'member' | 'viewer' | string
  is_verified: boolean
  diarization_method: DiarizationMethod | null
  updated_at: string | null
}

interface SpeakerProfileListResponse {
  profiles: SpeakerProfileItem[]
}

interface SpeakerProfileRegisterResponse {
  profile: SpeakerProfileItem
  message: string
}

export async function getSpeakerProfiles(workspaceId: number): Promise<SpeakerProfileItem[]> {
  const response = await apiRequest<SpeakerProfileListResponse>(
    `/meetings/workspaces/${workspaceId}/speaker-profiles`,
  )
  return response.profiles
}

export function registerSpeakerProfile(
  workspaceId: number,
  userId: number,
  diarizationMethod: DiarizationMethod,
): Promise<SpeakerProfileRegisterResponse> {
  return apiRequest<SpeakerProfileRegisterResponse>(
    `/meetings/workspaces/${workspaceId}/speaker-profiles`,
    {
      method: 'POST',
      body: JSON.stringify({
        user_id: userId,
        diarization_method: diarizationMethod,
      }),
    },
  )
}
