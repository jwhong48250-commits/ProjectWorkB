import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Camera, Check, Mic, RefreshCw, Save, Volume2 } from 'lucide-react'
import { getMyDeviceSettings, updateMyDeviceSettings } from '../../api/auth'
import {
  DEVICE_SETTINGS_STORAGE_KEY,
  readStoredDeviceSettings,
  type StoredDeviceSettings,
} from '../../utils/deviceSettings'

function getDeviceLabel(device: MediaDeviceInfo, index: number, fallback: string): string {
  return device.label || `${fallback} ${index + 1}`
}

const INPUT_LEVEL_NOISE_GATE = 0.006
const INPUT_LEVEL_MAX_RMS = 0.14
const INPUT_LEVEL_ATTACK = 0.35
const INPUT_LEVEL_RELEASE = 0.12

interface ToggleSwitchProps {
  checked: boolean
  label: string
  onChange: () => void
}

function ToggleSwitch({ checked, label, onChange }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background ${checked ? 'bg-accent' : 'bg-border'}`}
      aria-label={label}
      aria-pressed={checked}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  )
}

export default function DeviceSettingsPage() {
  const stored = useRef(readStoredDeviceSettings())
  const [selectedMicId, setSelectedMicId] = useState(stored.current.selectedMicId ?? '')
  const [selectedCameraId, setSelectedCameraId] = useState(stored.current.selectedCameraId ?? '')
  const [micEnabled, setMicEnabled] = useState(stored.current.micEnabled ?? true)
  const [cameraEnabled, setCameraEnabled] = useState(stored.current.cameraEnabled ?? true)
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([])
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [loadingDevices, setLoadingDevices] = useState(true)
  const [permissionError, setPermissionError] = useState('')
  const [testing, setTesting] = useState(false)
  const [inputLevel, setInputLevel] = useState(0)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const animationRef = useRef<number | null>(null)
  const savedTimerRef = useRef<number | null>(null)
  const inputLevelRef = useRef(0)

  function stopCameraPreview() {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
    cameraStreamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  function stopMicTest() {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
    micStreamRef.current?.getTracks().forEach((track) => track.stop())
    micStreamRef.current = null

    void audioContextRef.current?.close().catch(() => undefined)
    audioContextRef.current = null

    setTesting(false)
    inputLevelRef.current = 0
    setInputLevel(0)
  }

  async function loadDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setPermissionError('이 브라우저에서는 장치 관리를 지원하지 않습니다.')
      setLoadingDevices(false)
      return
    }

    setLoadingDevices(true)
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const nextMicrophones = devices.filter((device) => device.kind === 'audioinput')
      const nextCameras = devices.filter((device) => device.kind === 'videoinput')

      setMicrophones(nextMicrophones)
      setCameras(nextCameras)

      setSelectedMicId((current) => (
        nextMicrophones.some((device) => device.deviceId === current)
          ? current
          : nextMicrophones.find((device) => device.deviceId === stored.current.selectedMicId)?.deviceId
            ?? nextMicrophones[0]?.deviceId
            ?? ''
      ))
      setSelectedCameraId((current) => (
        nextCameras.some((device) => device.deviceId === current)
          ? current
          : nextCameras.find((device) => device.deviceId === stored.current.selectedCameraId)?.deviceId
            ?? nextCameras[0]?.deviceId
            ?? ''
      ))
    } catch (err) {
      setPermissionError(err instanceof Error ? err.message : '장치 목록을 불러오지 못했습니다.')
    } finally {
      setLoadingDevices(false)
    }
  }

  async function loadSavedSettings() {
    try {
      const settings = await getMyDeviceSettings()
      const nextSettings: StoredDeviceSettings = {
        selectedMicId: settings.selected_mic_id ?? '',
        selectedCameraId: settings.selected_camera_id ?? '',
        micEnabled: settings.mic_enabled,
        cameraEnabled: settings.camera_enabled,
      }

      stored.current = nextSettings
      localStorage.setItem(DEVICE_SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings))
      setSelectedMicId(nextSettings.selectedMicId)
      setSelectedCameraId(nextSettings.selectedCameraId)
      setMicEnabled(nextSettings.micEnabled)
      setCameraEnabled(nextSettings.cameraEnabled)
    } catch {
      // 로그인 전 목업 모드나 API 미연결 상태에서는 로컬 저장값으로 계속 동작합니다.
    }
  }

  async function requestDevicePermission() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionError('이 브라우저에서는 장치 권한 요청을 지원하지 않습니다.')
      return
    }

    setPermissionError('')
    const streams: MediaStream[] = []

    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      streams.push(audioStream)
    } catch {
      /* 마이크가 없거나 권한이 거부될 수 있습니다. */
    }

    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true })
      streams.push(videoStream)
    } catch {
      /* 카메라가 없거나 권한이 거부될 수 있습니다. */
    }

    streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()))

    if (streams.length === 0) {
      setPermissionError('장치 권한이 거부되었거나 사용할 수 있는 장비가 없습니다.')
    }

    await loadDevices()
  }

  async function handleMicTest() {
    if (testing) {
      stopMicTest()
      return
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionError('이 브라우저에서는 마이크 테스트를 지원하지 않습니다.')
      return
    }

    setTesting(true)
    setPermissionError('')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedMicId ? { deviceId: { exact: selectedMicId } } : true,
        video: false,
      })
      const AudioContextCtor = window.AudioContext
      const audioContext = new AudioContextCtor()
      const analyser = audioContext.createAnalyser()
      const source = audioContext.createMediaStreamSource(stream)

      analyser.fftSize = 256
      const data = new Uint8Array(analyser.fftSize)
      source.connect(analyser)
      micStreamRef.current = stream
      audioContextRef.current = audioContext

      const updateLevel = () => {
        analyser.getByteTimeDomainData(data)
        let sumSquares = 0

        for (const value of data) {
          const normalized = (value - 128) / 128
          sumSquares += normalized * normalized
        }

        const rms = Math.sqrt(sumSquares / data.length)
        const normalized = rms <= INPUT_LEVEL_NOISE_GATE
          ? 0
          : Math.min(1, (rms - INPUT_LEVEL_NOISE_GATE) / (INPUT_LEVEL_MAX_RMS - INPUT_LEVEL_NOISE_GATE))
        const targetLevel = Math.round(normalized * 100)
        const alpha = targetLevel > inputLevelRef.current ? INPUT_LEVEL_ATTACK : INPUT_LEVEL_RELEASE
        inputLevelRef.current = inputLevelRef.current * (1 - alpha) + targetLevel * alpha
        setInputLevel(Math.round(inputLevelRef.current))
        animationRef.current = requestAnimationFrame(updateLevel)
      }

      updateLevel()
      await loadDevices()
    } catch (err) {
      setPermissionError(err instanceof Error ? err.message : '마이크를 사용할 수 없습니다.')
      stopMicTest()
    }
  }

  async function saveSettings() {
    const nextSettings: StoredDeviceSettings = {
      selectedMicId,
      selectedCameraId,
      micEnabled,
      cameraEnabled,
    }

    localStorage.setItem(DEVICE_SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings))
    stored.current = nextSettings

    setSaving(true)
    setPermissionError('')

    try {
      await updateMyDeviceSettings({
        selected_mic_id: selectedMicId || null,
        selected_camera_id: selectedCameraId || null,
        mic_enabled: micEnabled,
        camera_enabled: cameraEnabled,
      })
    } catch (err) {
      setPermissionError(err instanceof Error ? err.message : '장비 정보를 서버에 저장하지 못했습니다.')
      setSaving(false)
      return
    }

    setSaving(false)

    setSaved(true)
    if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current)
    savedTimerRef.current = window.setTimeout(() => setSaved(false), 1800)
  }

  useEffect(() => {
    void loadSavedSettings()
    void loadDevices()

    const handleDeviceChange = () => void loadDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', handleDeviceChange)

    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange)
      stopCameraPreview()
      stopMicTest()
      if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!micEnabled) {
      stopMicTest()
    }
  }, [micEnabled])

  useEffect(() => {
    if (!cameraEnabled || !selectedCameraId || !navigator.mediaDevices?.getUserMedia) {
      stopCameraPreview()
      return
    }

    let cancelled = false

    async function startCameraPreview() {
      stopCameraPreview()
      setPermissionError('')

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { deviceId: { exact: selectedCameraId } },
        })

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        cameraStreamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
      } catch (err) {
        if (!cancelled) {
          setPermissionError(err instanceof Error ? err.message : '웹캠을 시작하지 못했습니다.')
        }
      }
    }

    void startCameraPreview()

    return () => {
      cancelled = true
      stopCameraPreview()
    }
  }, [cameraEnabled, selectedCameraId])

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground mb-1">장비 관리</h1>
          <p className="text-sm text-muted-foreground">AI 챗봇 및 STT를 실행할 장비와 입력 장치를 관리합니다.</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          <button
            type="button"
            onClick={() => void requestDevicePermission()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-accent/40 px-3 text-sm font-medium text-accent transition-colors hover:bg-accent-subtle"
          >
            <Check size={14} />
            장치 권한 허용
          </button>
          <button
            type="button"
            onClick={() => void loadDevices()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm transition-colors hover:bg-muted"
          >
            <RefreshCw size={14} />
            새로고침
          </button>
        </div>
      </div>

      {permissionError && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{permissionError}</span>
        </div>
      )}

      <div className="p-4 rounded-xl border border-border bg-card mb-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Mic size={16} className="text-accent" />
            <h2 className="text-sm font-semibold text-foreground">마이크 관리</h2>
          </div>
          <ToggleSwitch
            checked={micEnabled}
            label="마이크 켜기/끄기"
            onChange={() => setMicEnabled((value) => !value)}
          />
        </div>
        {micEnabled && (
          <>
            <div className="mb-3">
              <label className="block text-mini font-medium text-muted-foreground mb-1.5">마이크 장치 선택</label>
              <select
                value={selectedMicId}
                onChange={(event) => setSelectedMicId(event.target.value)}
                disabled={loadingDevices || microphones.length === 0}
                className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                {microphones.length === 0 ? (
                  <option value="">{loadingDevices ? '장치 목록을 불러오는 중...' : '사용 가능한 마이크가 없습니다.'}</option>
                ) : microphones.map((mic, index) => (
                  <option key={mic.deviceId || index} value={mic.deviceId}>
                    {getDeviceLabel(mic, index, '마이크')}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-mini text-muted-foreground">입력 레벨</span>
                <Volume2 size={12} className="text-muted-foreground" />
              </div>
              <div className="h-2 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full rounded-full bg-green-500 transition-all duration-100"
                  style={{ width: `${testing ? inputLevel : 0}%` }}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={handleMicTest}
              disabled={microphones.length === 0}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Mic size={13} className={testing ? 'text-red-500 animate-pulse' : ''} />
              {testing ? '테스트 중지' : '마이크 테스트'}
            </button>
          </>
        )}
        {!micEnabled && (
          <p className="text-mini text-muted-foreground">
            마이크는 꺼져 있습니다. 회의 중 STT 기능이 필요하면 다시 켜세요.
          </p>
        )}
      </div>

      <div className="p-4 rounded-xl border border-border bg-card mb-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Camera size={16} className="text-accent" />
            <h2 className="text-sm font-semibold text-foreground">웹캠 관리</h2>
          </div>
          <ToggleSwitch
            checked={cameraEnabled}
            label="웹캠 켜기/끄기"
            onChange={() => setCameraEnabled((value) => !value)}
          />
        </div>
        {cameraEnabled && (
          <>
            <div className="mb-3">
              <label className="block text-mini font-medium text-muted-foreground mb-1.5">웹캠 장치 선택</label>
              <select
                value={selectedCameraId}
                onChange={(event) => setSelectedCameraId(event.target.value)}
                disabled={loadingDevices || cameras.length === 0}
                className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                {cameras.length === 0 ? (
                  <option value="">{loadingDevices ? '장치 목록을 불러오는 중...' : '사용 가능한 웹캠이 없습니다.'}</option>
                ) : cameras.map((camera, index) => (
                  <option key={camera.deviceId || index} value={camera.deviceId}>
                    {getDeviceLabel(camera, index, '웹캠')}
                  </option>
                ))}
              </select>
            </div>
            <div className="aspect-video overflow-hidden rounded-lg border border-border bg-muted">
              {selectedCameraId ? (
                <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" style={{ transform: 'scaleX(-1)' }} />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">웹캠을 선택하세요.</div>
              )}
            </div>
          </>
        )}
        {!cameraEnabled && (
          <p className="text-mini text-muted-foreground">
            웹캠은 꺼져 있습니다. 회의 중 사진 첨부 기능이 필요하면 다시 켜세요.
          </p>
        )}
      </div>

      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-sm text-accent">저장되었습니다.</span>}
        <button
          type="button"
          onClick={() => void saveSettings()}
          disabled={saving}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90"
        >
          <Save size={15} />
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  )
}
