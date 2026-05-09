import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, Image as ImageIcon, KeyRound, Save, Trash2, Upload, UserRound, X } from 'lucide-react'
import clsx from 'clsx'
import { ApiError } from '../../api/client'
import { updateMyProfile, uploadMyProfileImage, withdrawMyAccount, type Gender } from '../../api/auth'
import {
  getWorkspaceMembers,
} from '../../api/workspace'
import { useAuth } from '../../context/AuthContext'
import BirthDateSelect from '../../components/auth/BirthDateSelect'
import { useAccentColor, type AccentPreset } from '../../hooks/useAccentColor'
import { useFontScale, type FontScale } from '../../context/FontScaleContext'
import { getProfileImage, setProfileImage } from '../../utils/profileImage'
import {
  getCurrentWorkspaceId,
  WORKSPACE_CHANGED_EVENT,
} from '../../utils/workspace'

const MAX_PROFILE_IMAGE_SIZE = 1024 * 1024

const FONT_SCALE_OPTIONS: {
  id: FontScale
  label: string
  hint: string
}[] = [
  { id: 'sm', label: '작게', hint: '16px 기준' },
  { id: 'md', label: '보통', hint: '18px 기준' },
  { id: 'lg', label: '크게', hint: '20px 기준' },
]

export default function MyPage() {
  const navigate = useNavigate()
  const { user, saveUser, signOut } = useAuth()
  const { fontScale, setFontScale, previewFontScale } = useFontScale()
  const {
    accentPreset,
    setAccentPreset,
    previewAccentPreset,
    accentPalettes,
    accentAsMain,
    setAccentAsMain,
    previewAccentAsMain,
  } = useAccentColor()

  const [draftName, setDraftName] = useState(user?.name ?? '')
  const [draftBirthDate, setDraftBirthDate] = useState(user?.birth_date ?? '')
  const [draftPhoneNumber, setDraftPhoneNumber] = useState(user?.phone_number ?? '')
  const [draftGender, setDraftGender] = useState<Gender | ''>(user?.gender ?? '')
  const [draftProfileImage, setDraftProfileImage] = useState('')
  const [draftFontScale, setDraftFontScale] = useState<FontScale>(fontScale)
  const [draftAccentPreset, setDraftAccentPreset] = useState<AccentPreset>(accentPreset)
  const [draftAccentAsMain, setDraftAccentAsMain] = useState(accentAsMain)
  const [saving, setSaving] = useState(false)
  const [departmentName, setDepartmentName] = useState('부서 없음')
  const [withdrawing, setWithdrawing] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const profileImageUserId = useMemo(() => user?.id, [user?.id])
  const committedSettingsRef = useRef({
    fontScale,
    accentPreset,
    accentAsMain,
  })

  useEffect(() => {
    setDraftName(user?.name ?? '')
  }, [user?.name])

  useEffect(() => {
    setDraftBirthDate(user?.birth_date ?? '')
  }, [user?.birth_date])

  useEffect(() => {
    setDraftPhoneNumber(user?.phone_number ?? '')
  }, [user?.phone_number])

  useEffect(() => {
    setDraftGender(user?.gender ?? '')
  }, [user?.gender])

  useEffect(() => {
    const remoteProfileImage = user?.profile_image_url ?? ''
    if (remoteProfileImage) {
      setProfileImage(profileImageUserId, remoteProfileImage)
      setDraftProfileImage(remoteProfileImage)
      return
    }
    setDraftProfileImage(getProfileImage(profileImageUserId))
  }, [profileImageUserId, user?.profile_image_url])

  useEffect(() => {
    let active = true

    async function loadMyWorkspaceProfile() {
      if (!profileImageUserId) {
        setDepartmentName('부서 없음')
        return
      }

      try {
        const rows = await getWorkspaceMembers(getCurrentWorkspaceId())
        if (!active) return
        const me = rows.find((member) => member.user_id === profileImageUserId)
        setDepartmentName(me?.department ?? '부서 없음')
        if (me) {
          setDraftBirthDate(me.birth_date ?? '')
          setDraftGender(me.gender ?? '')
        }
      } catch {
        if (active) setDepartmentName('부서 없음')
      }
    }

    void loadMyWorkspaceProfile()

    function handleWorkspaceChanged() {
      void loadMyWorkspaceProfile()
    }

    window.addEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChanged)
    return () => {
      active = false
      window.removeEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChanged)
    }
  }, [profileImageUserId])

  useEffect(() => {
    setDraftFontScale(fontScale)
  }, [fontScale])

  useEffect(() => {
    setDraftAccentPreset(accentPreset)
  }, [accentPreset])

  useEffect(() => {
    setDraftAccentAsMain(accentAsMain)
  }, [accentAsMain])

  useEffect(() => {
    return () => {
      const committed = committedSettingsRef.current
      previewFontScale(committed.fontScale)
      previewAccentPreset(committed.accentPreset)
      previewAccentAsMain(committed.accentAsMain)
    }
  }, [previewAccentAsMain, previewAccentPreset, previewFontScale])

  async function handleProfileImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setError('이미지 파일만 업로드할 수 있습니다.')
      return
    }

    if (file.size > MAX_PROFILE_IMAGE_SIZE) {
      setError('프로필 이미지는 1MB 이하 파일을 사용해 주세요.')
      return
    }

    try {
      const { image_url } = await uploadMyProfileImage(file)
      setDraftProfileImage(image_url)
      setProfileImage(profileImageUserId, image_url)
      if (user) {
        saveUser({
          ...user,
          profile_image_url: image_url,
        })
      }
      setError('')
      setMessage('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '프로필 이미지를 읽지 못했습니다.')
    }
  }

  function resetProfileImage() {
    setDraftProfileImage('')
    setError('')
    setMessage('')
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setMessage('')

    const nextName = draftName.trim()
    if (nextName.length < 2) {
      setError('이름은 2자 이상 입력해주세요.')
      return
    }

    const nextPhoneNumber = draftPhoneNumber.trim()
    const phoneDigits = nextPhoneNumber.replace(/\D/g, '')
    if (nextPhoneNumber && (!/^[\d+\-\s()]+$/.test(nextPhoneNumber) || phoneDigits.length < 9 || phoneDigits.length > 15)) {
      setError('전화번호는 숫자 기준 9자 이상 15자 이하로 입력해주세요.')
      return
    }

    setSaving(true)
    try {
      let savedName = nextName

      const response = await updateMyProfile({
        name: nextName,
        birth_date: draftBirthDate || null,
        phone_number: nextPhoneNumber || null,
        gender: draftGender || null,
      })
      const savedUser = response.user
      saveUser(savedUser)
      savedName = savedUser.name

      setProfileImage(profileImageUserId, draftProfileImage)

      setFontScale(draftFontScale)
      setAccentPreset(draftAccentPreset)
      setAccentAsMain(draftAccentAsMain)
      committedSettingsRef.current = {
        fontScale: draftFontScale,
        accentPreset: draftAccentPreset,
        accentAsMain: draftAccentAsMain,
      }
      setDraftName(savedName)
      setDraftBirthDate(savedUser.birth_date ?? '')
      setDraftPhoneNumber(savedUser.phone_number ?? '')
      setDraftGender(savedUser.gender ?? '')
      setMessage('마이페이지 정보가 저장되었습니다.')
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : '마이페이지 저장에 실패했습니다.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleWithdraw() {
    const ok = window.confirm(
      '회원 탈퇴를 진행하시겠습니까? 탈퇴 후 현재 계정으로 다시 로그인할 수 없습니다.',
    )
    if (!ok) return

    setWithdrawing(true)
    setError('')
    setMessage('')

    try {
      await withdrawMyAccount()
      await signOut()
      navigate('/login', { replace: true })
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : '회원 탈퇴에 실패했습니다.',
      )
    } finally {
      setWithdrawing(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <div className="mb-6">
        <h1 className="mb-1 text-xl font-semibold text-foreground">마이페이지</h1>
        <p className="text-sm text-muted-foreground">내 프로필과 개인 화면 구성을 관리합니다.</p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-4 flex items-start gap-3">
            <UserRound size={20} className="mt-0.5 shrink-0 text-accent" />
            <div>
              <h2 className="text-sm font-semibold text-foreground">내 프로필</h2>
              <p className="text-mini text-muted-foreground">이름은 워크스페이스 멤버 목록과 회의 참석자 표시에 사용됩니다.</p>
            </div>
          </div>

          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted">
              {draftProfileImage ? (
                <img src={draftProfileImage} alt="프로필 이미지" className="h-full w-full object-cover" />
              ) : (
                <ImageIcon size={22} className="text-muted-foreground" />
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-muted">
                <Upload size={14} />
                이미지 업로드
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={handleProfileImageChange}
                  className="sr-only"
                />
              </label>
              <button
                type="button"
                onClick={resetProfileImage}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X size={14} />
                기본 이미지
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground" htmlFor="profile-name">
              이름
            </label>
            <input
              id="profile-name"
              type="text"
              value={draftName}
              onChange={(event) => {
                setDraftName(event.target.value)
                setMessage('')
              }}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
          </div>

          <div className="mt-4">
            <label className="mb-1.5 block text-sm font-medium text-foreground" htmlFor="profile-department">
              부서
            </label>
            <input
              id="profile-department"
              type="text"
              value={departmentName}
              readOnly
              className="h-10 w-full cursor-default rounded-lg border border-border bg-muted/40 px-3 text-sm text-muted-foreground outline-none"
            />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                생년월일
              </label>
              <BirthDateSelect value={draftBirthDate} onChange={(value) => {
                setDraftBirthDate(value)
                setMessage('')
              }} />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground" htmlFor="profile-phone">
                전화번호
              </label>
              <input
                id="profile-phone"
                type="tel"
                value={draftPhoneNumber}
                onChange={(event) => {
                  setDraftPhoneNumber(event.target.value)
                  setMessage('')
                }}
                placeholder="010-1234-5678"
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              성별
            </label>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="성별">
              {[
                { value: 'female', label: '여성' },
                { value: 'male', label: '남성' },
              ].map((option) => (
                <label
                  key={option.value}
                  className={clsx(
                    'flex h-10 cursor-pointer items-center justify-center rounded-lg border text-sm font-medium transition-colors',
                    draftGender === option.value
                      ? 'border-accent bg-accent text-accent-foreground'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <input
                    type="radio"
                    name="profile-gender"
                    value={option.value}
                    checked={draftGender === option.value}
                    onChange={() => {
                      setDraftGender(option.value as Gender)
                      setMessage('')
                    }}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-4 flex items-start gap-3">
            <KeyRound size={20} className="mt-0.5 shrink-0 text-accent" />
            <div>
              <h2 className="text-sm font-semibold text-foreground">계정 보안</h2>
              <p className="text-mini text-muted-foreground">비밀번호 변경은 관리 메뉴의 전용 화면에서 처리합니다.</p>
            </div>
          </div>
          <Link
            to="/settings/password"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium transition-colors hover:bg-muted"
          >
            <KeyRound size={14} />
            비밀번호 변경
          </Link>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-1 text-sm font-semibold text-foreground">개인 화면 관리</h2>
          <p className="mb-4 text-mini text-muted-foreground">선택 즉시 미리보기로 반영되며, 저장 버튼을 눌러야 유지됩니다.</p>

          <div className="mb-5">
            <label className="mb-2 block text-sm font-medium text-foreground">글자 크기</label>
            <div className="flex flex-wrap gap-2">
              {FONT_SCALE_OPTIONS.map((option) => {
                const selected = draftFontScale === option.id
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setDraftFontScale(option.id)
                      previewFontScale(option.id)
                      setMessage('')
                    }}
                    className={clsx(
                      'flex min-w-[5.5rem] flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors',
                      selected
                        ? 'border-accent bg-accent-subtle text-accent'
                        : 'border-border text-muted-foreground hover:border-foreground',
                    )}
                    aria-pressed={selected}
                  >
                    <span className="text-sm font-medium text-foreground">{option.label}</span>
                    <span className="text-micro text-muted-foreground">{option.hint}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">포인트 색상</label>
            <div className="mb-3 flex w-full max-w-md gap-1 rounded-xl border border-border bg-muted/40 p-1">
              <button
                type="button"
                onClick={() => {
                  setDraftAccentAsMain(false)
                  previewAccentAsMain(false)
                  setMessage('')
                }}
                aria-pressed={!draftAccentAsMain}
                className={clsx(
                  'flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  !draftAccentAsMain
                    ? 'bg-card text-foreground shadow-sm ring-1 ring-border'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                기본
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraftAccentAsMain(true)
                  previewAccentAsMain(true)
                  setMessage('')
                }}
                aria-pressed={draftAccentAsMain}
                className={clsx(
                  'flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  draftAccentAsMain
                    ? 'bg-card text-foreground shadow-sm ring-1 ring-border'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                메인 톤
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {Object.entries(accentPalettes).map(([key, palette]) => {
                const selected = draftAccentPreset === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      const nextPreset = key as AccentPreset
                      setDraftAccentPreset(nextPreset)
                      previewAccentPreset(nextPreset)
                      setMessage('')
                    }}
                    className={clsx(
                      'flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition-colors',
                      selected
                        ? 'border-accent bg-accent-subtle text-accent'
                        : 'border-border text-muted-foreground hover:border-foreground',
                    )}
                    aria-pressed={selected}
                  >
                    <span
                      className="h-4 w-4 rounded-full border border-black/10"
                      style={{ backgroundColor: palette.swatch }}
                      aria-hidden
                    />
                    <span>{palette.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          {message && (
            <p className="inline-flex items-center gap-1.5 text-sm text-accent">
              <Check size={14} />
              {message}
            </p>
          )}
          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Save size={15} />
            {saving ? '저장 중...' : '마이페이지 저장'}
          </button>
        </div>
      </form>

      <div className="mt-6 rounded-xl border border-red-200/80 bg-red-50/70 p-4 dark:border-red-900/45 dark:bg-red-950/10">
        <div className="mb-3 flex items-start gap-3">
          <Trash2 size={20} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
          <div>
            <h2 className="text-sm font-semibold text-red-700 dark:text-red-300">회원 탈퇴</h2>
            <p className="text-mini text-red-600/90 dark:text-red-300/75">
              계정이 비활성화되고 현재 워크스페이스 멤버 목록에서 제거됩니다.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleWithdraw}
          disabled={withdrawing || saving}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-300 bg-card px-3 text-sm font-medium text-red-600 transition-colors hover:bg-red-100 dark:border-red-900/60 dark:bg-background dark:text-red-300 dark:hover:bg-red-950/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Trash2 size={14} />
          {withdrawing ? '탈퇴 처리 중...' : '회원 탈퇴'}
        </button>
      </div>
    </div>
  )
}
