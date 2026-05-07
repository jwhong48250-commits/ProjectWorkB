import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import SignupAdminPage from './SignupAdminPage'
import SignupMemberPage from './SignupMemberPage'

type SignupRole = 'member' | 'admin'

function getInitialRole(role: string | null): SignupRole {
  return role === 'admin' ? 'admin' : 'member'
}

export default function SignupPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const role = getInitialRole(searchParams.get('role'))

  function selectRole(nextRole: SignupRole) {
    const invite = searchParams.get('invite')
    const params = new URLSearchParams({ role: nextRole })
    if (invite) params.set('invite', invite)
    navigate(`/signup?${params.toString()}`, { replace: true })
  }

  return (
    <div className="w-full max-w-md">
      <h1 className="text-2xl font-bold text-foreground text-center mb-1">
        {role === 'admin' ? '관리자 회원가입' : '멤버 회원가입'}
      </h1>
      <p className="text-sm text-muted-foreground text-center mb-6">
        {role === 'admin'
          ? '가입 후 워크스페이스를 생성할 수 있습니다.'
          : '관리자에게 받은 초대코드로 가입하세요.'}
      </p>

      <div role="tablist" aria-label="회원가입 유형" className="flex rounded-lg bg-muted p-1 mb-6">
        {(['member', 'admin'] as SignupRole[]).map((signupRole) => (
          <button
            key={signupRole}
            type="button"
            role="tab"
            aria-selected={role === signupRole}
            onClick={() => selectRole(signupRole)}
            className={clsx(
              'flex-1 py-1.5 rounded-md text-sm font-medium transition-colors',
              role === signupRole
                ? 'bg-card shadow text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {signupRole === 'member' ? '멤버' : '관리자'}
          </button>
        ))}
      </div>

      {role === 'admin' ? (
        <SignupAdminPage embedded onSelectMember={() => selectRole('member')} />
      ) : (
        <SignupMemberPage embedded onSelectAdmin={() => selectRole('admin')} />
      )}

      <p className="text-center text-sm text-muted-foreground mt-6">
        이미 계정이 있으신가요?{' '}
        <Link to="/login" className="text-accent font-medium hover:underline">
          로그인
        </Link>
      </p>
    </div>
  )
}
