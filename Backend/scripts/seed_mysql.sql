-- Seed dummy data for meeting_assistant (MySQL 8.0)
-- Policy: keep each table at exactly 3 rows for fast UI verification.
-- Safe to re-run: it clears existing rows in dependent-first order.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- Clear tables (child -> parent)
DELETE FROM minute_photos;
DELETE FROM review_requests;
DELETE FROM meeting_minutes;
DELETE FROM decisions;

DELETE FROM meeting_participants;

DELETE FROM action_items;
DELETE FROM wbs_tasks;
DELETE FROM wbs_epics;
DELETE FROM reports;

DELETE FROM integrations;
DELETE FROM speaker_profiles;
DELETE FROM meetings;

DELETE FROM device_settings;
DELETE FROM invite_codes;
DELETE FROM workspace_members;
DELETE FROM departments;
DELETE FROM workspaces;
DELETE FROM users;

SET FOREIGN_KEY_CHECKS = 1;

-- -------------------------------------------------------------------
-- users
-- -------------------------------------------------------------------
-- NOTE: current schema (app/domains/user/models.py)
-- - no `department`, `social_provider`, `social_id`, `updated_at`
-- - `password_hash` is NOT NULL
INSERT INTO users (id, email, password_hash, name, role, workspace_id, department_id, is_active, created_at) VALUES
  (1, 'user1@example.com', '$2b$10$dummyhash.user1', '김수민', 'admin',  NULL, NULL, 1, DATE_SUB(NOW(), INTERVAL 120 DAY)),
  (2, 'user2@example.com', '$2b$10$dummyhash.user2', '이지현', 'member', NULL, NULL, 1, DATE_SUB(NOW(), INTERVAL  90 DAY)),
  (3, 'user3@example.com', '$2b$10$dummyhash.user3', '박준혁', 'member', NULL, NULL, 1, DATE_SUB(NOW(), INTERVAL  60 DAY)),
  (4, 'user4@example.com', '$2b$10$dummyhash.user4', '최은영', 'member', NULL, NULL, 1, DATE_SUB(NOW(), INTERVAL  50 DAY)),
  (5, 'user5@example.com', '$2b$10$dummyhash.user5', '정민준', 'member', NULL, NULL, 1, DATE_SUB(NOW(), INTERVAL  40 DAY)),
  (6, 'user6@example.com', '$2b$10$dummyhash.user6', '오서연', 'member', NULL, NULL, 1, DATE_SUB(NOW(), INTERVAL  30 DAY));

-- -------------------------------------------------------------------
-- workspaces (3)
-- -------------------------------------------------------------------
INSERT INTO workspaces (id, owner_id, name, industry, default_language, summary_style, logo_url, created_at, updated_at) VALUES
  (1, 1, 'Workspace A', 'SaaS',     'ko', 'bullet', 'https://example.com/logo-a.png', DATE_SUB(NOW(), INTERVAL 100 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY)),
  (2, 2, 'Workspace B', 'Finance',  'en', 'short',  'https://example.com/logo-b.png', DATE_SUB(NOW(), INTERVAL  80 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY)),
  (3, 3, 'Workspace C', 'Retail',   'ko', 'detail', 'https://example.com/logo-c.png', DATE_SUB(NOW(), INTERVAL  60 DAY), DATE_SUB(NOW(), INTERVAL 3 DAY));

-- -------------------------------------------------------------------
-- departments
-- -------------------------------------------------------------------
INSERT INTO departments (id, workspace_id, name, created_at, updated_at) VALUES
  (1, 1, '제품팀', DATE_SUB(NOW(), INTERVAL 100 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY)),
  (2, 1, '디자인팀', DATE_SUB(NOW(), INTERVAL 100 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY)),
  (3, 1, '개발팀', DATE_SUB(NOW(), INTERVAL 100 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY));

-- map a few users to workspace/department for demo screens
UPDATE users SET workspace_id = 1, department_id = 1 WHERE id = 1;
UPDATE users SET workspace_id = 1, department_id = 2 WHERE id = 2;
UPDATE users SET workspace_id = 1, department_id = 3 WHERE id IN (3, 5);
UPDATE users SET workspace_id = 1 WHERE id IN (4, 6);

