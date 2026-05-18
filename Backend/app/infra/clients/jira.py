# app\infra\clients\jira.py
import logging
from typing import Any
from .base import BaseClient

logger = logging.getLogger(__name__)

def _to_adf(text: str) -> dict:
    return {
        "type": "doc", "version": 1,
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]
    }

def _from_adf(adf: dict | None) -> str | None:
    if not adf:
        return None
    parts: list[str] = []
    def _walk(node: dict) -> None:
        if node.get("type") == "text":
            parts.append(node.get("text", ""))
        for child in node.get("content", []):
            _walk(child)
    _walk(adf)
    return "\n".join(parts).strip() or None


class JiraClient(BaseClient):
    """
    OAuth 2.0 Token 기반 cloud client
    """
    def __init__(self, access_token: str, cloud_id: str):
        super().__init__(
            base_url = f"https://api.atlassian.com/ex/jira/{cloud_id}/rest/api/3",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        self._issue_type_cache: dict[str, list[dict[str, str]]] = {}
        
    async def get_projects(self, query: str = "") -> list[dict]:
        '''
        지라의 프로젝트를 가져와서 프론트에서 드롭다운으로 보여줄 함수
        50개씩 페이징하여 프로젝트를 모두 가져오는 API를 사용할것이다.
        '''
        all_projects = []
        start_at = 0
        max_results = 50
        is_last = False

        while not is_last:
            # startAt 으로 다음페이지를 요청.
            params = f"startAt={start_at}&maxResults={max_results}&orderBy=name"
            if query:
                params += f"&query={query}"
            data = await self._request(
                "GET", f"/project/search?{params}"
            )

            # 현재 페이지의 프로젝트 목록을 전체 프로젝트에 추가
            values = data.get("values", [])
            all_projects.extend(values)

            # JIRA API가 응답으로 주는 isLast 플래그로 반복 종료
            is_last = data.get("isLast", True)
            start_at += max_results
        
        return all_projects
    
    async def get_project_statuses(self, project_key: str) -> list[str]:
        '''
        project의 status 목록 API 호출
        '''
        data = await self._request("GET", f"/project/{project_key}/statuses")
        statuses: list[str] = []

        # 지라는 이슈 타입을 Epic, Task 별로 묶어서 반환
        for issue_type in data:
            for s in issue_type.get("statuses", []):
                name = s.get("name", "")

                # 중복 제거 (아직 없는 이름만 append)
                if name and name not in statuses:
                    statuses.append(name)

        # ["To Do", "In Progress", "In Review", "Done"] 같은 평탄화된 배열 반환
        return statuses
    
    async def search_user(self, query: str) -> list[dict]:
        """
        accountId로만 유저 정보를 검색하는 함수
        """
        data = await self._request("GET", "/user/search", params={"query": query})
        return data if isinstance(data, list) else []

    async def _get_project_issue_types(self, project_key: str) -> list[dict[str, str]]:
        cached = self._issue_type_cache.get(project_key)
        if cached is not None:
            return cached

        issue_types: list[dict[str, str]] = []

        # 우선 create meta로 생성 가능한 이슈 타입 목록을 조회
        try:
            data = await self._request(
                "GET",
                f"/issue/createmeta/{project_key}/issuetypes",
            )
            values = data.get("issueTypes", []) if isinstance(data, dict) else []
            for item in values:
                issue_type_id = str(item.get("id", "")).strip()
                issue_type_name = str(item.get("name", "")).strip()
                if issue_type_id and issue_type_name:
                    issue_types.append({"id": issue_type_id, "name": issue_type_name})
        except Exception:
            logger.warning("JIRA create meta 조회 실패 project=%s", project_key)

        # fallback: status API에서 이슈 타입 이름/ID 추출
        if not issue_types:
            try:
                statuses = await self._request("GET", f"/project/{project_key}/statuses")
                for row in statuses if isinstance(statuses, list) else []:
                    issue_type = row.get("issueType") or {}
                    issue_type_id = str(issue_type.get("id", "")).strip()
                    issue_type_name = str(issue_type.get("name", "")).strip()
                    if issue_type_id and issue_type_name:
                        pair = {"id": issue_type_id, "name": issue_type_name}
                        if pair not in issue_types:
                            issue_types.append(pair)
            except Exception:
                logger.warning("JIRA project statuses 조회 실패 project=%s", project_key)

        self._issue_type_cache[project_key] = issue_types
        return issue_types

    async def _resolve_issue_type(
        self,
        project_key: str,
        preferred_names: list[str],
    ) -> dict[str, str]:
        issue_types = await self._get_project_issue_types(project_key)
        if not issue_types:
            # 조회 실패 시 기존 기본값 유지 (과거 동작 호환)
            return {"name": preferred_names[0]}

        normalized = {name.lower(): name for name in preferred_names}
        for issue_type in issue_types:
            remote_name = issue_type["name"]
            if remote_name.lower() in normalized:
                return {"id": issue_type["id"]}

        logger.error(
            "JIRA issuetype 매핑 실패 project=%s preferred=%s available=%s",
            project_key,
            preferred_names,
            [it["name"] for it in issue_types],
        )
        raise ValueError(
            f"JIRA 프로젝트({project_key})에서 지원하지 않는 이슈 타입입니다: {preferred_names}"
        )
    
    async def create_epic(self, project_key: str, summary: str) -> str:
        """
        JIRA의 빈 도화지 issue를 만드는 API 호출하는 함수

        쉽게 말하면 나 이슈(도화지)를 만들건데 Epic으로 도장 찍어줘!
        """
        issue_type = await self._resolve_issue_type(
            project_key,
            ["Epic", "에픽"],
        )
        body = {
            "fields": {
                "project": {"key": project_key},
                "summary": summary,
                "issuetype": issue_type,
            }
        }
        data = await self._request("POST", "/issue", json=body)
        return data["key"]
    
    async def create_issue(
            self,
            project_key: str,
            summary: str,
            epic_key: str,
            priority: str = "Medium",
            due_date: str | None = None,
            assignee_account_id: str | None = None,
            description: str | None = None,
    ) -> str:
        '''
        issue 자세히 만드는 함수

        epic_key가 이 이슈(태스크)가 연결될 부모 에픽의 키
        '''
        issue_type = await self._resolve_issue_type(
            project_key,
            ["Task", "Story", "작업", "할 일"],
        )
        # Payload 조립
        fields: dict[str, Any] = {
            "project": {
                "key": project_key,
            },
            "summary": summary,
            "issuetype": issue_type,
            "parent": {
                "key": epic_key
            },
            "priority": {   # 우선 순위(high, medium, low)
                "name": priority
            }
        }

        # Optional 추가
        if due_date:
            fields['duedate'] = due_date

        if assignee_account_id:
            fields['assignee'] = {
                "accountId": assignee_account_id
            }

        if description:
            fields['description'] = _to_adf(description)

        # API 호출
        data = await self._request("POST", "/issue", json={"fields": fields})

        # 성공인 경우 key 반환
        return data['key']

    async def update_issue(self, issue_key: str, fields: dict) -> None:
        await self._request("PUT", f"/issue/{issue_key}", json={"fields": fields})

    async def search_by_jql(self, jql: str, fields: str = "status,summary,assignee,priority") -> list[dict]:
        all_issues = []
        next_page_token = None
        max_results = 100

        while True:
            body: dict = {
                "jql": jql,
                "fields": fields.split(","),
                "maxResults": max_results,
            }
            if next_page_token:
                body["nextPageToken"] = next_page_token

            data = await self._request("POST", "/search/jql", json=body)
            issues = data.get("issues", [])
            all_issues.extend(issues)

            next_page_token = data.get("nextPageToken")
            if not next_page_token or len(issues) < max_results:
                break

        return all_issues

