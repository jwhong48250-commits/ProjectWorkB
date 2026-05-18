# app\domains\vision\repository.py
from pymongo import MongoClient
from app.utils.time_utils import now_kst
from app.core.config import settings

mongo_db = MongoClient(settings.MONGODB_URL)["meeting_assistant"]

def save_analysis(meeting_id: int, data: dict, file_url: str) -> None:
    mongo_db["screen_share_analyses"].insert_one({
        "meeting_id": meeting_id,
        "file_url": file_url,
        "ocr_text": data.get("ocr_text", ""),
        "chart_description": data.get("chart_description", ""),
        "key_points": data.get("key_points", []),
        "timestamp": now_kst()
    })

def get_analyses(meeting_id: int) -> list[dict]:
    cursor = mongo_db["screen_share_analyses"].find(
        {"meeting_id": meeting_id},
        {"_id": 0}
    ).sort("timestamp", -1)

    results = []
    for doc in cursor:
        doc["id"] = str(doc.pop("_id")) # ObjectId to str
        results.append(doc)
    return results