-- -------------------------------------------------------------------
-- workspace_members (3)
-- -------------------------------------------------------------------
INSERT INTO workspace_members (id, workspace_id, user_id, role, joined_at) VALUES
  (1, 1, 1, 'admin',  DATE_SUB(NOW(), INTERVAL 99 DAY)),
  (2, 2, 2, 'admin',  DATE_SUB(NOW(), INTERVAL 79 DAY)),
  (3, 3, 3, 'admin',  DATE_SUB(NOW(), INTERVAL 59 DAY));

-- additional members for demo UI
INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES
  (1, 2, 'member', DATE_SUB(NOW(), INTERVAL 30 DAY)),
  (1, 3, 'member', DATE_SUB(NOW(), INTERVAL 30 DAY)),
  (1, 4, 'member', DATE_SUB(NOW(), INTERVAL 30 DAY)),
  (1, 5, 'member', DATE_SUB(NOW(), INTERVAL 30 DAY)),
  (1, 6, 'member', DATE_SUB(NOW(), INTERVAL 30 DAY));

-- -------------------------------------------------------------------
-- device_settings (3)  (workspace_id is UNIQUE)
-- -------------------------------------------------------------------
INSERT INTO device_settings (id, workspace_id, device_name, microphone_device, webcam_device, webcam_enabled, updated_at) VALUES
  (1, 1, 'Office PC A', 'Microphone A', 'Webcam A', 1, DATE_SUB(NOW(), INTERVAL 1 DAY)),
  (2, 2, 'Office PC B', 'Microphone B', 'Webcam B', 0, DATE_SUB(NOW(), INTERVAL 2 DAY)),
  (3, 3, 'Office PC C', 'Microphone C', 'Webcam C', 1, DATE_SUB(NOW(), INTERVAL 3 DAY));

-- -------------------------------------------------------------------
-- invite_codes (3)  (code is UNIQUE)
-- -------------------------------------------------------------------
INSERT INTO invite_codes (id, workspace_id, code, role, is_used, used_by, expires_at, created_at) VALUES
  (1, 1, 'INV-A-001', 'member', 0, NULL, DATE_ADD(NOW(), INTERVAL 30 DAY), DATE_SUB(NOW(), INTERVAL 10 DAY)),
  (2, 2, 'INV-B-001', 'viewer', 0, NULL, DATE_ADD(NOW(), INTERVAL 30 DAY), DATE_SUB(NOW(), INTERVAL 11 DAY)),
  (3, 3, 'INV-C-001', 'member', 1, 1,    DATE_ADD(NOW(), INTERVAL 30 DAY), DATE_SUB(NOW(), INTERVAL 12 DAY));

-- -------------------------------------------------------------------
-- integrations (3)
-- -------------------------------------------------------------------
INSERT INTO integrations (id, workspace_id, service, access_token, refresh_token, token_expires_at, extra_config, is_connected, updated_at) VALUES
  (1, 1, 'slack',
    'xoxb-dummy-access-token',
    'xoxb-dummy-refresh-token',
    DATE_ADD(NOW(), INTERVAL 7 DAY),
    JSON_OBJECT('channel','C123','team','workb','botUserId','U123'),
    1,
    DATE_SUB(NOW(), INTERVAL 10 MINUTE)
  ),
  (2, 2, 'jira',
    'jira-dummy-access-token',
    'jira-dummy-refresh-token',
    DATE_ADD(NOW(), INTERVAL 30 DAY),
    JSON_OBJECT('projectKey','WB','instance','https://your-domain.atlassian.net'),
    1,
    DATE_SUB(NOW(), INTERVAL 1 HOUR)
  );

