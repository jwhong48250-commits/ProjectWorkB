# app/utils/time_utils.py
from datetime import datetime, timezone, timedelta

KST = timezone(timedelta(hours=9))

def now_kst() -> datetime:
    """
    한국 시간 반환.
    """
    return datetime.now(KST)