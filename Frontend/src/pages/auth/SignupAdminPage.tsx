import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { login, signupAdmin } from "../../api/auth";
import { ApiError, setCurrentWorkspaceId } from "../../api/client";
import { useAuth } from "../../context/AuthContext";

type SignupTab = "admin" | "member";

interface SignupAdminPageProps {
  embedded?: boolean;
  onSelectMember?: () => void;
}

function validateAdminSignupForm(
  name: string,
  email: string,
  password: string
): string | null {
  const n = name.trim();
  const em = email.trim();
  if (!n || !em || !password) return "모든 필드를 입력해주세요.";
  if (n.length < 2 || n.length > 30)
    return "이름은 2자 이상 30자 이하여야 합니다.";
  if (password.length < 8 || password.length > 64)
    return "비밀번호는 8자 이상 64자 이하여야 합니다.";
  if (!/[a-zA-Z]/.test(password))
    return "비밀번호에는 영문자가 최소 1개 이상 포함되어야 합니다.";
  if (!/\d/.test(password))
    return "비밀번호에는 숫자가 최소 1개 이상 포함되어야 합니다.";
  return null;
}

export default function SignupAdminPage({ embedded = false, onSelectMember }: SignupAdminPageProps = {}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { saveUser } = useAuth();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validation = validateAdminSignupForm(name, email, password);
    if (validation) {
      setError(validation);
      return;
    }
    if (password !== confirm) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const signup = await signupAdmin({
        name: name.trim(),
        email: email.trim(),
        password,
      });
      setCurrentWorkspaceId(signup.workspace_id);
      sessionStorage.setItem("workb-invite-code", signup.invite_code);
      localStorage.removeItem("workb-invite-code");
      await login({ email: email.trim(), password });
      saveUser({
        id: signup.id,
        email: signup.email,
        name: signup.name,
        role: signup.role,
        workspace_id: signup.workspace_id,
        birth_date: signup.birth_date,
        age: signup.age,
        phone_number: signup.phone_number,
        gender: signup.gender,
      });
      navigate("/onboarding/workspace");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : "관리자 회원가입에 실패했습니다."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md">
      {!embedded && (
        <>
          <h1 className="text-2xl font-bold text-foreground text-center mb-1">
            관리자 회원가입
          </h1>
          <p className="text-sm text-muted-foreground text-center mb-6">
            가입 후 워크스페이스를 생성할 수 있습니다.
          </p>

          <div role="tablist" className="flex rounded-lg bg-muted p-1 mb-6">
            {(["admin", "member"] as SignupTab[]).map((signupTab) => (
              <button
                key={signupTab}
                type="button"
                role="tab"
                aria-selected={signupTab === "admin"}
                onClick={() => {
                  if (signupTab === "member") {
                    if (onSelectMember) onSelectMember();
                    else navigate("/signup/member");
                  }
                }}
                className={clsx(
                  "flex-1 py-1.5 rounded-md text-sm font-medium transition-colors",
                  signupTab === "admin"
                    ? "bg-card shadow text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {signupTab === "admin" ? "관리자" : "멤버"}
              </button>
            ))}
          </div>
        </>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            이름
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="홍길동"
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            이메일
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            비밀번호
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="8자 이상"
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            비밀번호 확인
          </label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
          />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="h-10 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors mt-1 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? "가입 중..." : "회원가입 → 워크스페이스 생성"}
        </button>
      </form>

      {!embedded && (
        <p className="text-center text-sm text-muted-foreground mt-6">
          이미 계정이 있으신가요?{" "}
          <Link to="/login" className="text-accent font-medium hover:underline">
            로그인
          </Link>
        </p>
      )}
    </div>
  );
}
