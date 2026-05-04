import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { login, signupAdmin } from "../../api/auth";
import { ApiError, setCurrentWorkspaceId } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import BirthDateSelect from "../../components/auth/BirthDateSelect";

type SignupTab = "admin" | "member";
type SignupGender = "male" | "female";
type Gender = SignupGender | "";

function calculateAge(birthDate: string): number {
  const birth = new Date(`${birthDate}T00:00:00`);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}

function validateAdminSignupForm(
  name: string,
  email: string,
  password: string,
  birthDate: string,
  phoneNumber: string,
  gender: Gender
): string | null {
  const n = name.trim();
  const em = email.trim();
  const phoneDigits = phoneNumber.replace(/\D/g, "");
  if (!n || !em || !password || !birthDate || !phoneNumber.trim() || !gender) return "모든 필드를 입력해주세요.";
  if (n.length < 2 || n.length > 30)
    return "이름은 2자 이상 30자 이하여야 합니다.";
  const age = calculateAge(birthDate);
  if (!Number.isFinite(age) || age < 0 || age > 120)
    return "생년월일을 다시 확인해주세요.";
  if (!/^[\d+\-\s()]+$/.test(phoneNumber.trim()) || phoneDigits.length < 9 || phoneDigits.length > 15)
    return "전화번호는 숫자 기준 9자 이상 15자 이하로 입력해주세요.";
  if (password.length < 8 || password.length > 64)
    return "비밀번호는 8자 이상 64자 이하여야 합니다.";
  if (!/[a-zA-Z]/.test(password))
    return "비밀번호에는 영문자가 최소 1개 이상 포함되어야 합니다.";
  if (!/\d/.test(password))
    return "비밀번호에는 숫자가 최소 1개 이상 포함되어야 합니다.";
  return null;
}

export default function SignupAdminPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [gender, setGender] = useState<Gender>("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { saveUser } = useAuth();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validation = validateAdminSignupForm(name, email, password, birthDate, phoneNumber, gender);
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
        birth_date: birthDate,
        phone_number: phoneNumber.trim(),
        gender: gender as SignupGender,
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
              if (signupTab === "member") navigate("/signup/member");
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
            생년월일
          </label>
          <BirthDateSelect value={birthDate} onChange={setBirthDate} />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            전화번호
          </label>
          <input
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="010-1234-5678"
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            성별
          </label>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="성별">
            {[
              { value: "female", label: "여성" },
              { value: "male", label: "남성" },
            ].map((option) => (
              <label
                key={option.value}
                className={clsx(
                  "flex h-10 cursor-pointer items-center justify-center rounded-lg border text-sm font-medium transition-colors",
                  gender === option.value
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <input
                  type="radio"
                  name="gender"
                  value={option.value}
                  checked={gender === option.value}
                  onChange={() => setGender(option.value as SignupGender)}
                  className="sr-only"
                />
                {option.label}
              </label>
            ))}
          </div>
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

      <p className="text-center text-sm text-muted-foreground mt-6">
        이미 계정이 있으신가요?{" "}
        <Link to="/login" className="text-accent font-medium hover:underline">
          로그인
        </Link>
      </p>
    </div>
  );
}
