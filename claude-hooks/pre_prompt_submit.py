#!/usr/bin/env python3
"""
Pre-prompt Submit Hook v5 for Project Manager MCP

핵심 변경 (v5):
- 쿼리 기반 관련 메모리 자동 주입 (Zero re-explanation)
- 시맨틱 검색으로 사용자 질문과 관련된 메모리/솔루션 자동 매칭
- FTS + 키워드 기반 폴백 (임베딩 없이도 작동)
- 토큰 효율성 유지
"""
from __future__ import annotations

import json
import os
import sys
import sqlite3
import re
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, List, Any, Tuple

# 설정
WORKSPACE_ROOT = os.environ.get('WORKSPACE_ROOT', '/Users/ibyeongchang/Documents/dev/ai-service-generator')
DB_PATH = os.path.join(WORKSPACE_ROOT, '.claude', 'sessions.db')
APPS_DIR = os.path.join(WORKSPACE_ROOT, 'apps')

# 쿼리 관련성 키워드 매핑 (도메인별)
KEYWORD_PATTERNS = {
    'error': ['에러', 'error', 'bug', '버그', 'fix', '수정', '안됨', '실패', 'fail', 'crash', '오류'],
    'ui': ['ui', 'ux', '화면', 'screen', '디자인', 'design', '레이아웃', 'layout', '버튼', 'button', '스타일', 'style'],
    'api': ['api', '서버', 'server', '요청', 'request', 'response', '통신', 'fetch', 'http'],
    'state': ['상태', 'state', 'provider', 'riverpod', 'bloc', '데이터', 'data'],
    'navigation': ['네비게이션', 'navigation', '라우팅', 'routing', '이동', 'navigate', 'route'],
    'auth': ['인증', 'auth', '로그인', 'login', '회원', 'user', '토큰', 'token'],
    'test': ['테스트', 'test', '검증', 'verify', 'spec'],
}


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


def get_user_query() -> Optional[str]:
    """stdin에서 사용자 쿼리 읽기 (Hook은 stdin으로 프롬프트를 받음)"""
    try:
        if not sys.stdin.isatty():
            return sys.stdin.read().strip()
    except:
        pass
    return None


def extract_keywords(text: str) -> List[str]:
    """텍스트에서 주요 키워드 추출"""
    if not text:
        return []

    # 소문자 변환
    text_lower = text.lower()

    found_categories = []
    for category, patterns in KEYWORD_PATTERNS.items():
        for pattern in patterns:
            if pattern in text_lower:
                found_categories.append(category)
                break

    # 일반 키워드 추출 (2글자 이상, 한글/영문)
    words = re.findall(r'[가-힣]{2,}|[a-zA-Z]{3,}', text)
    keywords = [w.lower() for w in words if len(w) >= 2]

    return list(set(found_categories + keywords))


def search_relevant_memories(conn: sqlite3.Connection, project: str, query: str, limit: int = 5) -> List[Dict]:
    """쿼리와 관련된 메모리 검색 (FTS + 키워드 매칭)"""
    if not query:
        return []

    cursor = conn.cursor()
    keywords = extract_keywords(query)

    if not keywords:
        return []

    results = []
    seen_ids = set()

    # 1. FTS5 전체 텍스트 검색
    try:
        fts_query = ' OR '.join(keywords[:5])  # 상위 5개 키워드만
        cursor.execute('''
            SELECT m.id, m.content, m.memory_type, m.importance, m.tags
            FROM memories m
            JOIN memories_fts fts ON m.id = fts.rowid
            WHERE memories_fts MATCH ? AND (m.project = ? OR m.project = 'global')
            ORDER BY m.importance DESC, m.created_at DESC
            LIMIT ?
        ''', (fts_query, project, limit))

        for row in cursor.fetchall():
            if row[0] not in seen_ids:
                seen_ids.add(row[0])
                results.append({
                    'id': row[0],
                    'content': row[1],
                    'type': row[2],
                    'importance': row[3],
                    'tags': row[4],
                    'match_type': 'fts'
                })
    except Exception as e:
        pass  # FTS 실패 시 폴백

    # 2. LIKE 폴백 검색 (FTS 결과 부족 시)
    if len(results) < limit:
        remaining = limit - len(results)
        for keyword in keywords[:3]:
            if len(results) >= limit:
                break
            try:
                cursor.execute('''
                    SELECT id, content, memory_type, importance, tags
                    FROM memories
                    WHERE (project = ? OR project = 'global')
                      AND (content LIKE ? OR tags LIKE ?)
                    ORDER BY importance DESC, created_at DESC
                    LIMIT ?
                ''', (project, f'%{keyword}%', f'%{keyword}%', remaining))

                for row in cursor.fetchall():
                    if row[0] not in seen_ids:
                        seen_ids.add(row[0])
                        results.append({
                            'id': row[0],
                            'content': row[1],
                            'type': row[2],
                            'importance': row[3],
                            'tags': row[4],
                            'match_type': 'keyword'
                        })
            except:
                pass

    return results[:limit]


