#!/usr/bin/env python3
"""
Session Start Hook v5 - 시맨틱 검색 + 다단계 메모리 검색

mcp-memory-service 스타일 구현 + 시맨틱 검색 추가:
1. Phase 0: 시맨틱 검색 (Git 키워드 기반 임베딩 유사도)
2. Phase 1: 최근 메모리 (7일 이내)
3. Phase 2: 중요 태그 (decision, error, architecture)
4. Phase 3: 폴백 (일반 프로젝트 컨텍스트)

목표: Zero re-explanation - 세션 시작 시 관련 컨텍스트 자동 주입
시맨틱 검색: MCP 서버에서 생성한 임베딩(embeddings_v4)을 활용한 코사인 유사도
"""
from __future__ import annotations

import json
import sys
import os
import sqlite3
import subprocess
import re
import struct
import math
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Tuple

WORKSPACE_ROOT = os.environ.get('WORKSPACE_ROOT', '/Users/ibyeongchang/Documents/dev/ai-service-generator')
DB_PATH = os.path.join(WORKSPACE_ROOT, '.claude', 'sessions.db')
APPS_DIR = os.path.join(WORKSPACE_ROOT, 'apps')

# 메모리 슬롯 배분 (총 12개 - 시맨틱 검색 추가)
SLOT_CONFIG = {
    'semantic': 3,         # 시맨틱 검색 (임베딩 유사도)
    'git_related': 2,      # Git 커밋 관련 (FTS)
    'recent': 3,           # 최근 7일
    'important': 2,        # 중요 태그
    'fallback': 2          # 일반 컨텍스트
}

# 중요 태그
IMPORTANT_TAGS = ['decision', 'error', 'architecture', 'critical', 'important']

# 임베딩 차원 (all-MiniLM-L6-v2)
EMBEDDING_DIM = 384


def bytes_to_float_array(data: bytes) -> List[float]:
    """바이트 데이터를 float 배열로 변환"""
    if not data:
        return []
    # Float32Array 형식으로 저장됨
    count = len(data) // 4
    return list(struct.unpack(f'{count}f', data))


def cosine_similarity(a: List[float], b: List[float]) -> float:
    """코사인 유사도 계산"""
    if len(a) != len(b) or len(a) == 0:
        return 0.0

    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))

    if norm_a == 0 or norm_b == 0:
        return 0.0

    return dot / (norm_a * norm_b)


def get_average_embedding(conn: sqlite3.Connection, memory_ids: List[int]) -> Optional[List[float]]:
    """여러 메모리의 평균 임베딩 계산"""
    cursor = conn.cursor()
    embeddings = []

    for mid in memory_ids[:10]:  # 최대 10개만
        cursor.execute('''
            SELECT embedding FROM embeddings_v4
            WHERE entity_type = 'memory' AND entity_id = ?
        ''', (mid,))
        row = cursor.fetchone()
        if row and row[0]:
            emb = bytes_to_float_array(row[0])
            if len(emb) == EMBEDDING_DIM:
                embeddings.append(emb)

    if not embeddings:
        return None

    # 평균 계산
    avg = [0.0] * EMBEDDING_DIM
    for emb in embeddings:
        for i in range(EMBEDDING_DIM):
            avg[i] += emb[i]

    for i in range(EMBEDDING_DIM):
        avg[i] /= len(embeddings)

    return avg


