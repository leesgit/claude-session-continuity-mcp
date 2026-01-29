#!/usr/bin/env python3
"""
Pre-prompt Submit Hook v4 for Project Manager MCP

핵심 변경 (v4):
- MCP v5의 새로운 prompts 컨텍스트와 동일한 풍부한 정보 제공
- 메모리, 에러 솔루션까지 포함
- 토큰 효율성 유지하면서 최대한 유용한 정보 제공
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
APPS_DIR = os.path.join(WORKSPACE_ROOT, 'apps')


def get_current_project() -> Optional[str]:
    """현재 작업 디렉토리에서 프로젝트명 추출"""
    cwd = os.getcwd()

    # apps/ 하위 프로젝트인지 확인
    if cwd.startswith(APPS_DIR):
        relative = os.path.relpath(cwd, APPS_DIR)
        project = relative.split(os.sep)[0]
        if project and project != '.':
            return project

    # tools/ 하위 프로젝트인지 확인
    tools_dir = os.path.join(WORKSPACE_ROOT, 'tools')
    if cwd.startswith(tools_dir):
        relative = os.path.relpath(cwd, tools_dir)
        project = relative.split(os.sep)[0]
        if project and project != '.':
            return f"tools/{project}"

    return None


def load_full_context(project: str) -> Optional[Dict[str, Any]]:
    """DB에서 프로젝트 전체 컨텍스트 로드 (v4: 메모리, 솔루션 포함)"""
    if not os.path.exists(DB_PATH):
        return None

    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # 1. 고정 컨텍스트 (기술스택, 아키텍처 결정)
        cursor.execute('SELECT * FROM project_context WHERE project = ?', (project,))
        fixed_row = cursor.fetchone()

        # 2. 활성 컨텍스트 (현재 상태)
        cursor.execute('SELECT * FROM active_context WHERE project = ?', (project,))
        active_row = cursor.fetchone()

        # 3. 최근 세션 (마지막 작업)
        cursor.execute('''
            SELECT last_work as summary, current_status as work_done, next_tasks as next_steps, timestamp
            FROM sessions
            WHERE project = ?
            ORDER BY timestamp DESC LIMIT 1
        ''', (project,))
        last_session = cursor.fetchone()

        # 4. 미완료 태스크
        cursor.execute('''
            SELECT id, title, status, priority
            FROM tasks
            WHERE project = ? AND status IN ('pending', 'in_progress')
            ORDER BY priority DESC, created_at DESC
            LIMIT 5
        ''', (project,))
        tasks = cursor.fetchall()

        # 5. 최근 솔루션 (에러 해결 이력)
        recent_solutions = []
        try:
            cursor.execute('''
                SELECT error_signature, solution
                FROM solutions
                WHERE project = ?
                ORDER BY created_at DESC LIMIT 3
            ''', (project,))
            recent_solutions = cursor.fetchall()
        except:
            pass

        # 6. 중요 메모리 (v4 신규)
        important_memories = []
        try:
            cursor.execute('''
                SELECT id, content, memory_type, importance
                FROM memories
                WHERE project = ?
                ORDER BY importance DESC, created_at DESC
                LIMIT 5
            ''', (project,))
            important_memories = cursor.fetchall()
        except:
            pass

        conn.close()

        # 컨텍스트가 없으면 None
        if not fixed_row and not active_row and not last_session:
            return None

        return {
            'project': project,
            'fixed': {
                'techStack': json.loads(fixed_row['tech_stack']) if fixed_row and fixed_row['tech_stack'] else {},
                'architectureDecisions': json.loads(fixed_row['architecture_decisions']) if fixed_row and fixed_row['architecture_decisions'] else [],
                'notes': fixed_row['special_notes'] if fixed_row else None
            } if fixed_row else None,
            'active': {
                'currentState': active_row['current_state'] if active_row else None,
                'recentFiles': json.loads(active_row['recent_files']) if active_row and active_row['recent_files'] else [],
                'blockers': active_row['blockers'] if active_row else None,
                'lastVerification': active_row['last_verification'] if active_row else None,
            } if active_row else None,
            'lastSession': {
                'summary': last_session['summary'],
                'workDone': last_session['work_done'],
                'nextSteps': json.loads(last_session['next_steps']) if last_session['next_steps'] else [],
                'timestamp': last_session['timestamp']
            } if last_session else None,
            'pendingTasks': [
                {'id': t['id'], 'title': t['title'], 'status': t['status'], 'priority': t['priority']}
                for t in tasks
            ],
            'recentSolutions': [
                {'error': s['error_signature'], 'solution': s['solution'][:80] + '...' if len(s['solution']) > 80 else s['solution']}
                for s in recent_solutions
            ] if recent_solutions else [],
            'importantMemories': [
                {'type': m['memory_type'], 'content': m['content'][:100] + '...' if len(m['content']) > 100 else m['content'], 'importance': m['importance']}
                for m in important_memories
            ] if important_memories else []
        }
    except Exception as e:
        print(f"<!-- Context load error: {e} -->", file=sys.stderr)
        return None


def format_rich_context(context: dict) -> str:
    """풍부하지만 토큰 효율적인 컨텍스트 포맷 (v4)"""
    lines = [f"# 🚀 {context['project']} Context\n"]

    # 기술 스택
    if context.get('fixed') and context['fixed'].get('techStack'):
        stack = context['fixed']['techStack']
        stack_str = ', '.join(f"**{k}**: {v}" for k, v in stack.items() if v)
        if stack_str:
            lines.append(f"## Tech Stack")
            lines.append(stack_str)
            lines.append('')

    # 현재 상태
    if context.get('active') and context['active'].get('currentState'):
        lines.append(f"## Current State")
        lines.append(f"📍 {context['active']['currentState']}")
        if context['active'].get('blockers'):
            lines.append(f"🚧 **Blocker**: {context['active']['blockers']}")
        if context['active'].get('lastVerification'):
            v = context['active']['lastVerification']
            emoji = '✅' if 'passed' in v else '❌'
            lines.append(f"{emoji} Last verify: {v}")
        lines.append('')

    # 마지막 세션
    if context.get('lastSession'):
        session = context['lastSession']
        lines.append(f"## Last Session ({session['timestamp'][:10]})")
        lines.append(f"**Work**: {session['summary']}")
        if session.get('nextSteps'):
            lines.append(f"**Next**: {' → '.join(session['nextSteps'][:3])}")
        lines.append('')

    # 미완료 태스크
    if context.get('pendingTasks'):
        lines.append(f"## 📋 Pending Tasks")
        for task in context['pendingTasks'][:5]:
            icon = '🔄' if task['status'] == 'in_progress' else '⏳'
            lines.append(f"- {icon} [P{task['priority']}] {task['title']} (#{task['id']})")
        lines.append('')

    # 중요 메모리 (v4 신규)
    if context.get('importantMemories'):
        type_icons = {
            'observation': '👀',
            'decision': '🎯',
            'learning': '📚',
            'error': '⚠️',
            'pattern': '🔄'
        }
        lines.append(f"## 🧠 Key Memories")
        for mem in context['importantMemories'][:5]:
            icon = type_icons.get(mem['type'], '💭')
            lines.append(f"- {icon} [{mem['type']}] {mem['content']}")
        lines.append('')

    # 최근 에러 솔루션
    if context.get('recentSolutions'):
        lines.append(f"## 🔧 Recent Error Solutions")
        for sol in context['recentSolutions'][:3]:
            lines.append(f"- **{sol['error']}**: {sol['solution']}")
        lines.append('')

    # 작업 지침
    lines.append("---")
    lines.append("_Auto-injected by MCP v5. Use `session_end` when done._")

    return '\n'.join(lines)


def main():
    """메인 실행 - 프로젝트 컨텍스트 자동 주입"""

    # 환경 변수로 비활성화 가능
    if os.environ.get('MCP_HOOKS_DISABLED') == 'true':
        return

    # 프로젝트 감지
    project = get_current_project()
    if not project:
        return

    # 컨텍스트 로드
    context = load_full_context(project)
    if not context:
        # 새 프로젝트 - 초기화 안내 (간결하게)
        print(f"\n<project-context project=\"{project}\" status=\"new\">\nNew project. Use `project_init` to enable context tracking.\n</project-context>\n")
        return

    # 풍부한 포맷으로 주입
    rich_context = format_rich_context(context)

    # stdout으로 출력 - Claude가 이를 컨텍스트로 받음
    print(f"\n<project-context project=\"{project}\">\n{rich_context}\n</project-context>\n")


if __name__ == '__main__':
    main()
