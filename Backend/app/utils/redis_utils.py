# app/utils/redis_utils.py
import redis
import json
from motor.motor_asyncio import AsyncIOMotorClient
from app.domains.knowledge.repository import get_user_name_by_id
from app.core.config import settings

mongo_db = AsyncIOMotorClient(settings.MONGODB_URL)["meeting_assistant"]

r = redis.asyncio.from_url(settings.REDIS_URL)

def _resolve_speaker(speaker_id: str | None, speakers: dict, anon_map: dict) -> str:
    """
    speaker_id(spk_01 형식) → 표시 이름 변환.                                            
    speakers hash: Field=spk_01, Value=user.id → DB에서 이름 조회.                       
    매칭 실패 화자는 speakers hash에 없으므로 순번 화자명 부여.
    """
    # 케이스 1: 화자 정보 자체가 없음
    if not speaker_id:
        return "알 수 없음"
    
    # 케이스 2: speakers hash에서 user.id 조회
    if speaker_id in speakers:
        user_id = int(speakers[speaker_id])
        name = get_user_name_by_id(user_id) # MySQL users 테이블 조회
        return name if name else f"사용자{user_id}"

    # 케이스 3: speaker_id는 있지만 이름 미등록 -> 순번 화자명 부여
    if speaker_id not in anon_map:
        anon_map[speaker_id] = f"화자{len(anon_map) + 1}"
    return anon_map[speaker_id]

async def get_latest_utterance(meeting_id: int) -> str:
    """
    meeting:{id}:latest — 화자분리 미확정 최신 발화 텍스트 반환.
    ASR 스트리밍 중 가장 최근에 인식된 텍스트 (final=False 상태).                        
    없으면 빈 문자열 반환.                                                               
    """
    val = await r.get(f"meeting:{meeting_id}:latest")
    return val.decode() if val else ""

# get_meeting_context, get_related_utterance는 await 
async def get_meeting_context(meeting_id: int) -> str:
    """
    전체 발화를 "[이름] 내용" 형태 문자열로 반환.
    
    화자 분리가 불안전한 발화도 "알 수 없음" / "화자N"으로 표기해
    summary_node가 내용 중심으로 처리할 수 있게 한다.
    """
    utterances_raw = await r.lrange(f"meeting:{meeting_id}:utterances", 0, -1)
    speakers = {
        k.decode(): v.decode()
        for k, v in (await r.hgetall(f"meeting:{meeting_id}:speakers")).items()
    }
    anon_map: dict = {} # 미명명 화자 순번 공유용 - 루프 전체에서 재사용
    lines = []
    for u in utterances_raw:
        utterance = json.loads(u)
        # speaker.id 키가 없는 발화도 .get()으로 안전하게 처리
        name = _resolve_speaker(utterance.get("speaker_id"), speakers, anon_map)
        lines.append(f"[{name}] {utterance['content']}")
    return "\n".join(lines)


async def get_related_utterance(meeting_id: int, seq: int | None) -> str:
    """
    seq 기준 단일 발화 반환. vision 캡처 시점 맥락용.
    
    seq가 None이거나 범위를 벗어나면 빈 문자열 반환.
    화자분리 실패 처리는 get_meeting_context()와 동일 로직 적용.
    """
    if seq is None:
        return ""

    utterances_raw = await r.lrange(f"meeting:{meeting_id}:utterances", 0, -1)
    if seq >= len(utterances_raw):
        return ""
    
    speakers = {
        k.decode(): v.decode()
        for k, v in (await r.hgetall(f"meeting:{meeting_id}:speakers")).items()
    }

    utterance = json.loads(utterances_raw[seq])
    # 단일 발화이므로 anon_map은 로컬 생성으로 충분
    name = _resolve_speaker(utterance.get("speaker_id"), speakers, {})
    return f"[{name}] {utterance['content']}"

async def get_past_meeting_context(meeting_id: int) -> str:
    """MongoDB meeting_contexts에서 이전 회의 컨텍스트 가져오기"""
    doc = await mongo_db["meeting_contexts"].find_one({"meeting_id": meeting_id})
    if doc:
        return doc.get("summary", "")
    return ""

async def is_meeting_live(meeting_id: int) -> bool:
    """
    Redis에 utterances가 있으면 회의 중(True), 없으면 회의 후(False)
    
    STT 딜레이 고지 여부를 결정하는데 사용.
    회의 종료 후 Redis TTL 만료되면 자동으로 False 반환.    
    """
    count = await r.llen(f"meeting:{meeting_id}:utterances")
    return count > 0

async def clear_meeting_context(meeting_id: int) -> None:
    """
    회의 종료 시 partial_summary 캐시 명시적 삭제.

    utterances/speakers는 24h TTL로 자동 만료되지만
    partial_summary는 회의 종료 즉시 불필요하므로 바로 삭제.
    """
    await r.delete(f"meeting:{meeting_id}:partial_summary")