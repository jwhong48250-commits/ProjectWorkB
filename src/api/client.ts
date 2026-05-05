import { getApiV1BaseUrl } from "./baseUrl";

export const API_BASE_URL = getApiV1BaseUrl();

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export type UserRole = "admin" | "member" | "viewer";
export type Gender = "male" | "female";

export interface StoredUser {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  workspace_id: number | null;
  birth_date?: string | null;
  age?: number | null;
  phone_number?: string | null;
  gender?: Gender | null;
}

interface ApiRequestOptions extends RequestInit {
  skipAuthRefresh?: boolean;
}

const ACCESS_TOKEN_KEY = "workb-access-token";
const REFRESH_TOKEN_KEY = "workb-refresh-token";
const CURRENT_USER_KEY = "workb-current-user";
const WORKSPACE_ID_KEY = "workb-workspace-id";
const LEGACY_WORKSPACE_ID_KEY = "workb-current-workspace-id";
const LEGACY_AUTH_KEYS = ["access_token", "token", "authToken"];
const SESSION_KEYS = [
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  CURRENT_USER_KEY,
  WORKSPACE_ID_KEY,
  LEGACY_WORKSPACE_ID_KEY,
  "workb-auth-mock",
  "workb-invite-code",
  "workb-workspace-role",
];

let refreshPromise: Promise<TokenResponse> | null = null;

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(formatErrorMessage(detail));
    this.status = status;
    this.detail = detail;
  }
}

function formatErrorMessage(detail: unknown): string {
  if (typeof detail === "string") return detail;

  if (detail && typeof detail === "object" && "detail" in detail) {
    const nested = (detail as { detail: unknown }).detail;
    if (typeof nested === "string") return nested;
    if (Array.isArray(nested)) {
      const parts = nested
        .map((item) => {
          if (item && typeof item === "object" && "msg" in item) {
            return formatValidationError(item as Record<string, unknown>);
          }
          return null;
        })
        .filter((x): x is string => Boolean(x));
      if (parts.length) return parts.join(" ");
    }
    if (nested && typeof nested === "object" && "message" in nested) {
      const message = (nested as { message: unknown }).message;
      if (typeof message === "string") return message;
    }
  }

  return "API 요청에 실패했습니다.";
}

function getFieldLabel(loc: unknown): string {
  if (!Array.isArray(loc)) return "입력값";

  const field = loc[loc.length - 1];
  const labels: Record<string, string> = {
    email: "이메일",
    password: "비밀번호",
    current_password: "현재 비밀번호",
    new_password: "새 비밀번호",
    confirm_password: "비밀번호 확인",
    name: "이름",
    birth_date: "생년월일",
    phone_number: "전화번호",
    gender: "성별",
    invite_code: "초대코드",
    token: "인증 토큰",
  };

  return typeof field === "string" ? labels[field] ?? "입력값" : "입력값";
}

function readNumberContext(ctx: unknown, key: string): number | null {
  if (!ctx || typeof ctx !== "object" || !(key in ctx)) return null;
  const value = Number((ctx as Record<string, unknown>)[key]);
  return Number.isFinite(value) ? value : null;
}

function formatValidationError(item: Record<string, unknown>): string {
  const type = typeof item.type === "string" ? item.type : "";
  const msg = typeof item.msg === "string" ? item.msg : "";
  const fieldLabel = getFieldLabel(item.loc);
  const minLength = readNumberContext(item.ctx, "min_length");
  const maxLength = readNumberContext(item.ctx, "max_length");

  if (type === "string_too_short") {
    return minLength
      ? `${fieldLabel}는 ${minLength}자 이상 입력해주세요.`
      : `${fieldLabel}가 너무 짧습니다.`;
  }

  if (type === "string_too_long") {
    return maxLength
      ? `${fieldLabel}는 ${maxLength}자 이하로 입력해주세요.`
      : `${fieldLabel}가 너무 깁니다.`;
  }

  if (type === "missing") return `${fieldLabel}을(를) 입력해주세요.`;
  if (type === "value_error") return msg.replace(/^Value error,\s*/, "");
  if (type.includes("email")) return "올바른 이메일 형식으로 입력해주세요.";

  if (msg === "String should have at least 8 characters") {
    return `${fieldLabel}는 8자 이상 입력해주세요.`;
  }

  return msg || "입력값을 확인해주세요.";
}