def search_semantic_memories(conn: sqlite3.Connection, project: str, keywords: List[str], limit: int) -> List[Dict]:
    """시맨틱 검색: 키워드 관련 메모리의 임베딩으로 유사한 메모리 검색"""
    cursor = conn.cursor()

    # 1. 키워드로 시드 메모리 찾기 (FTS)
    seed_ids = []
    if keywords:
        try:
            fts_query = ' OR '.join(keywords[:5])
            cursor.execute('''
                SELECT m.id FROM memories m
                JOIN memories_fts fts ON m.id = fts.rowid
                WHERE memories_fts MATCH ? AND m.project = ?
                LIMIT 5
            ''', (fts_query, project))
            seed_ids = [row[0] for row in cursor.fetchall()]
        except:
            pass

    # 시드가 없으면 최근 중요 메모리 사용
    if not seed_ids:
        cursor.execute('''
            SELECT id FROM memories
            WHERE project = ? AND (memory_type IN ('decision', 'error') OR importance >= 7)
            ORDER BY created_at DESC LIMIT 5
        ''', (project,))
        seed_ids = [row[0] for row in cursor.fetchall()]

    if not seed_ids:
        return []

    # 2. 시드 메모리들의 평균 임베딩 계산
    query_embedding = get_average_embedding(conn, seed_ids)
    if not query_embedding:
        return []

    # 3. 모든 프로젝트 메모리와 유사도 계산
    cursor.execute('''
        SELECT m.id, m.content, m.memory_type, m.importance, m.created_at, m.tags, e.embedding
        FROM memories m
        JOIN embeddings_v4 e ON e.entity_type = 'memory' AND e.entity_id = m.id
        WHERE m.project = ? AND m.id NOT IN ({})
    '''.format(','.join('?' * len(seed_ids))), (project, *seed_ids))

    results = []
    for row in cursor.fetchall():
        if not row[6]:
            continue
        emb = bytes_to_float_array(row[6])
        if len(emb) != EMBEDDING_DIM:
            continue

        similarity = cosine_similarity(query_embedding, emb)
        results.append({
            'id': row[0],
            'content': row[1],
            'type': row[2],
            'importance': row[3],
            'created_at': row[4],
            'tags': row[5],
            'source': 'semantic',
            'similarity': similarity
        })

    # 유사도 순 정렬
    results.sort(key=lambda x: x['similarity'], reverse=True)
    return results[:limit]


def get_project_from_cwd(cwd: str) -> Optional[str]:
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


def run_git_command(args: List[str], cwd: str) -> Optional[str]:
    """Git 명령 실행"""
    try:
        result = subprocess.run(
            ['git'] + args,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=5
        )
        return result.stdout.strip() if result.returncode == 0 else None
    except:
        return None


def extract_git_keywords(project_path: str) -> List[str]:
    """최근 커밋에서 키워드 추출"""
    keywords = set()

    # 최근 5개 커밋 메시지
    output = run_git_command(['log', '-5', '--pretty=%s'], project_path)
    if output:
        for line in output.split('\n'):
            # 의미 있는 단어 추출 (3글자 이상)
            words = re.findall(r'[가-힣]{2,}|[a-zA-Z]{3,}', line)
            keywords.update(w.lower() for w in words)

    # 최근 변경 파일 기반 키워드
    output = run_git_command(['diff', '--name-only', 'HEAD~3..HEAD'], project_path)
    if output:
        for f in output.split('\n'):
            if f:
                # 파일 경로에서 키워드
                parts = f.replace('/', ' ').replace('_', ' ').replace('-', ' ').split()
                keywords.update(p.lower() for p in parts if len(p) >= 3)

    return list(keywords)[:20]  # 최대 20개


def search_memories_by_keywords(conn: sqlite3.Connection, project: str, keywords: List[str], limit: int) -> List[Dict]:
    """키워드로 메모리 검색 (FTS)"""
    if not keywords:
        return []

    cursor = conn.cursor()
    results = []
    seen_ids = set()

    # FTS 검색
    try:
        fts_query = ' OR '.join(keywords[:10])
        cursor.execute('''
            SELECT m.id, m.content, m.memory_type, m.importance, m.created_at, m.tags
            FROM memories m
            JOIN memories_fts fts ON m.id = fts.rowid
            WHERE memories_fts MATCH ? AND m.project = ?
            ORDER BY m.importance DESC, m.created_at DESC
            LIMIT ?
        ''', (fts_query, project, limit * 2))

        for row in cursor.fetchall():
            if row[0] not in seen_ids and len(results) < limit:
                seen_ids.add(row[0])
                results.append({
                    'id': row[0],
                    'content': row[1],
                    'type': row[2],
                    'importance': row[3],
                    'created_at': row[4],
                    'tags': row[5],
                    'source': 'git_keywords'
                })
    except:
        pass

    return results


