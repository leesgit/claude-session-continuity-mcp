#!/usr/bin/env python3
"""
Session End Hook v5 for Project Manager MCP

핵심 전략 (v5):
1. 커밋 기반 저장 - 새 커밋이 있을 때만 세션/메모리 저장
2. Unstaged 변경 - active_context만 업데이트 (세션 저장 X, 노이즈 방지)
3. 커밋 해시 추적 - 이미 저장한 커밋은 스킵
4. 메모리 타입 자동 분류 - 커밋 메시지 기반

문제 해결:
- "커밋 안 하면 계속 쌓임" → 커밋 없으면 세션 저장 안 함
- "같은 변경사항 중복" → 커밋 해시로 중복 방지
"""
from __future__ import annotations

import json
import os
import sys
import sqlite3
import subprocess
import re
import hashlib
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Tuple

# 설정
WORKSPACE_ROOT = os.environ.get('WORKSPACE_ROOT', '/Users/ibyeongchang/Documents/dev/ai-service-generator')
DB_PATH = os.path.join(WORKSPACE_ROOT, '.claude', 'sessions.db')
APPS_DIR = os.path.join(WORKSPACE_ROOT, 'apps')

# 저장된 커밋 해시 추적 파일
COMMIT_TRACKER_PATH = os.path.join(WORKSPACE_ROOT, '.claude', 'saved_commits.json')

# 메모리 타입 분류 패턴
MEMORY_TYPE_PATTERNS = {
    'decision': [
        r'결정', r'선택', r'채택', r'하기로', r'으로 정', r'방식으로',
        r'decide', r'choose', r'adopt', r'go with', r'use .+ instead',
        r'architecture', r'아키텍처', r'설계'
    ],
    'error': [
        r'에러', r'오류', r'버그', r'수정', r'fix', r'해결',
        r'error', r'bug', r'crash', r'fail', r'issue',
        r'안됨', r'안 됨', r'문제', r'problem'
    ],
    'pattern': [
        r'패턴', r'규칙', r'컨벤션', r'방식',
        r'pattern', r'convention', r'rule', r'always', r'never',
        r'하면 안', r'해야 함', r'필수', r'주의'
    ],
    'learning': [
        r'배움', r'알게', r'발견', r'깨달',
        r'learn', r'discover', r'realize', r'found out', r'til',
        r'팁', r'tip', r'방법', r'how to'
    ]
}

# 도메인 키워드 매핑
DOMAIN_TAGS = {
    'ui': ['ui', 'ux', '화면', 'screen', '디자인', 'design', '레이아웃', 'layout', '버튼', 'button', '스타일', 'style', 'widget'],
    'api': ['api', '서버', 'server', '요청', 'request', 'response', '통신', 'fetch', 'http', 'endpoint'],
    'state': ['상태', 'state', 'provider', 'riverpod', 'bloc', 'redux', 'store'],
    'auth': ['인증', 'auth', '로그인', 'login', '회원', 'user', '토큰', 'token'],
    'db': ['db', 'database', '데이터베이스', 'sqlite', 'room', 'query'],
    'test': ['테스트', 'test', '검증', 'verify', 'spec'],
    'build': ['빌드', 'build', 'compile', '배포', 'deploy', 'release'],
}

# 스킵할 커밋 메시지 패턴
SKIP_COMMIT_PATTERNS = ['wip', 'temp', 'test commit', 'minor', 'fix typo', 'merge branch', 'initial commit', 'update readme']


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


def run_git_command(args: List[str], cwd: str) -> Optional[str]:
    """Git 명령 실행"""
    try:
        result = subprocess.run(
            ['git'] + args,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=10
        )
        return result.stdout.strip() if result.returncode == 0 else None
    except Exception:
        return None


def get_uncommitted_changes(project_path: str) -> Tuple[List[str], str]:
    """커밋되지 않은 변경 파일 목록 + diff 요약"""
    files = []

    # staged 변경
    staged = run_git_command(['diff', '--name-only', '--cached'], project_path)
    if staged:
        files.extend(f.strip() for f in staged.split('\n') if f.strip())

    # unstaged 변경
    unstaged = run_git_command(['diff', '--name-only'], project_path)
    if unstaged:
        files.extend(f.strip() for f in unstaged.split('\n') if f.strip())

    # untracked 파일
    untracked = run_git_command(['ls-files', '--others', '--exclude-standard'], project_path)
    if untracked:
        files.extend(f.strip() for f in untracked.split('\n') if f.strip())

    files = list(set(files))[:15]  # 중복 제거, 최대 15개

    # diff stat
    diff_stat = run_git_command(['diff', '--stat'], project_path) or ''

    return files, diff_stat