-- -------------------------------------------------------------------
-- meetings (3) — these are what Home dashboard renders as cards
-- -------------------------------------------------------------------
-- NOTE: current schema (app/domains/meeting/models.py) requires `room_name` (NOT NULL, default exists).
INSERT INTO meetings (id, workspace_id, created_by, title, meeting_type, status, room_name, scheduled_at, started_at, ended_at, google_calendar_event_id, created_at, updated_at) VALUES
  (1, 1, 1, 'WS1 Scheduled: Kickoff', 'kickoff', 'scheduled', '미지정',
    DATE_ADD(NOW(), INTERVAL 1 DAY), NULL, NULL,
    'gcal_evt_001',
    DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY)
  ),
  (2, 1, 1, 'WS1 In Progress: Daily Sync', 'daily', 'in_progress', '미지정',
    DATE_SUB(NOW(), INTERVAL 40 MINUTE), DATE_SUB(NOW(), INTERVAL 35 MINUTE), NULL,
    NULL,
    DATE_SUB(NOW(), INTERVAL 1 DAY), DATE_SUB(NOW(), INTERVAL 30 MINUTE)
  ),
  (3, 1, 1, 'WS1 Done: Product Review', 'review', 'done', '미지정',
    DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY) - INTERVAL 50 MINUTE, DATE_SUB(NOW(), INTERVAL 2 DAY),
    NULL,
    DATE_SUB(NOW(), INTERVAL 3 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY)
  );

-- -------------------------------------------------------------------
-- meeting_participants (3)
-- -------------------------------------------------------------------
INSERT INTO meeting_participants (id, meeting_id, user_id, speaker_label, is_host) VALUES
  (1, 1, 1, 'SPEAKER_01', 1),
  (2, 2, 1, 'SPEAKER_01', 1),
  (3, 3, 1, 'SPEAKER_01', 1);

-- -------------------------------------------------------------------
-- speaker_profiles (3)
-- -------------------------------------------------------------------
INSERT INTO speaker_profiles (id, user_id, workspace_id, voice_model_path, diarization_method, is_verified, created_at, updated_at) VALUES
  (1, 1, 1, 'models/voice/user1.bin', 'stereo',      1, DATE_SUB(NOW(), INTERVAL 100 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY)),
  (2, 2, 2, NULL,                    'diarization', 0, DATE_SUB(NOW(), INTERVAL  80 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY)),
  (3, 3, 3, NULL,                    'stereo',      0, DATE_SUB(NOW(), INTERVAL  60 DAY), DATE_SUB(NOW(), INTERVAL 3 DAY));

-- -------------------------------------------------------------------
-- decisions (3)
-- -------------------------------------------------------------------
INSERT INTO decisions (id, meeting_id, content, speaker_id, detected_at, is_confirmed) VALUES
  (1, 1, 'Confirm kickoff scope and stakeholders', 1, DATE_SUB(NOW(), INTERVAL 2 DAY), 1),
  (2, 2, 'Adopt daily sync at 10AM',               1, DATE_SUB(NOW(), INTERVAL 1 DAY), 1),
  (3, 3, 'Ship MVP by end of month',               1, DATE_SUB(NOW(), INTERVAL 2 DAY), 1);

-- -------------------------------------------------------------------
-- meeting_minutes (3)  (meeting_id is UNIQUE)
-- -------------------------------------------------------------------
INSERT INTO meeting_minutes (id, meeting_id, content, summary, status, reviewer_id, review_status, created_at, updated_at) VALUES
  (1, 1,
    'Kickoff minutes\n- Scope agreed\n- Timeline drafted\n- Owners assigned',
    'Kickoff: scope & timeline aligned.',
    'draft',   2, 'pending',
    DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY)
  ),
  (2, 2,
    'Daily sync minutes\n- Blocker: CI failing\n- Next: fix type errors',
    'Daily: blockers captured and assigned.',
    'editing', 2, 'pending',
    DATE_SUB(NOW(), INTERVAL 1 DAY), DATE_SUB(NOW(), INTERVAL 30 MINUTE)
  ),
  (3, 3,
    'Product review minutes\n- Demos\n- Decisions\n- Follow-ups',
    'Review: MVP timeline confirmed.',
    'final',   2, 'approved',
    DATE_SUB(NOW(), INTERVAL 3 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY)
  );

