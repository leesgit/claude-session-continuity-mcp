#!/usr/bin/env python3
"""
Session End Hook v3 for Project Manager MCP

핵심 변경:
- Git 변경사항 자동 감지
- 최근 커밋 메시지에서 작업 내용 추출
- DB에 자동 저장 (Claude 호출 불필요)
"""
from __future__ import annotations

import json
import os
import sys
import sqlite3
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Optional, List

# 설정
WORKSPACE_ROOT = os.environ.get('WORKSPACE_ROOT', '/Users/ibyeongchang/Documents/dev/ai-service-generator')
DB_PATH = os.path.join(WORKSPACE_ROOT, '.claude', 'sessions.db')
APPS_DIR = os.path.join(WORKSPACE_ROOT, 'apps')


def get_current_project() -> Optional[str]:
    """현재 작업 디렉토리에서 프로젝트명 추출"""
    cwd = os.getcwd()

    if cwd.startswith(APPS_DIR):
        relative = os.path.relpath(cwd, APPS_DIR)
        project = relative.split(os.sep)[0]
        if project and project != '.':
            return project

    tools_dir = os.path.join(WORKSPACE_ROOT, 'tools')
    if cwd.startswith(tools_dir):
        relative = os.path.relpath(cwd, tools_dir)
        project = relative.split(os.sep)[0]
        if project and project != '.':
            return f"tools/{project}"

    return None


def run_git_command(cmd: str, cwd: str) -> Optional[str]:
    """Git 명령 실행"""
    try:
        result = subprocess.run(
            cmd.split(),
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=10
        )
        return result.stdout.strip() if result.returncode == 0 else None
    except Exception:
        return None


def get_git_changes(project_path: str) -> List[str]:
    """Git에서 변경된 파일 목록 가져오기"""
    # Staged + Unstaged 변경
    output = run_git_command('git diff --name-only HEAD', project_path)
    if not output:
        output = run_git_command('git status --porcelain', project_path)
        if output:
            files = []
            for line in output.split('\n'):
                if line.strip():
                    # 상태 코드 제거 (예: "M  file.ts" -> "file.ts")
                    files.append(line[3:].strip())
            return files[:10]  # 최대 10개
        return []

    return output.split('\n')[:10]


def get_recent_commit_message(project_path: str) -> Optional[str]:
    """최근 커밋 메시지 가져오기"""
    return run_git_command('git log -1 --pretty=%B', project_path)


def auto_save_session(project: str, project_path: str):
    """세션 자동 저장"""
    if not os.path.exists(DB_PATH):
        return

    # 변경된 파일
    changed_files = get_git_changes(project_path)

    # 최근 커밋 메시지 (작업 요약으로 사용)
    commit_msg = get_recent_commit_message(project_path)

    # 저장할 내용이 없으면 스킵
    if not changed_files and not commit_msg:
        return

    summary = commit_msg[:100] if commit_msg else f"Modified {len(changed_files)} files"

    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        # 세션 저장
        cursor.execute('''
            INSERT INTO sessions (project, summary, modified_files, timestamp)
            VALUES (?, ?, ?, datetime('now'))
        ''', (project, summary, json.dumps(changed_files) if changed_files else None))

        # 활성 컨텍스트 업데이트
        cursor.execute('''
            INSERT OR REPLACE INTO active_context (project, current_state, recent_files, updated_at)
            VALUES (?, ?, ?, datetime('now'))
        ''', (project, summary, json.dumps(changed_files) if changed_files else None))

        conn.commit()
        conn.close()

        print(f"<!-- Session auto-saved for {project} -->", file=sys.stderr)
    except Exception as e:
        print(f"<!-- Session save error: {e} -->", file=sys.stderr)


def main():
    """메인 실행"""
    # stdin에서 hook 데이터 읽기
    try:
        input_data = json.load(sys.stdin)
    except Exception:
        input_data = {}

    # 환경 변수로 비활성화 가능
    if os.environ.get('MCP_HOOKS_DISABLED') == 'true':
        return

    # 프로젝트 감지
    project = get_current_project()
    if not project:
        return

    # 프로젝트 경로
    if project.startswith('tools/'):
        project_path = os.path.join(WORKSPACE_ROOT, project)
    else:
        project_path = os.path.join(APPS_DIR, project)

    if not os.path.exists(project_path):
        return

    # 자동 저장
    auto_save_session(project, project_path)

    # 사용자에게 세션 종료 안내 (선택적)
    # 너무 자주 표시하면 피로하므로 조건부 표시
    # print(f"\n💾 Session saved for {project}\n")


if __name__ == '__main__':
    main()