export function getAccessToken(): string | null {
  return sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return sessionStorage.getItem(REFRESH_TOKEN_KEY);
}

export function hasStoredSession(): boolean {
  return Boolean(getAccessToken() || getRefreshToken());
}

export function setAuthTokens(accessToken: string, refreshToken: string): void {
  sessionStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  sessionStorage.setItem("workb-auth-mock", "true");
  SESSION_KEYS.forEach((key) => localStorage.removeItem(key));
  LEGACY_AUTH_KEYS.forEach((key) => localStorage.removeItem(key));
}

export function clearAuthTokens(): void {
  const sessionKeysToRemove: string[] = [];
  const localKeysToRemove: string[] = [];

  for (let i = 0; i < sessionStorage.length; i += 1) {
    const key = sessionStorage.key(i);
    if (key?.startsWith("workb-")) {
      sessionKeysToRemove.push(key);
    }
  }

  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith("workb-")) {
      localKeysToRemove.push(key);
    }
  }

  sessionKeysToRemove.forEach((key) => sessionStorage.removeItem(key));
  localKeysToRemove.forEach((key) => localStorage.removeItem(key));
  LEGACY_AUTH_KEYS.forEach((key) => localStorage.removeItem(key));
}

export function getStoredUser(): StoredUser | null {
  const raw = sessionStorage.getItem(CURRENT_USER_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as StoredUser;
  } catch {
    sessionStorage.removeItem(CURRENT_USER_KEY);
    return null;
  }
}

export function setStoredUser(user: StoredUser): void {
  sessionStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
  localStorage.removeItem(CURRENT_USER_KEY);

  if (user.workspace_id) {
    setCurrentWorkspaceId(user.workspace_id);
  }
}

function readPositiveNumber(value: string | null): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function getCurrentWorkspaceId(): number {
  const stored = readPositiveNumber(sessionStorage.getItem(WORKSPACE_ID_KEY));
  if (stored) return stored;

  const legacy = readPositiveNumber(
    sessionStorage.getItem(LEGACY_WORKSPACE_ID_KEY) ??
      localStorage.getItem(WORKSPACE_ID_KEY) ??
      localStorage.getItem(LEGACY_WORKSPACE_ID_KEY)
  );
  if (legacy) {
    setCurrentWorkspaceId(legacy);
    localStorage.removeItem(WORKSPACE_ID_KEY);
    localStorage.removeItem(LEGACY_WORKSPACE_ID_KEY);
    return legacy;
  }

  const userWorkspaceId = getStoredUser()?.workspace_id;
  if (userWorkspaceId) {
    setCurrentWorkspaceId(userWorkspaceId);
    return userWorkspaceId;
  }

  return 1;
}