-- -------------------------------------------------------------------
-- minute_photos (3)
-- -------------------------------------------------------------------
INSERT INTO minute_photos (id, minute_id, photo_url, taken_at, taken_by) VALUES
  (1, 1, 'https://example.com/photos/kickoff_1.jpg', DATE_SUB(NOW(), INTERVAL 2 DAY), 1),
  (2, 2, 'https://example.com/photos/daily_1.jpg',   DATE_SUB(NOW(), INTERVAL 1 DAY), 1),
  (3, 3, 'https://example.com/photos/review_1.jpg',  DATE_SUB(NOW(), INTERVAL 2 DAY), 1);

-- -------------------------------------------------------------------
-- review_requests (3)
-- -------------------------------------------------------------------
INSERT INTO review_requests (id, minute_id, requester_id, reviewer_id, notify_slack, notify_kakao, status, requested_at, reviewed_at) VALUES
  (1, 1, 1, 2, 1, 0, 'pending',  DATE_SUB(NOW(), INTERVAL 30 HOUR), NULL),
  (2, 2, 1, 2, 1, 0, 'pending',  DATE_SUB(NOW(), INTERVAL 10 HOUR), NULL),
  (3, 3, 1, 2, 0, 0, 'approved', DATE_SUB(NOW(), INTERVAL 60 HOUR), DATE_SUB(NOW(), INTERVAL 55 HOUR));

-- -------------------------------------------------------------------
-- action_items (3) — dashboard shows only status='pending' for workspace 1
-- -------------------------------------------------------------------
INSERT INTO action_items (id, meeting_id, content, assignee_id, due_date, status, detected_at, jira_issue_id) VALUES
  (1, 1, 'Create initial project plan', 2, DATE_ADD(CURDATE(), INTERVAL 7 DAY),  'pending',     DATE_SUB(NOW(), INTERVAL 2 DAY), 'WB-PLAN-001'),
  (2, 2, 'Fix CI build on main',        1, DATE_ADD(CURDATE(), INTERVAL 1 DAY),  'pending',     DATE_SUB(NOW(), INTERVAL 1 DAY),  'WB-CI-002'),
  (3, 3, 'Write release checklist',     3, DATE_ADD(CURDATE(), INTERVAL 10 DAY), 'done',        DATE_SUB(NOW(), INTERVAL 2 DAY),  'WB-REL-003');

-- -------------------------------------------------------------------
-- wbs_epics (3)
-- -------------------------------------------------------------------
INSERT INTO wbs_epics (id, meeting_id, title, order_index, jira_epic_id) VALUES
  (1, 1, 'Planning',     1, 'WB-EPIC-PLAN-1'),
  (2, 2, 'Execution',    1, 'WB-EPIC-EXEC-2'),
  (3, 3, 'QA & Release', 1, 'WB-EPIC-QA-3');

-- -------------------------------------------------------------------
-- wbs_tasks (3)
-- -------------------------------------------------------------------
INSERT INTO wbs_tasks (id, epic_id, title, assignee_id, priority, due_date, progress, status, jira_issue_id, created_at, updated_at) VALUES
  (1, 1, 'Define requirements', 1, 'high',    DATE_ADD(CURDATE(), INTERVAL 5 DAY),  20, 'in_progress', 'WB-101', DATE_SUB(NOW(), INTERVAL 3 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY)),
  (2, 2, 'Implement API v1',    2, 'medium',  DATE_ADD(CURDATE(), INTERVAL 10 DAY), 40, 'in_progress', 'WB-201', DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY)),
  (3, 3, 'Write test cases',    3, 'medium',  DATE_ADD(CURDATE(), INTERVAL 12 DAY), 10, 'todo',        'WB-301',  DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY));

-- -------------------------------------------------------------------
-- reports (3)
-- -------------------------------------------------------------------
INSERT INTO reports (id, meeting_id, created_by, format, file_url, created_at) VALUES
  (1, 1, 1, 'html', 'https://example.com/reports/meet_1.html',  DATE_SUB(NOW(), INTERVAL 2 DAY)),
  (2, 2, 1, 'pptx', 'https://example.com/reports/meet_2.pptx', DATE_SUB(NOW(), INTERVAL 1 DAY)),
  (3, 3, 1, 'xlsx', 'https://example.com/reports/meet_3.xlsx', DATE_SUB(NOW(), INTERVAL 2 DAY));