def search_recent_memories(conn: sqlite3.Connection, project: str, days: int, limit: int) -> List[Dict]:
    """최근 N일 이내 메모리"""
    cursor = conn.cursor()

    cursor.execute('''
        SELECT id, content, memory_type, importance, created_at, tags
        FROM memories
        WHERE project = ?
          AND created_at > datetime('now', ?)
        ORDER BY created_at DESC, importance DESC
        LIMIT ?
    ''', (project, f'-{days} days', limit))

    return [{
        'id': row[0],
        'content': row[1],
        'type': row[2],
        'importance': row[3],
        'created_at': row[4],
        'tags': row[5],
        'source': 'recent'
    } for row in cursor.fetchall()]


def search_important_memories(conn: sqlite3.Connection, project: str, limit: int) -> List[Dict]:
    """중요 메모리 (decision, error, architecture 등)"""
    cursor = conn.cursor()

    # 중요 타입 + 높은 중요도
    cursor.execute('''
        SELECT id, content, memory_type, importance, created_at, tags
        FROM memories
        WHERE project = ?
          AND (memory_type IN ('decision', 'error') OR importance >= 8)
        ORDER BY importance DESC, created_at DESC
        LIMIT ?
    ''', (project, limit))

    return [{
        'id': row[0],
        'content': row[1],
        'type': row[2],
        'importance': row[3],
        'created_at': row[4],
        'tags': row[5],
        'source': 'important'
    } for row in cursor.fetchall()]


def search_fallback_memories(conn: sqlite3.Connection, project: str, limit: int) -> List[Dict]:
    """폴백: 일반 메모리"""
    cursor = conn.cursor()

    cursor.execute('''
        SELECT id, content, memory_type, importance, created_at, tags
        FROM memories
        WHERE project = ?
        ORDER BY importance DESC, accessed_at DESC
        LIMIT ?
    ''', (project, limit))

    return [{
        'id': row[0],
        'content': row[1],
        'type': row[2],
        'importance': row[3],
        'created_at': row[4],
        'tags': row[5],
        'source': 'fallback'
    } for row in cursor.fetchall()]


def deduplicate_memories(memories: List[Dict]) -> List[Dict]:
    """중복 제거 (ID 기준)"""
    seen = set()
    unique = []
    for m in memories:
        if m['id'] not in seen:
            seen.add(m['id'])
            unique.append(m)
    return unique


def load_project_context(conn: sqlite3.Connection, project: str) -> Dict[str, Any]:
    """프로젝트 기본 컨텍스트 로드"""
    cursor = conn.cursor()
    context = {}

    # 기술 스택
    cursor.execute('SELECT tech_stack FROM project_context WHERE project = ?', (project,))
    row = cursor.fetchone()
    if row and row[0]:
        context['tech_stack'] = json.loads(row[0])

    # 활성 상태
    cursor.execute('SELECT current_state, blockers FROM active_context WHERE project = ?', (project,))
    row = cursor.fetchone()
    if row:
        context['current_state'] = row[0]
        context['blockers'] = row[1]

    # 최근 세션
    cursor.execute('SELECT last_work, next_tasks FROM sessions WHERE project = ? ORDER BY timestamp DESC LIMIT 1', (project,))
    row = cursor.fetchone()
    if row:
        context['last_work'] = row[0]
        context['next_steps'] = json.loads(row[1]) if row[1] else []

    # 미완료 태스크
    cursor.execute('''
        SELECT title, priority FROM tasks
        WHERE project = ? AND status IN ('pending', 'in_progress')
        ORDER BY priority DESC LIMIT 5
    ''', (project,))
    context['pending_tasks'] = [{'title': r[0], 'priority': r[1]} for r in cursor.fetchall()]

    return context


def format_memory(m: Dict) -> str:
    """메모리 포맷팅"""
    content = m['content']
    # 해시 태그 제거
    if content.startswith('[') and ']' in content:
        content = content.split(']', 1)[1].strip()

    # 너무 길면 자름
    if len(content) > 150:
        content = content[:147] + '...'

    type_icons = {
        'decision': '🎯',
        'error': '⚠️',
        'learning': '📚',
        'implementation': '🔧',
        'important': '❗',
        'code': '💻',
        'observation': '👀'
    }
    icon = type_icons.get(m['type'], '💭')

    # 시맨틱 검색으로 찾은 경우 유사도 표시
    similarity_str = ''
    if m.get('source') == 'semantic' and m.get('similarity'):
        similarity_str = f" (sim: {m['similarity']:.2f})"

    return f"- {icon} [{m['type']}] {content}{similarity_str}"