def search_relevant_solutions(conn: sqlite3.Connection, project: str, query: str, limit: int = 3) -> List[Dict]:
    """쿼리와 관련된 에러 솔루션 검색"""
    if not query:
        return []

    cursor = conn.cursor()
    keywords = extract_keywords(query)

    # 에러 관련 키워드가 있을 때만 솔루션 검색
    error_keywords = ['에러', 'error', 'bug', '버그', 'fix', '수정', '실패', 'fail', 'crash', '오류', '안됨']
    has_error_context = any(k in query.lower() for k in error_keywords)

    if not has_error_context and 'error' not in [k for k in keywords]:
        return []

    results = []
    seen_ids = set()

    for keyword in keywords[:5]:
        if len(results) >= limit:
            break
        try:
            cursor.execute('''
                SELECT id, error_signature, error_message, solution
                FROM solutions
                WHERE (project = ? OR project IS NULL)
                  AND (error_signature LIKE ? OR error_message LIKE ? OR solution LIKE ? OR keywords LIKE ?)
                ORDER BY created_at DESC
                LIMIT ?
            ''', (project, f'%{keyword}%', f'%{keyword}%', f'%{keyword}%', f'%{keyword}%', limit))

            for row in cursor.fetchall():
                if row[0] not in seen_ids:
                    seen_ids.add(row[0])
                    results.append({
                        'id': row[0],
                        'signature': row[1],
                        'message': row[2][:100] if row[2] else None,
                        'solution': row[3]
                    })
        except:
            pass

    return results[:limit]


