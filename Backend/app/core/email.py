import logging
import smtplib
from email.message import EmailMessage
from email.utils import formataddr
from html import escape

from app.core.config import settings


logger = logging.getLogger(__name__)


def _sender() -> str | None:
    if not settings.SMTP_FROM_EMAIL:
        return None
    return formataddr((settings.SMTP_FROM_NAME, settings.SMTP_FROM_EMAIL))


def send_email(to_email: str, subject: str, text_body: str, html_body: str | None = None) -> bool:
    """
    SMTP 설정이 있는 환경에서 메일을 발송합니다.
    설정이 없거나 발송이 실패해도 호출 흐름은 중단하지 않고 False를 반환합니다.
    """
    sender = _sender()
    if not settings.SMTP_HOST or not sender:
        logger.info("Email delivery skipped because SMTP_HOST or SMTP_FROM_EMAIL is not configured.")
        return False

    message = EmailMessage()
    message["From"] = sender
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(text_body)
    if html_body:
        message.add_alternative(html_body, subtype="html")

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as smtp:
            if settings.SMTP_USE_TLS:
                smtp.starttls()
            if settings.SMTP_USERNAME and settings.SMTP_PASSWORD:
                smtp.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            smtp.send_message(message)
    except Exception:
        logger.exception("Failed to send email to %s", to_email)
        return False

    return True


def send_admin_signup_welcome_email(
    to_email: str,
    name: str,
    workspace_name: str,
    invite_code: str,
) -> bool:
    if not settings.ADMIN_SIGNUP_EMAIL_ENABLED:
        return False

    login_url = f"{settings.FRONTEND_URL.rstrip('/')}/login"
    safe_name = escape(name)
    safe_workspace_name = escape(workspace_name)
    safe_invite_code = escape(invite_code)
    safe_login_url = escape(login_url, quote=True)
    subject = "Workb에 오신 것을 환영합니다"
    text_body = (
        f"{name}님, Workb 워크스페이스가 준비되었습니다.\n\n"
        f"워크스페이스: {workspace_name}\n"
        f"초대코드: {invite_code}\n"
        f"로그인: {login_url}\n"
        "\n이 초대코드를 팀원에게 공유하면 멤버가 워크스페이스에 참여할 수 있습니다.\n"
    )
    html_body = f"""
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
      <h2 style="margin:0 0 12px">Workb에 오신 것을 환영합니다</h2>
      <p>{safe_name}님, 관리자 계정과 워크스페이스가 준비되었습니다.</p>
      <div style="padding:16px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb">
        <p style="margin:0 0 8px"><strong>워크스페이스</strong>: {safe_workspace_name}</p>
        <p style="margin:0"><strong>초대코드</strong>: <code>{safe_invite_code}</code></p>
      </div>
      <p>팀원에게 초대코드를 공유하면 같은 워크스페이스에 참여할 수 있습니다.</p>
      <p><a href="{safe_login_url}" style="color:#4f46e5">Workb 로그인하기</a></p>
    </div>
    """

    return send_email(to_email, subject, text_body, html_body)


def send_workspace_invite_email(
    to_email: str,
    workspace_name: str,
    invite_code: str,
    role_label: str,
) -> bool:
    signup_url = f"{settings.FRONTEND_URL.rstrip('/')}/signup/member?invite={invite_code}"
    safe_workspace_name = escape(workspace_name)
    safe_invite_code = escape(invite_code)
    safe_role_label = escape(role_label)
    safe_signup_url = escape(signup_url, quote=True)
    subject = f"{workspace_name} 워크스페이스 초대"
    text_body = (
        f"Workb {workspace_name} 워크스페이스에 초대되었습니다.\n\n"
        f"초대 권한: {role_label}\n"
        f"초대코드: {invite_code}\n"
        f"가입 링크: {signup_url}\n"
    )
    html_body = f"""
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
      <h2 style="margin:0 0 12px">Workb 워크스페이스 초대</h2>
      <p><strong>{safe_workspace_name}</strong> 워크스페이스에 초대되었습니다.</p>
      <div style="padding:16px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb">
        <p style="margin:0 0 8px"><strong>초대 권한</strong>: {safe_role_label}</p>
        <p style="margin:0"><strong>초대코드</strong>: <code>{safe_invite_code}</code></p>
      </div>
      <p>아래 링크에서 초대코드를 확인하고 멤버 회원가입을 진행해주세요.</p>
      <p><a href="{safe_signup_url}" style="color:#4f46e5">Workb 워크스페이스 참여하기</a></p>
    </div>
    """

    return send_email(to_email, subject, text_body, html_body)


def send_password_reset_email(to_email: str, name: str, reset_url: str) -> bool:
    safe_name = escape(name)
    safe_reset_url = escape(reset_url, quote=True)
    subject = "Workb 비밀번호 재설정 안내"
    text_body = (
        f"{name}님, Workb 비밀번호 재설정 요청이 접수되었습니다.\n\n"
        f"아래 링크에서 새 비밀번호를 설정해주세요.\n{reset_url}\n\n"
        f"이 링크는 {settings.PASSWORD_RESET_TOKEN_MINUTES}분 동안 사용할 수 있습니다.\n"
    )
    html_body = f"""
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
      <h2 style="margin:0 0 12px">비밀번호 재설정</h2>
      <p>{safe_name}님, Workb 비밀번호 재설정 요청이 접수되었습니다.</p>
      <p>아래 링크에서 새 비밀번호를 설정해주세요.</p>
      <p><a href="{safe_reset_url}" style="color:#4f46e5">새 비밀번호 설정하기</a></p>
      <p style="color:#6b7280;font-size:13px">이 링크는 {settings.PASSWORD_RESET_TOKEN_MINUTES}분 동안 사용할 수 있습니다.</p>
    </div>
    """

    return send_email(to_email, subject, text_body, html_body)
