#!/usr/bin/env python3
"""
Claude Code SessionStart Hook v3
세션 시작 시 DB에서 컨텍스트를 직접 로드하여 주입합니다.
(v2: "호출하세요" 지시 → v3: 직접 주입)
"""

import json
import sys
import os
import sqlite3

WORKSPACE_ROOT = os.environ.get('WORKSPACE_ROOT', '/Users/ibyeongchang/Documents/dev/ai-service-generator')
DB_PATH = os.path.join(WORKSPACE_ROOT, '.claude', 'sessions.db')
APPS_DIR = os.path.join(WORKSPACE_ROOT, 'apps')


def get_project_from_cwd(cwd: str):
    """cwd에서 프로젝트명 추출"""
    if "/apps/" in cwd:
        parts = cwd.split("/apps/")
        if len(parts) > 1:
            return parts[1].split("/")[0]
    if "/tools/" in cwd:
        parts = cwd.split("/tools/")
        if len(parts) > 1:
            return parts[1].split("/")[0]
    return None


def load_context(project: str):
    """DB에서 컨텍스트 직접 로드"""
    if not os.path.exists(DB_PATH):
        return None

    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()

        # 고정 컨텍스트
        c.execute('SELECT tech_stack FROM project_context WHERE project = ?', (project,))
        fixed = c.fetchone()

        # 활성 컨텍스트
        c.execute('SELECT current_state, blockers FROM active_context WHERE project = ?', (project,))
        active = c.fetchone()

        # 최근 세션
        c.execute('SELECT last_work, next_tasks FROM sessions WHERE project = ? ORDER BY timestamp DESC LIMIT 1', (project,))
        last = c.fetchone()

        # 미완료 태스크
        c.execute('''
            SELECT title, priority FROM tasks
            WHERE project = ? AND status IN ('pending', 'in_progress')
            ORDER BY priority DESC LIMIT 3
        ''', (project,))
        tasks = c.fetchall()

        conn.close()

        if not fixed and not active and not last:
            return None

        lines = [f"# {project} - Session Resumed"]

        if fixed and fixed['tech_stack']:
            stack = json.loads(fixed['tech_stack'])
            lines.append(f"**Stack**: {', '.join(f'{k}: {v}' for k, v in stack.items())}")

        if active and active['current_state']:
            lines.append(f"**State**: {active['current_state']}")

        if last and last['last_work']:
            lines.append(f"**Last**: {last['last_work']}")

        if last and last['next_tasks']:
            next_steps = json.loads(last['next_tasks'])
            if next_steps:
                lines.append(f"**Next**: {' → '.join(next_steps[:3])}")

        if tasks:
            task_list = [f"[P{t['priority']}] {t['title']}" for t in tasks]
            lines.append(f"**Tasks**: {' | '.join(task_list)}")

        if active and active['blockers']:
            lines.append(f"**Blocker**: {active['blockers']}")

        return '\n'.join(lines)

    except Exception:
        return None


def main():
    try:
        input_data = json.load(sys.stdin)
        cwd = input_data.get("cwd", os.getcwd())

        project = get_project_from_cwd(cwd)
        if not project:
            return

        context = load_context(project)
        if context:
            print(f"\n<session-context project=\"{project}\">\n{context}\n</session-context>\n")
        else:
            print(f"\n[Session] Project: {project} (no context yet - use project_init to set up)\n")

        sys.exit(0)

    except Exception as e:
        print(f"Hook error: {e}", file=sys.stderr)
        sys.exit(0)


if __name__ == "__main__":
    main()