def get_new_commits(project_path: str, saved_commits: Dict) -> List[Dict]:
    """아직 저장하지 않은 새 커밋만 가져오기"""
    project = get_current_project()
    saved_hashes = set(saved_commits.get(project, []))

    # 최근 10개 커밋 확인
    output = run_git_command(
        ['log', '-10', '--pretty=format:%H|%s|%ci'],
        project_path
    )
    if not output:
        return []

    new_commits = []
    for line in output.split('\n'):
        if '|' not in line:
            continue
        parts = line.split('|')
        if len(parts) < 3:
            continue

        commit_hash = parts[0]
        if commit_hash in saved_hashes:
            continue  # 이미 저장한 커밋

        new_commits.append({
            'hash': commit_hash,
            'short_hash': commit_hash[:8],
            'message': parts[1],
            'date': parts[2]
        })

    return new_commits[:3]  # 최대 3개만


def load_saved_commits() -> Dict:
    """저장된 커밋 해시 로드"""
    if os.path.exists(COMMIT_TRACKER_PATH):
        try:
            with open(COMMIT_TRACKER_PATH, 'r') as f:
                return json.load(f)
        except:
            pass
    return {}


def save_commit_hash(project: str, commit_hash: str):
    """커밋 해시 저장 (추적용)"""
    saved = load_saved_commits()
    if project not in saved:
        saved[project] = []

    if commit_hash not in saved[project]:
        saved[project].append(commit_hash)
        # 프로젝트당 최대 100개만 유지
        saved[project] = saved[project][-100:]

    try:
        os.makedirs(os.path.dirname(COMMIT_TRACKER_PATH), exist_ok=True)
        with open(COMMIT_TRACKER_PATH, 'w') as f:
            json.dump(saved, f)
    except:
        pass


def classify_memory_type(text: str) -> str:
    """텍스트에서 메모리 타입 자동 분류"""
    text_lower = text.lower()

    scores = {mtype: 0 for mtype in MEMORY_TYPE_PATTERNS}

    for mtype, patterns in MEMORY_TYPE_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text_lower):
                scores[mtype] += 1

    max_type = max(scores, key=scores.get)
    return max_type if scores[max_type] > 0 else 'observation'


def extract_tags(text: str, files: List[str]) -> List[str]:
    """텍스트와 파일에서 태그 추출"""
    tags = set()
    text_lower = text.lower()

    for domain, keywords in DOMAIN_TAGS.items():
        for keyword in keywords:
            if keyword in text_lower:
                tags.add(domain)
                break

    for f in files:
        ext = Path(f).suffix.lower()
        if ext in ['.dart']:
            tags.add('flutter')
        elif ext in ['.kt', '.java']:
            tags.add('android')
        elif ext in ['.ts', '.tsx', '.js', '.jsx']:
            tags.add('web')
        elif ext in ['.py']:
            tags.add('python')

    return list(tags)[:5]


def should_skip_commit(message: str) -> bool:
    """스킵해야 할 커밋인지 확인"""
    msg_lower = message.lower()
    return any(pattern in msg_lower for pattern in SKIP_COMMIT_PATTERNS)


def update_active_context(project: str, uncommitted_files: List[str], diff_summary: str):
    """활성 컨텍스트만 업데이트 (세션 저장 없이)"""
    if not os.path.exists(DB_PATH):
        return

    if not uncommitted_files:
        return

    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        status = f"Working on: {', '.join(uncommitted_files[:5])}"
        if len(uncommitted_files) > 5:
            status += f" (+{len(uncommitted_files) - 5} more)"

        cursor.execute('''
            INSERT OR REPLACE INTO active_context (project, current_state, recent_files, updated_at)
            VALUES (?, ?, ?, datetime('now'))
        ''', (project, status[:200], json.dumps(uncommitted_files)))

        conn.commit()
        conn.close()
    except Exception as e:
        print(f"<!-- Active context update error: {e} -->", file=sys.stderr)


