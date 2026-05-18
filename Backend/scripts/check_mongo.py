import sys

sys.path.insert(0, ".")
from pymongo import MongoClient
from app.core.config import settings

db = MongoClient(settings.MONGODB_URL)["meeting_assistant"]
docs = list(db["meeting_contexts"].find({}, {"_id": 0}))
print("문서 수:", len(docs))
print("내용:", docs)
indexes = list(db["meeting_contexts"].index_information().keys())
print("인덱스:", indexes)