def load_full_context(project: str, user_query: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """DB에서 프로젝트 전체 컨텍스트 로드 (v5: 쿼리 기반 관련 메모리 자동 매칭)"""
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

        # ===== v5 신규: 쿼리 기반 관련 메모리/솔루션 검색 =====
        relevant_memories = []
        relevant_solutions = []

        if user_query:
            # 쿼리와 관련된 메모리 검색
            relevant_memories = search_relevant_memories(conn, project, user_query, limit=5)
            # 쿼리와 관련된 솔루션 검색
            relevant_solutions = search_relevant_solutions(conn, project, user_query, limit=3)

        # 쿼리 기반 결과가 없으면 중요도 기반 폴백
        if not relevant_memories:
            try:
                cursor.execute('''
                    SELECT id, content, memory_type, importance, tags
                    FROM memories
                    WHERE project = ? OR project = 'global'
                    ORDER BY importance DESC, accessed_at DESC
                    LIMIT 5
                ''', (project,))
                for row in cursor.fetchall():
                    relevant_memories.append({
                        'id': row[0],
                        'content': row[1],
                        'type': row[2],
                        'importance': row[3],
                        'tags': row[4],
                        'match_type': 'importance'
                    })
            except:
                pass

        if not relevant_solutions:
            try:
                cursor.execute('''
                    SELECT id, error_signature, error_message, solution
                    FROM solutions
                    WHERE project = ? OR project IS NULL
                    ORDER BY created_at DESC LIMIT 3
                ''', (project,))
                for row in cursor.fetchall():
                    relevant_solutions.append({
                        'id': row[0],
                        'signature': row[1],
                        'message': row[2][:100] if row[2] else None,
                        'solution': row[3]
                    })
            except:
                pass

        conn.close()

        # 컨텍스트가 없으면 None
        if not fixed_row and not active_row and not last_session:
            return None

        return {
            'project': project,
            'userQuery': user_query,  # v5: 쿼리 저장
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
            # v5: 쿼리 기반 관련 메모리 (match_type 포함)
            'relevantMemories': [
                {
                    'type': m['type'],
                    'content': m['content'][:150] + '...' if len(m['content']) > 150 else m['content'],
                    'importance': m['importance'],
                    'matchType': m.get('match_type', 'unknown')
                }
                for m in relevant_memories
            ],
            # v5: 쿼리 기반 관련 솔루션
            'relevantSolutions': [
                {
                    'error': s['signature'],
                    'solution': s['solution'][:120] + '...' if len(s['solution']) > 120 else s['solution']
                }
                for s in relevant_solutions
            ]
        }
    except Exception as e:
        print(f"<!-- Context load error: {e} -->", file=sys.stderr)
        return None


def format_rich_context(context: dict) -> str:
    """풍부하지만 토큰 효율적인 컨텍스트 포맷 (v5: 쿼리 관련성 강조)"""
    lines = [f"# 🚀 {context['project']} Context\n"]

    # v5: 쿼리 기반 관련 메모리가 있으면 최상단에 표시
    has_query_match = context.get('relevantMemories') and any(
        m.get('matchType') in ('fts', 'keyword') for m in context['relevantMemories']
    )

    if has_query_match:
        lines.append("## 🎯 Related to Your Query")
        type_icons = {
            'observation': '👀',
            'decision': '🎯',
            'learning': '📚',
            'error': '⚠️',
            'pattern': '🔄'
        }
        for mem in context['relevantMemories'][:3]:
            if mem.get('matchType') in ('fts', 'keyword'):
                icon = type_icons.get(mem['type'], '💭')
                lines.append(f"- {icon} {mem['content']}")
        lines.append('')

    # v5: 쿼리 관련 솔루션
    if context.get('relevantSolutions'):
        lines.append("## 🔧 Relevant Solutions")
        for sol in context['relevantSolutions'][:2]:
            lines.append(f"- **{sol['error']}**: {sol['solution']}")
        lines.append('')

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

    # 중요도 기반 메모리 (쿼리 매칭이 없을 때만)
    if not has_query_match and context.get('relevantMemories'):
        type_icons = {
            'observation': '👀',
            'decision': '🎯',
            'learning': '📚',
            'error': '⚠️',
            'pattern': '🔄'
        }
        lines.append(f"## 🧠 Key Memories")
        for mem in context['relevantMemories'][:5]:
            icon = type_icons.get(mem['type'], '💭')
            lines.append(f"- {icon} [{mem['type']}] {mem['content']}")
        lines.append('')

    # 작업 지침
    lines.append("---")
    lines.append("_Auto-injected by MCP v5. Context matched to your query._")

    return '\n'.join(lines)


def main():
    """메인 실행 - 프로젝트 컨텍스트 자동 주입 (v5: 쿼리 기반)"""

    # 환경 변수로 비활성화 가능
    if os.environ.get('MCP_HOOKS_DISABLED') == 'true':
        return

    # 프로젝트 감지
    project = get_current_project()
    if not project:
        return

    # v5: 사용자 쿼리 읽기 (stdin에서)
    user_query = get_user_query()

    # 컨텍스트 로드 (쿼리 기반 관련 메모리 검색 포함)
    context = load_full_context(project, user_query)
    if not context:
        # 새 프로젝트 - 초기화 안내 (간결하게)
        print(f"\n<project-context project=\"{project}\" status=\"new\">\nNew project. Use `project_init` to enable context tracking.\n</project-context>\n")
        return

    # 풍부한 포맷으로 주입
    rich_context = format_rich_context(context)

    # stdout으로 출력 - Claude가 이를 컨텍스트로 받음
    # v5: 쿼리 매칭 여부 표시
    has_match = context.get('relevantMemories') and any(
        m.get('matchType') in ('fts', 'keyword') for m in context['relevantMemories']
    )
    match_status = 'query-matched' if has_match else 'default'

    print(f"\n<project-context project=\"{project}\" match=\"{match_status}\">\n{rich_context}\n</project-context>\n")


if __name__ == '__main__':
    main()
