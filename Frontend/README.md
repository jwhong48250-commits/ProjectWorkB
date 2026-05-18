# Workb Frontend

AI 회의 어시스턴트 서비스의 프론트엔드 프로젝트입니다. Vite + React 18 + TypeScript + Tailwind CSS로 구성되어 있습니다.

## 사전 요구사항

- Node.js 18 이상 (Vite 6·React 18 기준)
- npm

## 설치

```bash
npm install
```

## 환경 변수

`.env.example`을 복사해 `.env.local`을 생성한 뒤 값을 채웁니다.

```bash
cp .env.example .env.local
```

| 변수명 | 필수 | 설명 |
|---|---|---|
| `VITE_API_BASE_URL` | 권장 | 백엔드 **origin** (예: `http://localhost:8000`). 끝에 `/api/v1`이 있어도 `src/api/baseUrl.ts`에서 제거한 뒤 API 호출 시 `/api/v1`을 붙입니다. 미설정·빈 값이면 코드 기본값 `http://127.0.0.1:8000/api/v1`에서 origin을 유추합니다. |
| `VITE_API_URL` | (레거시) | 가능하면 `VITE_API_BASE_URL`만 사용합니다. 의미는 위와 동일 계열입니다. |
| `VITE_WS_BASE` | 선택 | 실시간 STT 웹소켓 (미설정 시 코드 기본값 `ws://localhost:8888`) |
| `VITE_ASR_SERVER` | 선택 | ASR HTTP 베이스 (미설정 시 코드 기본값 `http://localhost:8888`) |

자세한 예시와 주석은 `.env.example`을 참고합니다.

## 로컬 실행

```bash
npm run dev
```

기본 개발 서버 주소: `http://localhost:5173`

## 빌드 · 테스트

| 명령 | 설명 |
|---|---|
| `npm run build` | 프로덕션 빌드 (`tsc -b && vite build`) |
| `npm run preview` | 빌드 결과 미리보기 |
| `npm test` | 유닛 테스트 (Vitest) |
| `npm run test:ui` | Vitest UI 모드 |
| `npm run test:coverage` | 커버리지 측정 |
| `npm run test:e2e` | E2E 테스트 (Playwright) |

## 라우트 구조

### 인증 / 온보딩 (AuthLayout)

| 경로 | 설명 |
|---|---|
| `/login` | 로그인 |
| `/oauth/callback` | 소셜 로그인(Google·Kakao) OAuth 콜백 |
| `/signup` | 회원가입 (`?role=admin` 또는 `?role=member`) |
| `/reset-password` | 비밀번호 재설정 |
| `/onboarding/workspace` | 워크스페이스 생성 |
| `/onboarding/integrations` | 외부 서비스 연동 설정 |
| `/onboarding/invite` | 팀원 초대 |

### 앱 셸 (AppShell: Sidebar + TopBar)

| 경로 | 설명 |
|---|---|
| `/` | 홈 |
| `/history` | 회의 히스토리 |
| `/calendar` | 캘린더 |
| `/support` | 고객지원 |
| `/meetings/new` | 회의 생성 (회의 생성 권한 필요) |
| `/meetings/context` | 회의 사전 컨텍스트 입력 |
| `/meetings/:meetingId/upcoming` | 예정 회의 상세 |
| `/meetings/post` | 사후 회의 선택 |
| `/meetings/wbs-select` | WBS 회의 선택 |
| `/meetings/:meetingId/notes` | 회의록 |
| `/meetings/:meetingId/notes/edit` | 회의록 편집 |
| `/meetings/:meetingId/wbs` | WBS |
| `/meetings/:meetingId/reports` | 보고서 |
| `/meetings/:meetingId/export` | 내보내기 |
| `/meetings/simulate-select` | 시뮬레이션 회의 선택 |
| `/meetings/:meetingId/simulate` | 회의 시뮬레이션 |
| `/settings/my` | 내 프로필 |
| `/settings/password` | 비밀번호 변경 |
| `/settings/voice` | 음성 설정 |
| `/settings/workspace` | 워크스페이스 설정 (관리자) |
| `/settings/members` | 멤버 관리 (관리자) |
| `/settings/departments` | 부서 관리 (관리자) |
| `/settings/integrations` | 외부 서비스 연동 관리 (관리자) |
| `/settings/device` | 장치 설정 (관리자) |

### 라이브 회의 (FullscreenLayout)

| 경로 | 설명 |
|---|---|
| `/live` | 라이브 회의 (회의 미지정) |
| `/live/:meetingId` | 특정 회의 라이브 |

검색·화면공유·화자 보조 기능은 별도 경로 없이 `LivePage` 내 우측 패널로 통합되어 있습니다.

## 디렉터리 개요

```
src/
  api/          # HTTP 클라이언트 및 API 요청 함수
  components/   # 공용 UI 컴포넌트
    chat/
    home/
    layout/
    ui/
  context/      # React Context (전역 상태)
  data/         # 개발용 목업 데이터
  hooks/        # 커스텀 훅
  pages/        # 라우트별 페이지 컴포넌트
    auth/
    live/
    meetings/
    onboarding/
    settings/
  types/        # TypeScript 타입 정의
  utils/        # 유틸리티 함수
```

## 개발 참고

인증 연동 전 목업 모드로 빠르게 진입하려면:

```js
localStorage.setItem('workb-auth-mock', 'true')
```

또는 `/login`에서 임의 값으로 로그인해도 홈으로 진입합니다.

## 관련 문서

- 백엔드: [`workb-backend/README.md`](../workb-backend/README.md)