export function setCurrentWorkspaceId(workspaceId: number): void {
  if (!Number.isFinite(workspaceId) || workspaceId <= 0) return;
  sessionStorage.setItem(WORKSPACE_ID_KEY, String(workspaceId));
  sessionStorage.setItem(LEGACY_WORKSPACE_ID_KEY, String(workspaceId));
  localStorage.removeItem(WORKSPACE_ID_KEY);
  localStorage.removeItem(LEGACY_WORKSPACE_ID_KEY);
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const [, payload] = token.split(".");
  if (!payload) return null;

  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return JSON.parse(window.atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isUserRole(value: unknown): value is UserRole {
  return value === "admin" || value === "member" || value === "viewer";
}

function readStringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readWorkspaceIdClaim(value: unknown): number | null | undefined {
  if (value === null) return null;

  const workspaceId = Number(value);
  return Number.isFinite(workspaceId) && workspaceId > 0
    ? workspaceId
    : undefined;
}

function isGender(value: unknown): value is Gender {
  return value === "male" || value === "female";
}

function readNumberClaim(value: unknown): number | null | undefined {
  if (value === null) return null;

  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function syncStoredUserFromToken(
  fallback: Partial<StoredUser> = {}
): StoredUser | null {
  const token = getAccessToken();
  if (!token) return getStoredUser();

  const payload = decodeJwtPayload(token);
  const id = Number(payload?.sub ?? fallback.id);
  const role = isUserRole(payload?.role) ? payload.role : fallback.role;
  const email = readStringClaim(payload?.email) ?? fallback.email;
  const name = readStringClaim(payload?.name) ?? fallback.name;
  const workspaceId =
    readWorkspaceIdClaim(payload?.workspace_id) ?? fallback.workspace_id;
  const birthDate =
    payload?.birth_date === null
      ? null
      : readStringClaim(payload?.birth_date) ?? fallback.birth_date;
  const age = readNumberClaim(payload?.age) ?? fallback.age;
  const phoneNumber =
    payload?.phone_number === null
      ? null
      : readStringClaim(payload?.phone_number) ?? fallback.phone_number;
  const gender = isGender(payload?.gender) ? payload.gender : fallback.gender;

  if (!Number.isFinite(id) || !role) return getStoredUser();

  const previous = getStoredUser();
  const user: StoredUser = {
    id,
    email: email ?? previous?.email ?? "",
    name: name ?? previous?.name ?? email ?? previous?.email ?? "사용자",
    role,
    workspace_id:
      workspaceId ?? previous?.workspace_id ?? getCurrentWorkspaceId(),
    birth_date: birthDate ?? previous?.birth_date ?? null,
    age: age ?? previous?.age ?? null,
    phone_number: phoneNumber ?? previous?.phone_number ?? null,
    gender: gender ?? previous?.gender ?? null,
  };

  setStoredUser(user);
  return user;
}

function buildHeaders(
  customHeaders: HeadersInit | undefined,
  token: string | null,
  body: BodyInit | null | undefined
): Headers {
  const headers = new Headers(customHeaders);

  if (!(body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return headers;
}

async function refreshAuthTokens(): Promise<TokenResponse> {
  const refreshToken = getRefreshToken();

  if (!refreshToken) {
    clearAuthTokens();
    throw new ApiError(401, { detail: "로그인이 필요합니다." });
  }

  if (!refreshPromise) {
    refreshPromise = fetch(`${API_BASE_URL}/users/auth/token/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const detail = await response.json().catch(() => null);
          clearAuthTokens();
          throw new ApiError(response.status, detail);
        }

        const tokens = (await response.json()) as TokenResponse;
        setAuthTokens(tokens.access_token, tokens.refresh_token);
        syncStoredUserFromToken();

        return tokens;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

export async function ensureAuthSession(): Promise<boolean> {
  if (getAccessToken()) return true;

  await refreshAuthTokens();
  return true;
}

async function fetchApi(path: string, options: RequestInit): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: buildHeaders(options.headers, getAccessToken(), options.body),
  });
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const { skipAuthRefresh = false, ...requestOptions } = options;
  const response = await fetchApi(path, requestOptions);

  if (!response.ok) {
    if (response.status === 401 && !skipAuthRefresh) {
      await refreshAuthTokens();
      return apiRequest<T>(path, {
        ...requestOptions,
        skipAuthRefresh: true,
      });
    }

    const detail = await response.json().catch(() => null);
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function apiFetch<T>(
  path: string,
  options?: ApiRequestOptions
): Promise<T> {
  return apiRequest<T>(path, options);
}