def save_commit_session(project: str, commit: Dict, files: List[str]):
    """커밋 기반 세션 저장"""
    if not os.path.exists(DB_PATH):
        return None

    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        cursor.execute('''
            INSERT INTO sessions (project, last_work, current_status, modified_files, timestamp)
            VALUES (?, ?, ?, ?, datetime('now'))
        ''', (
            project,
            commit['message'],
            f"Commit: {commit['short_hash']}",
            json.dumps(files) if files else None
        ))

        cursor.execute('''
            INSERT OR REPLACE INTO active_context (project, current_state, recent_files, updated_at)
            VALUES (?, ?, ?, datetime('now'))
        ''', (project, commit['message'][:200], json.dumps(files) if files else None))

        conn.commit()
        session_id = cursor.lastrowid
        conn.close()

        return session_id
    except Exception as e:
        print(f"<!-- Session save error: {e} -->", file=sys.stderr)
        return None


def save_commit_memory(project: str, commit: Dict, files: List[str]):
    """커밋 메시지를 메모리로 저장"""
    if not os.path.exists(DB_PATH):
        return None

    msg = commit['message']
    if len(msg) < 10:
        return None

    memory_type = classify_memory_type(msg)
    tags = extract_tags(msg, files)
    importance = 7 if memory_type in ['decision', 'error'] else 5

    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        # 중복 체크 (같은 커밋 해시)
        cursor.execute('''
            SELECT id FROM memories
            WHERE project = ? AND content LIKE ?
            LIMIT 1
        ''', (project, f'%[{commit["short_hash"]}]%'))

        if cursor.fetchone():
            conn.close()
            return None

        cursor.execute('''
            INSERT INTO memories (content, memory_type, tags, project, importance, created_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
        ''', (
            f"[{commit['short_hash']}] {msg}",
            memory_type,
            json.dumps(tags) if tags else None,
            project,
            importance
        ))

        conn.commit()
        memory_id = cursor.lastrowid
        conn.close()

        return memory_id
    except Exception as e:
        print(f"<!-- Memory save error: {e} -->", file=sys.stderr)
        return None


def main():
    """메인 실행"""
    if os.environ.get('MCP_HOOKS_DISABLED') == 'true':
        return

    project = get_current_project()
    if not project:
        return

    if project.startswith('tools/'):
        project_path = os.path.join(WORKSPACE_ROOT, project)
    else:
        project_path = os.path.join(APPS_DIR, project)

    if not os.path.exists(project_path):
        return

    # 1. 커밋되지 않은 변경 → active_context만 업데이트
    uncommitted_files, diff_summary = get_uncommitted_changes(project_path)
    if uncommitted_files:
        update_active_context(project, uncommitted_files, diff_summary)

    # 2. 새 커밋만 세션/메모리로 저장
    saved_commits = load_saved_commits()
    new_commits = get_new_commits(project_path, saved_commits)

    saved_count = 0
    for commit in new_commits:
        if should_skip_commit(commit['message']):
            # 스킵하더라도 해시는 저장 (다음에 다시 체크 안 하도록)
            save_commit_hash(project, commit['hash'])
            continue

        # 커밋에서 변경된 파일
        commit_files = run_git_command(
            ['diff-tree', '--no-commit-id', '--name-only', '-r', commit['hash']],
            project_path
        )
        files = commit_files.split('\n')[:10] if commit_files else []

        # 세션 저장
        session_id = save_commit_session(project, commit, files)

        # 메모리 저장
        memory_id = save_commit_memory(project, commit, files)

        # 커밋 해시 저장 (추적)
        save_commit_hash(project, commit['hash'])

        if session_id:
            saved_count += 1

    # 결과 출력
    if saved_count > 0:
        print(f"<!-- Auto-saved: {saved_count} commit(s) for {project} -->", file=sys.stderr)
    elif uncommitted_files:
        print(f"<!-- Updated active context: {len(uncommitted_files)} uncommitted file(s) -->", file=sys.stderr)


if __name__ == '__main__':
    main()
