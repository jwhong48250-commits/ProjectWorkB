import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Check, Image as ImageIcon, Save, Trash2, Upload, X } from "lucide-react";
import { getCurrentWorkspaceId } from "../../api/client";
import {
  deleteWorkspace,
  getWorkspace,
  joinWorkspaceByInviteCode,
  updateWorkspace,
  uploadWorkspaceLogoFile,
} from "../../api/workspace";
import { useAuth } from "../../context/AuthContext";
import {
  DEFAULT_WORKSPACE_LOGO_URL,
  clearWorkspaceLogoUrl,
  getWorkspaceLogoUrl,
  setWorkspaceLogoUrl,
} from "../../utils/workspaceLogo";
import {
  getCurrentWorkspaceRole,
  setCurrentWorkspaceId,
  setCurrentWorkspaceRole,
} from "../../utils/workspace";

const LANGUAGES = ["한국어", "English", "日本語", "中文"];
const MAX_LOGO_SIZE = 1024 * 1024;

export default function WorkspaceSettingsPage() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const isWorkspaceAdmin = getCurrentWorkspaceRole() === "admin";
  const [teamName, setTeamName] = useState("Workb 팀");
  const [industry, setIndustry] = useState("");
  const [language, setLanguage] = useState("한국어");
  const [logoUrl, setLogoUrl] = useState(DEFAULT_WORKSPACE_LOGO_URL);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [joiningWorkspace, setJoiningWorkspace] = useState(false);
  const [workspaceJoinMessage, setWorkspaceJoinMessage] = useState("");
  const [error, setError] = useState("");
  const workspaceId = getCurrentWorkspaceId();

  useEffect(() => {
    let active = true;

    async function loadWorkspace() {
      setLoading(true);
      setError("");

      try {
        const workspace = await getWorkspace(workspaceId);
        if (!active) return;
        setTeamName(workspace.name);
        setIndustry(workspace.industry ?? "");
        setLanguage(workspace.default_language ?? "한국어");
        if (workspace.logo_url) {
          setWorkspaceLogoUrl(workspaceId, workspace.logo_url);
        }
        setLogoUrl(workspace.logo_url ?? getWorkspaceLogoUrl(workspaceId));
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : "워크스페이스 정보를 불러오지 못했습니다."
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    loadWorkspace();

    return () => {
      active = false;
    };
  }, [workspaceId]);

  async function handleLogoUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("이미지 파일만 업로드할 수 있습니다.");
      return;
    }

    if (file.size > MAX_LOGO_SIZE) {
      setError("로고 이미지는 1MB 이하 파일을 사용해 주세요.");
      return;
    }

    try {
      const { logo_url } = await uploadWorkspaceLogoFile(workspaceId, file);
      setLogoUrl(logo_url);
      setWorkspaceLogoUrl(workspaceId, logo_url);
      setError("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "로고 파일을 읽지 못했습니다."
      );
    }
  }

  function resetLogo() {
    setLogoUrl(DEFAULT_WORKSPACE_LOGO_URL);
    clearWorkspaceLogoUrl(workspaceId);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    try {
      const nextLogoUrl = logoUrl === DEFAULT_WORKSPACE_LOGO_URL ? null : logoUrl || null;
      const payload = {
        name: teamName,
        industry: industry || null,
        default_language: language,
        ...(nextLogoUrl === null ? { logo_url: null } : {}),
      };
      const workspace = await updateWorkspace(workspaceId, {
        ...payload,
      });
      setWorkspaceLogoUrl(workspaceId, workspace.logo_url);

      setTeamName(workspace.name);
      setIndustry(workspace.industry ?? "");
      setLanguage(workspace.default_language ?? "한국어");
      setLogoUrl(workspace.logo_url ?? DEFAULT_WORKSPACE_LOGO_URL);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "워크스페이스 정보 저장에 실패했습니다."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleJoinWorkspace(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setWorkspaceJoinMessage("");

    const normalizedCode = inviteCode.trim().toUpperCase();
    if (normalizedCode.length < 6) {
      setError("초대코드를 확인해주세요.");
      return;
    }

    setJoiningWorkspace(true);
    try {
      const response = await joinWorkspaceByInviteCode(normalizedCode);
      setCurrentWorkspaceRole(response.role);
      setCurrentWorkspaceId(response.workspace_id);
      setInviteCode("");
      setWorkspaceJoinMessage(
        response.message ||
          `${response.workspace_name} 워크스페이스에 참여했습니다.`,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "워크스페이스 참여에 실패했습니다.",
      );
    } finally {
      setJoiningWorkspace(false);
    }
  }

  async function handleDeleteWorkspace() {
    const typedName = window.prompt(
      `워크스페이스를 삭제하려면 "${teamName}"을 정확히 입력하세요.`
    );
    if (typedName === null) return;
    if (typedName !== teamName) {
      setError("워크스페이스 이름이 일치하지 않습니다.");
      return;
    }

    setDeleting(true);
    setError("");

    try {
      await deleteWorkspace(workspaceId);
      clearWorkspaceLogoUrl(workspaceId);
      await signOut();
      navigate("/login", { replace: true });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "워크스페이스 삭제에 실패했습니다."
      );
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <p className="text-sm text-muted-foreground">
          워크스페이스 정보를 불러오는 중입니다...
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
      <h1 className="text-xl font-semibold text-foreground mb-1">
        워크스페이스 관리
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        팀 정보와 기본 항목을 관리합니다.
      </p>
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <form
        onSubmit={handleJoinWorkspace}
        className="mb-6 rounded-xl border border-border bg-card p-4"
      >
        <div className="mb-4 flex items-start gap-3">
          <Building2 size={20} className="mt-0.5 shrink-0 text-accent" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              워크스페이스 참여
            </h2>
            <p className="text-mini text-muted-foreground">
              초대코드를 입력하면 해당 워크스페이스가 사이드바 목록에 추가됩니다.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="min-w-0 flex-1">
            <label className="sr-only" htmlFor="workspace-invite-code">
              초대코드
            </label>
            <input
              id="workspace-invite-code"
              type="text"
              value={inviteCode}
              onChange={(event) => {
                setInviteCode(event.target.value.toUpperCase());
                setWorkspaceJoinMessage("");
              }}
              placeholder="초대코드 입력"
              className="h-10 w-full rounded-lg border border-border bg-background px-3 font-mono text-sm tracking-widest outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
          </div>
          <button
            type="submit"
            disabled={joiningWorkspace}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Building2 size={15} />
            {joiningWorkspace ? "참여 중..." : "워크스페이스 참여"}
          </button>
        </div>

        {workspaceJoinMessage && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent">
            <Check size={14} />
            {workspaceJoinMessage}
          </p>
        )}
      </form>

      <form onSubmit={handleSave} className="space-y-5">
        {/* Team name */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            팀 이름
          </label>
          <input
            type="text"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
          />
        </div>

        {/* Industry */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            업종
          </label>
          <input
            type="text"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="예: IT, 교육, 스타트업"
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
          />
        </div>

        {/* Logo */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            팀 로고
          </label>
          <div className="flex items-center gap-3">
            <div className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Workb 팀 로고"
                  className="h-full w-full object-cover"
                />
              ) : (
                <ImageIcon size={18} className="text-muted-foreground" />
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-muted">
                  <Upload size={14} />
                  이미지 업로드
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={handleLogoUpload}
                    className="sr-only"
                  />
                </label>
                <button
                  type="button"
                  onClick={resetLogo}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X size={14} />
                  기본 로고
                </button>
              </div>
              <p className="truncate text-mini text-muted-foreground">
                PNG, JPG, WEBP, GIF 파일을 업로드하세요. 최대 1MB입니다.
              </p>
            </div>
          </div>
        </div>

        {/* Language */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            기본 회의 언어
          </label>
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => setLanguage(lang)}
                className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                  language === lang
                    ? "border-accent bg-accent-subtle text-accent"
                    : "border-border text-muted-foreground hover:border-foreground"
                }`}
              >
                {lang}
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1.5 h-10 px-4 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Save size={14} />{" "}
          {saving ? "저장 중..." : saved ? "저장됨 ✓" : "변경사항 저장"}
        </button>
      </form>

      {isWorkspaceAdmin && (
        <div className="mt-6 rounded-xl border border-red-200/80 bg-red-50/70 p-4 dark:border-red-900/45 dark:bg-red-950/10">
          <div className="mb-3 flex items-start gap-3">
            <Trash2 size={20} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
            <div>
              <h2 className="text-sm font-semibold text-red-700 dark:text-red-300">
                워크스페이스 삭제
              </h2>
              <p className="text-mini text-red-600/90 dark:text-red-300/75">
                워크스페이스, 회의, 멤버십, 연동 정보가 삭제되고 소속 계정은 비활성화됩니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDeleteWorkspace}
            disabled={deleting || saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-300 bg-card px-3 text-sm font-medium text-red-600 transition-colors hover:bg-red-100 dark:border-red-900/60 dark:bg-background dark:text-red-300 dark:hover:bg-red-950/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Trash2 size={14} />
            {deleting ? "삭제 중..." : "워크스페이스 삭제"}
          </button>
        </div>
      )}
    </div>
  );
}