def format_output(project: str, context: Dict, memories: List[Dict]) -> str:
    """최종 출력 포맷"""
    lines = [f"# 🚀 {project} - Session Resumed\n"]

    # 기술 스택
    if context.get('tech_stack'):
        stack = context['tech_stack']
        stack_str = ', '.join(f"**{k}**: {v}" for k, v in stack.items() if v)
        if stack_str:
            lines.append(f"## Tech Stack")
            lines.append(stack_str)
            lines.append('')

    # 현재 상태
    if context.get('current_state'):
        lines.append(f"## Current State")
        lines.append(f"📍 {context['current_state']}")
        if context.get('blockers'):
            lines.append(f"🚧 **Blocker**: {context['blockers']}")
        lines.append('')

    # 마지막 작업
    if context.get('last_work'):
        lines.append(f"## Last Work")
        lines.append(context['last_work'][:200])
        if context.get('next_steps'):
            lines.append(f"**Next**: {' → '.join(context['next_steps'][:3])}")
        lines.append('')

    # 미완료 태스크
    if context.get('pending_tasks'):
        lines.append(f"## 📋 Pending Tasks")
        for t in context['pending_tasks'][:5]:
            lines.append(f"- [P{t['priority']}] {t['title']}")
        lines.append('')

    # 관련 메모리 (핵심!)
    if memories:
        lines.append(f"## 🧠 Relevant Memories ({len(memories)})")
        for m in memories[:8]:  # 최대 8개
            lines.append(format_memory(m))
        lines.append('')

    lines.append("---")
    lines.append("_Auto-loaded by MCP v6 (Semantic Search). Use `#remember` to save important info._")

    return '\n'.join(lines)


def main():
    try:
        input_data = json.load(sys.stdin)
        cwd = input_data.get("cwd", os.getcwd())

        project = get_project_from_cwd(cwd)
        if not project:
            sys.exit(0)

        if not os.path.exists(DB_PATH):
            print(f"\n[Session] Project: {project} (no database - run project_init)\n")
            sys.exit(0)

        # 프로젝트 경로
        if 'tools/' in cwd:
            project_path = os.path.join(WORKSPACE_ROOT, 'tools', project)
        else:
            project_path = os.path.join(APPS_DIR, project)

        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row

        # Git 키워드 추출 (여러 Phase에서 사용)
        git_keywords = extract_git_keywords(project_path) if os.path.exists(project_path) else []

        # Phase 0: 시맨틱 검색 (임베딩 유사도 기반)
        semantic_memories = search_semantic_memories(conn, project, git_keywords, SLOT_CONFIG['semantic'])

        # Phase 1: Git 키워드 기반 FTS 검색
        git_memories = search_memories_by_keywords(conn, project, git_keywords, SLOT_CONFIG['git_related'])

        # Phase 2: 최근 7일 메모리
        recent_memories = search_recent_memories(conn, project, 7, SLOT_CONFIG['recent'])

        # Phase 3: 중요 메모리
        important_memories = search_important_memories(conn, project, SLOT_CONFIG['important'])

        # Phase 4: 폴백
        fallback_memories = search_fallback_memories(conn, project, SLOT_CONFIG['fallback'])

        # 병합 + 중복 제거 (시맨틱 검색 결과 우선)
        all_memories = deduplicate_memories(
            semantic_memories + git_memories + recent_memories + important_memories + fallback_memories
        )[:12]  # 최대 12개

        # 프로젝트 컨텍스트
        context = load_project_context(conn, project)

        conn.close()

        # 출력
        if context or all_memories:
            output = format_output(project, context, all_memories)
            print(f"\n<session-context project=\"{project}\">\n{output}\n</session-context>\n")
        else:
            print(f"\n[Session] Project: {project} (no context yet - use project_init)\n")

        sys.exit(0)

    except Exception as e:
        print(f"<!-- Hook error: {e} -->", file=sys.stderr)
        sys.exit(0)


if __name__ == "__main__":
    main()
