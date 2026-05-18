# app/infra/clients/slack.py
import logging
from typing import Dict, Any, List, Optional
from .base import BaseClient
import re

logger = logging.getLogger(__name__)

class SlackClient(BaseClient):
    """
    Slack API 직접 호출 클라이언트
    integrations 테이블의 access_token(bot_token) 사용
    """
    def __init__(self, bot_token: str):
        super().__init__(
            base_url="https://slack.com/api",
            headers={
                "Authorization": f"Bearer {bot_token}",
                "Content-Type": "application/json; charset=utf-8",
            }
        )

    async def _check_slack_error(self, response_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Slack의 http 200 + ok : False 에러 확인
        """
        if not response_data.get("ok"):
            error_code = response_data.get("error", "unknown_error")
            logger.error(f"[Slack API Error] -> {error_code}")
            raise ValueError(f"Slack API Error -. {error_code}")
        return response_data
        
    async def get_public_channels(self) -> List[Dict[str, str]]:
        """
        드롭다운 용 공개 체널 목록 조회
        """
        result = await self._request(
            "GET", "/conversations.list",
            params = {
                "types": "public_channel",
                "exclude_archived": "true"
            }
        )

        result = await self._check_slack_error(result)

        channels = []
        for c in result.get('channels', []):
            channels.append({
                "id": c['id'],
                "name": c['name']
            })
        return channels

    async def send_message(
            self, 
            channel_id: str, 
            text: str, 
            blocks: Optional[List[Dict]] = None,
            thread_ts: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Slack 채널에 메세지 전송

        args:
            channel: 채널 ID
            text: 메시지 본문
            blocks: Block Kit 블록 리스트
            thread_ts : 회의록 스레드에 달기
        """
        payload: Dict[str, Any] = {
            "channel": channel_id,
            "text": text
        }
        if blocks:
            payload['blocks'] = blocks

        if thread_ts:
            payload['thread_ts'] = thread_ts
        
        result = await self._request("POST", "/chat.postMessage", json=payload)
        return await self._check_slack_error(result)
    
    async def get_channel_members(self, channel_id: str) -> List[str]:
        """
        채널 내 멤버 user_id 목록 조회
        """
        result = await self._request(
            "GET", "/conversations.members",
            params={
                "channel": channel_id
            }
        )
        result = await self._check_slack_error(result)
        return result.get("members", [])
    
    async def get_user_info(self, user_id: str) -> Dict[str, Any]:
        """
        user_id로 유저 정보 조회
        """
        result = await self._request(
            "GET", "/users.info",
            params={
                "user": user_id
            }
        )
        result = await self._check_slack_error(result)
        return {
            "id": user_id,
            "name": result['user']['real_name'],
            "email": result['user']['profile'].get("email", "")
        }
    
    async def send_dm_to_workspace_member(
            self,
            channel_id: str,
            workb_email: str,
            text: str,
    ) -> Dict[str, Any]:
        """
        WorkB DB에 이메일 있으면 채널 멤버와 매핑 후 DM 전송.!
        채널에 없으면 ValueError 발생.

        args: 
            channel_id : 채널 ID
            workb_email : 워크비 DB에 있는 users.email
            text : 보낼 메세지
        """
        # 1. 채널 멤버 목록 조회
        member_ids = await self.get_channel_members(channel_id)

        # 2. 채널에 있는 모든 사용자 이메일 조회
        slack_user_id = None
        for uid in member_ids:
            info = await self.get_user_info(uid)
            if info['email'] == workb_email:
                slack_user_id = uid
                break

        if not slack_user_id:
            raise ValueError(f"채널에서 {workb_email} 유저를 찾을 수 없습니다.")
        
        # DM 전송
        dm_channel_id = await self.open_dm(slack_user_id)
        return await self.send_message(channel_id=dm_channel_id, text=text)

    async def open_dm(self, user_id: str) -> str:
        """
        DM 채널 만들고, 채널 ID 반환
        """
        result = await self._request(
            "POST", "/conversations.open", json={"users": [user_id]}
        )
        result = await self._check_slack_error(result)
        return result['channel']['id']
    
    def _markdown_to_slack_blocks(self, text: str) -> list:
        blocks = []
        sections = re.split(r'\n(?=## )', text.strip())

        for section in sections:
            lines = section.strip().split("\n")
            if not lines:
                continue
            
            first_line = lines[0]
            rest = "\n".join(lines[1:]).strip()

            if first_line.startswith("## "):
                header = first_line[3:].strip()
                blocks.append({
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*{header}*"
                    }
                })
                if rest:
                    # 줄의 시작이 ### 이고, 뒤에오는 모든 문자를**로 감싸겠다.
                    content = re.sub(r'^### (.+)$', r'*\1*', rest, flags=re.MULTILINE)
                    blocks.append({
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": content[:3000]
                        }
                    })
                else:
                    if section.strip():
                        blocks.append({
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": section.strip()[:3000]
                            }
                        })
        return blocks
                            

    async def send_minutes(
            self,
            channel_id: str,
            meeting_title: str,
            minutes_text: str,
            action_items: Optional[List[str]] = None,
            link_url: Optional[str] = None,
            wbs_url: Optional[str] = None,
            jira_url: Optional[str] = None,
            thread_ts: Optional[str] = None,
    ) -> str:
        """
        회의록을 Slack Block Kit 형식으로 전송.

        args:
            channel : 채널명
            meeting_title: 회의 제목
            minutes_text: 회의록 내용
            action_items: 액션 아이템 리스트 (선택)
            link_url: 서비스 내 회의록 링크 (선택)
            thread_ts: 스레드에 달기 (선택)

        왜 ts를 반환하나: Slack은 메시지를 보낼 때 ts(타임스탬프)를 응답으로
        줍니다. 이 ts가 메시지의 고유 ID 역할을 해서, 나중에 WBS나 액션아이템을 이 메시지의 스레드로 달 때 thread_ts로 넘겨야 합니다.
        """
        blocks: List[Dict[str, Any]] = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": f"{meeting_title}",
                }
            },
            {
                "type": "divider"
            },
            *self._markdown_to_slack_blocks(minutes_text),
        ]

        if action_items:
            action_text = "\n".join(f"• {item}" for item in action_items)
            blocks += [
                {
                    "type": "divider"
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"액션 아이템\n{action_text}"
                    }
                }
            ]
        
        # 딥링크 버튼
        buttons = []
        if link_url:
            buttons.append({
                "type": "button",
                "text": {"type": "plain_text", "text": "📋 회의록 보기"},
                "url": link_url,
                "style": "primary",
            })
        if wbs_url:
            buttons.append({
                "type": "button",
                "text": {"type": "plain_text", "text": "📊 WBS 보기"},
                "url": wbs_url,
            })
        if jira_url:
            buttons.append({
                "type": "button",
                "text": {"type": "plain_text", "text": "🔵 JIRA 이슈 보기"},
                "url": jira_url,
            })

        if buttons:
            blocks.append({"type": "actions", "elements": buttons})
        
        result = await self.send_message(
            channel_id=channel_id,
            text=f"[{meeting_title}] 회의록이 도착했습니다.",
            blocks=blocks,
            thread_ts=thread_ts
        )
        return result['ts'] 

    async def pin_message(self, channel_id: str, message_ts: str) -> None:
        """
        메시지를 채널에 핀 고정.

        args:
            channel_id: 채널 ID
            message_ts: 핀 고정할 메시지의 ts
        """
        result = await self._request(
            "POST", "/pins.add",
            json = {
                "channel": channel_id,
                "timestamp": message_ts
            }
        )
        await self._check_slack_error(result)

    async def send_action_items(
            self,
            channel_id: str,
            thread_ts: str,
            action_items: List[Dict[str, str]],
    ) -> None:
        """
        액션 아이템을 스레드에 멘션하고, 담당자에게 DM 전송

        args:
            channel_id: 채널 ID
            thread_ts: 쓰레드 타임스탬프
            action_items: [{
                "slack_user_id": "U123",
                "task": "슬랙 액션 아이템 DM 전송",
                "due": "5/10"
            }]
        """
        for item in action_items:
            slack_user_id = item['slack_user_id']
            task = item['task']
            due = item.get("due", "미정")

            # 1. 스레드에 멘션
            await self.send_message(
                channel_id=channel_id,
                text=f"<@{slack_user_id}> {task} (기한: {due})",
                thread_ts=thread_ts
            )

            # 2. 담당자에게 DM
            dm_channel_id = await self.open_dm(slack_user_id)
            await self.send_message(
                channel_id=dm_channel_id,
                text=f"담당 태스크가 배정되었습니다.\n• {task}\n• 기한: {due}"
            )
    
    async def schedule_message(
            self,
            channel_id: str,
            text: str,
            post_at: int,
    ) -> str:
        """
        메시지 예약 전송.

        args:
            channel_id: 채널 ID
            text: 메세지
            post_at: 전송 시각(Unix timestamp, 초단위) 현재 시각보다 최소 60초 이후

        returns:
            scheduled_message_id - 취소 시 chat.deleteScheduleMessage에 사용
        """
        result = await self._request(
            "POST", "/chat.scheduleMessage",
            json={
                "channel": channel_id,
                "text": text,
                "post_at": post_at,
            }
        )
        result = await self._check_slack_error(result)
        return result['scheduled_message_id']

    async def join_channel(self, channel_id: str) -> None:
        """
        봇을 채널에 연동하게 되면 참여.
        pin_message 전 호출.
        """
        result = await self._request(
            "POST", "/conversations.join",
            json= {
                "channel": channel_id
            }
        )
        await self._check_slack_error(result)