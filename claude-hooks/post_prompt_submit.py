#!/usr/bin/env python3
"""
Post-prompt Submit Hook for Project Manager MCP
세션 중 자동으로 컨텍스트를 업데이트합니다.

사용자 메시지 처리 후 실행되어 활성 컨텍스트를 갱신합니다.
(현재는 최소 구현 - 필요시 확장)
"""
from __future__ import annotations

import json
import os
import sys
import sqlite3
from pathlib import Path
from datetime import datetime
from typing import Optional

# 설정
WORKSPACE_ROOT = os.environ.get('WORKSPACE_ROOT', '/Users/ibyeongchang/Documents/dev/ai-service-generator')
DB_PATH = os.path.join(WORKSPACE_ROOT, '.claude', 'sessions.db')

def get_current_project() -> Optional[str]:
    """현재 작업 디렉토리에서 프로젝트명 추출"""
    cwd = os.getcwd()

    apps_dir = os.path.join(WORKSPACE_ROOT, 'apps')
    if cwd.startswith(apps_dir):
        relative = os.path.relpath(cwd, apps_dir)
        project = relative.split(os.sep)[0]
        if project and project != '.':
            return project

    tools_dir = os.path.join(WORKSPACE_ROOT, 'tools')
    if cwd.startswith(tools_dir):
        relative = os.path.relpath(cwd, tools_dir)
        project = relative.split(os.sep)[0]
        if project and project != '.':
            return project

    return os.path.basename(cwd)

def update_session_timestamp(project: str):
    """세션 타임스탬프 업데이트 (활동 추적)"""
    if not os.path.exists(DB_PATH):
        return

    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        # 활성 컨텍스트 타임스탬프만 업데이트
        cursor.execute('''
            UPDATE active_context
            SET updated_at = CURRENT_TIMESTAMP
            WHERE project = ?
        ''', (project,))

        conn.commit()
        conn.close()
    except Exception:
        pass

def main():
    """메인 실행"""
    if os.environ.get('MCP_HOOKS_DISABLED') == 'true':
        return

    project = get_current_project()
    if not project:
        return

    # 세션 활동 기록
    update_session_timestamp(project)

    # 조용히 완료 (출력 없음)

if __name__ == '__main__':
    main()
