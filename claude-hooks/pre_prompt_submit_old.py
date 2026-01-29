#!/usr/bin/env python3
"""
Pre-prompt Submit Hook for Project Manager MCP
세션 시작 시 자동으로 프로젝트 컨텍스트를 로드합니다.

사용자가 메시지를 보내기 전에 실행되어 관련 컨텍스트를 주입합니다.
"""
from __future__ import annotations

import json
import os
import sys
import sqlite3
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, List, Any

# 설정
WORKSPACE_ROOT = os.environ.get('WORKSPACE_ROOT', '/Users/ibyeongchang/Documents/dev/ai-service-generator')
DB_PATH = os.path.join(WORKSPACE_ROOT, '.claude', 'sessions.db')

def get_current_project() -> Optional[str]:
    """현재 작업 디렉토리에서 프로젝트명 추출"""
    cwd = os.getcwd()

    # apps/ 하위 프로젝트인지 확인
    apps_dir = os.path.join(WORKSPACE_ROOT, 'apps')
    if cwd.startswith(apps_dir):
        relative = os.path.relpath(cwd, apps_dir)
        project = relative.split(os.sep)[0]
        if project and project != '.':
            return project

    # tools/ 하위 프로젝트인지 확인
    tools_dir = os.path.join(WORKSPACE_ROOT, 'tools')
    if cwd.startswith(tools_dir):
        relative = os.path.relpath(cwd, tools_dir)
        project = relative.split(os.sep)[0]
        if project and project != '.':
            return project

    # 루트 디렉토리명 사용
    return os.path.basename(cwd)

def load_context(project: str) -> Optional[Dict[str, Any]]:
    """DB에서 프로젝트 컨텍스트 로드"""
    if not os.path.exists(DB_PATH):
        return None

    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # 고정 컨텍스트
        cursor.execute('SELECT * FROM project_context WHERE project = ?', (project,))
        fixed_row = cursor.fetchone()

        # 활성 컨텍스트
        cursor.execute('SELECT * FROM active_context WHERE project = ?', (project,))
        active_row = cursor.fetchone()

        # 미완료 태스크
        cursor.execute('''
            SELECT id, title, status, priority
            FROM tasks
            WHERE project = ? AND status IN ('pending', 'in_progress')
            ORDER BY priority DESC, created_at DESC
            LIMIT 3
        ''', (project,))
        tasks = cursor.fetchall()

        conn.close()

        if not fixed_row and not active_row:
            return None

        return {
            'project': project,
            'fixed': {
                'techStack': json.loads(fixed_row['tech_stack']) if fixed_row and fixed_row['tech_stack'] else {},
                'architectureDecisions': json.loads(fixed_row['architecture_decisions']) if fixed_row and fixed_row['architecture_decisions'] else [],
                'codePatterns': json.loads(fixed_row['code_patterns']) if fixed_row and fixed_row['code_patterns'] else [],
            },
            'active': {
                'currentState': active_row['current_state'] if active_row and active_row['current_state'] else 'No active context',
                'recentFiles': json.loads(active_row['recent_files']) if active_row and active_row['recent_files'] else [],
                'blockers': active_row['blockers'] if active_row else None,
                'lastVerification': active_row['last_verification'] if active_row else None,
            },
            'pendingTasks': [
                {'id': t['id'], 'title': t['title'], 'status': t['status'], 'priority': t['priority']}
                for t in tasks
            ]
        }
    except Exception as e:
        # 에러 시 조용히 실패
        return None

def format_compact_context(context: dict) -> str:
    """토큰 효율적인 간결한 컨텍스트 포맷"""
    lines = [f"# {context['project']}"]

    # 기술 스택
    if context['fixed']['techStack']:
        stack_str = ', '.join(f"{k}: {v}" for k, v in context['fixed']['techStack'].items())
        lines.append(f"**Stack**: {stack_str}")

    # 아키텍처 결정 (최대 3개)
    if context['fixed']['architectureDecisions']:
        decisions = context['fixed']['architectureDecisions'][:3]
        lines.append(f"**Decisions**: {' | '.join(decisions)}")

    # 현재 상태
    lines.append(f"**State**: {context['active']['currentState']}")

    # 최근 파일 (최대 5개, 파일명만)
    if context['active']['recentFiles']:
        files = [f.split('/')[-1] for f in context['active']['recentFiles'][:5]]
        lines.append(f"**Files**: {', '.join(files)}")

    # 블로커
    if context['active']['blockers']:
        lines.append(f"**Blocker**: {context['active']['blockers']}")

    # 미완료 태스크
    if context['pendingTasks']:
        tasks = [f"[P{t['priority']}] {t['title']}" for t in context['pendingTasks']]
        lines.append(f"**Tasks**: {' | '.join(tasks)}")

    return '\n'.join(lines)

def main():
    """메인 실행"""
    # 환경 변수로 비활성화 가능
    if os.environ.get('MCP_HOOKS_DISABLED') == 'true':
        return

    project = get_current_project()
    if not project:
        return

    context = load_context(project)
    if not context:
        return

    # 간결한 포맷으로 출력 (Claude에 주입됨)
    compact = format_compact_context(context)

    # stdout으로 출력 - Claude가 이를 컨텍스트로 받음
    print(f"\n<project-context>\n{compact}\n</project-context>\n")

if __name__ == '__main__':
    main()
