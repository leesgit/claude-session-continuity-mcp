#!/usr/bin/env python3
"""
Post-prompt Submit Hook v2 - 대화 기반 자동 메모리 캡처

mcp-memory-service 스타일의 Smart Auto-Capture 구현:
1. 대화 내용에서 의미 있는 정보 자동 감지
2. 6가지 메모리 타입 자동 분류 (decision, error, learning, implementation, important, code)
3. #remember / #skip 사용자 오버라이드
4. 프로젝트별 격리 저장
5. 중복 방지 (콘텐츠 해시)

트리거: Claude 응답 후 실행 (PostToolUse 대신 PostPromptSubmit)
"""
from __future__ import annotations

import json
import os
import sys
import sqlite3
import re
import hashlib
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, List, Tuple, Any

# 설정
WORKSPACE_ROOT = os.environ.get('WORKSPACE_ROOT', '/Users/ibyeongchang/Documents/dev/ai-service-generator')
DB_PATH = os.path.join(WORKSPACE_ROOT, '.claude', 'sessions.db')
APPS_DIR = os.path.join(WORKSPACE_ROOT, 'apps')

# ===== 패턴 정의 (mcp-memory-service 스타일 + 다국어 확장) =====

# 메모리 타입별 패턴 (우선순위 순)
MEMORY_PATTERNS = {
    'decision': {
        'priority': 1,
        'confidence': 0.9,
        'min_length': 50,
        'patterns': [
            # === 영어 (English) ===
            r'\b(decided|chose|will use|going with|selected|picked|opted for)\b',
            r'\b(architecture|design decision|approach|strategy)\b.*\b(is|will be|should be)\b',
            r'\b(instead of|rather than|over)\b.*\b(because|since|as)\b',
            r'\b(we\'ll go with|let\'s use|the plan is|we should)\b',
            r'\b(final decision|agreed on|settled on|committed to)\b',
            r'\b(prefer|better to|best option|recommended approach)\b',
            r'\b(trade-?off|pros and cons|considered|evaluated)\b',
            # === 한국어 (Korean) ===
            r'(결정|선택|채택|정했|하기로|으로 가|방식으로)',
            r'(아키텍처|설계|구조).*?(으로|를|이)',
            r'(대신|말고).*?(이유|때문)',
            r'(으로 하자|으로 갈게|이걸로|로 정함)',
            r'(최종|확정|합의|동의)',
            r'(트레이드오프|장단점|고려|검토).*?(결과|후)',
            r'(더 낫|최선|권장|추천).*?(방법|방식)',
            r'(왜냐하면|그래서|따라서).*?(선택|결정)',
            # === 일본어 (Japanese) ===
            r'(決定|選択|採用|決めた|することに|方針)',
            r'(アーキテクチャ|設計|構造).*?(に|を|が)',
            r'(代わりに|ではなく).*?(理由|ため)',
            r'(にしよう|を使う|で行く|に決定)',
            r'(最終|確定|合意|同意)',
            r'(トレードオフ|長所短所|検討|評価)',
        ]
    },
    'error': {
        'priority': 2,
        'confidence': 0.85,
        'min_length': 30,
        'patterns': [
            # === 영어 (English) ===
            r'\b(error|exception|bug|issue|problem|crash|fail)\b.*\b(fixed|solved|resolved|caused by)\b',
            r'\b(fixed|solved|resolved)\b.*\b(by|with|using)\b',
            r'\b(the issue was|the problem was|root cause)\b',
            r'\b(debugging|debugged|traced|tracked down)\b',
            r'\b(workaround|hotfix|patch|fix for)\b',
            r'\b(stack trace|error message|exception thrown)\b',
            r'\b(breaks|broken|breaking|doesn\'t work|not working)\b',
            r'\b(null pointer|undefined|type error|runtime error)\b',
            # === 한국어 (Korean) ===
            r'(에러|오류|버그|문제|이슈).*?(해결|수정|고침|원인)',
            r'(해결|수정|고침).*?(방법|했|됨|완료)',
            r'(원인|이유).*?(였|이었|때문)',
            r'(디버깅|추적|찾았|발견)',
            r'(임시방편|핫픽스|패치|수정본)',
            r'(스택트레이스|에러메시지|예외)',
            r'(안됨|안 됨|작동 안|동작 안|실패)',
            r'(널|undefined|타입에러|런타임)',
            r'(충돌|크래시|멈춤|뻗음)',
            # === 일본어 (Japanese) ===
            r'(エラー|バグ|問題|イシュー).*?(解決|修正|直した|原因)',
            r'(解決|修正|直した).*?(方法|した|完了)',
            r'(原因|理由).*?(だった|ため)',
            r'(デバッグ|追跡|見つけた|発見)',
            r'(動かない|動作しない|失敗|クラッシュ)',
        ]
    },
    'learning': {
        'priority': 3,
        'confidence': 0.85,
        'min_length': 40,
        'patterns': [
            # === 영어 (English) ===
            r'\b(learned|discovered|realized|found out|turns out|TIL)\b',
            r'\b(didn\'t know|now I understand|makes sense now)\b',
            r'\b(the trick is|the key is|important to note)\b',
            r'\b(aha moment|eureka|finally understood|clicked)\b',
            r'\b(gotcha|caveat|pitfall|watch out for)\b',
            r'\b(best practice|pro tip|life saver|game changer)\b',
            r'\b(documentation says|according to docs|spec says)\b',
            r'\b(works because|reason is|explanation is)\b',
            # === 한국어 (Korean) ===
            r'(배웠|알게|발견|깨달|알아냈)',
            r'(몰랐|이해했|이해됨|그렇구나)',
            r'(핵심|포인트|중요한 점|팁)',
            r'(아하|유레카|드디어|이해됨)',
            r'(함정|주의점|실수하기 쉬운)',
            r'(베스트 프랙티스|꿀팁|생명의 은인)',
            r'(문서에|공식 문서|스펙에|따르면)',
            r'(이유는|원리는|작동 원리)',
            r'(새로 안|처음 알았|신기하게도)',
            r'(이렇게 하면|이런 식으로|방법은)',
            # === 일본어 (Japanese) ===
            r'(学んだ|発見した|気づいた|分かった)',
            r'(知らなかった|理解した|なるほど)',
            r'(ポイント|コツ|重要な点|ヒント)',
            r'(ハマりポイント|落とし穴|注意点)',
            r'(ベストプラクティス|プロのコツ)',
            r'(ドキュメントによると|仕様では)',
        ]
    },
    'implementation': {
        'priority': 4,
        'confidence': 0.8,
        'min_length': 60,
        'patterns': [
            # === 영어 (English) ===
            r'\b(implemented|created|built|developed|added|refactored)\b.*\b(feature|function|component|service)\b',
            r'\b(now (supports|handles|works with))\b',
            r'\b(successfully (integrated|deployed|migrated))\b',
            r'\b(shipped|released|launched|rolled out)\b',
            r'\b(PR merged|commit pushed|code reviewed)\b',
            r'\b(completed|finished|done with|wrapped up)\b',
            r'\b(set up|configured|initialized|bootstrapped)\b',
            r'\b(connected|hooked up|wired|linked)\b',
            # === 한국어 (Korean) ===
            r'(구현|개발|추가|생성|리팩토링).*?(완료|했|됨|끝)',
            r'(기능|컴포넌트|서비스).*?(추가|구현|완성)',
            r'(통합|배포|마이그레이션).*?(완료|성공)',
            r'(출시|릴리즈|배포|런칭)',
            r'(PR 머지|커밋|코드리뷰)',
            r'(완성|마침|끝냄|마무리)',
            r'(설정|구성|초기화|세팅)',
            r'(연결|연동|통합|붙임)',
            r'(만들었|작성했|코딩했)',
            # === 일본어 (Japanese) ===
            r'(実装|開発|追加|作成|リファクタリング).*?(完了|した|終わり)',
            r'(機能|コンポーネント|サービス).*?(追加|実装|完成)',
            r'(統合|デプロイ|マイグレーション).*?(完了|成功)',
            r'(リリース|公開|ローンチ)',
            r'(設定|構成|初期化|セットアップ)',
            r'(接続|連携|統合)',
        ]
    },
    'important': {
        'priority': 5,
        'confidence': 0.75,
        'min_length': 30,
        'patterns': [
            # === 영어 (English) ===
            r'\b(important|critical|crucial|essential|must|never|always)\b',
            r'\b(remember|don\'t forget|keep in mind|note that)\b',
            r'\b(warning|caution|be careful|watch out)\b',
            r'\b(do not|don\'t ever|avoid|stay away from)\b',
            r'\b(required|mandatory|necessary|needed)\b',
            r'\b(breaking change|deprecated|obsolete)\b',
            r'\b(security|vulnerability|sensitive|confidential)\b',
            r'\b(deadline|urgent|asap|priority)\b',
            # === 한국어 (Korean) ===
            r'(중요|필수|반드시|절대|항상|주의)',
            r'(기억|잊지|명심|참고)',
            r'(경고|조심|주의사항)',
            r'(하지마|하면 안|금지|피해)',
            r'(필요|꼭|무조건)',
            r'(브레이킹|지원중단|deprecated)',
            r'(보안|취약점|민감|기밀)',
            r'(마감|긴급|급함|우선순위)',
            r'(핵심|필독|꼭 읽어)',
            # === 일본어 (Japanese) ===
            r'(重要|必須|必ず|絶対|常に|注意)',
            r'(覚えて|忘れずに|留意|参考)',
            r'(警告|注意|気をつけて)',
            r'(してはいけない|禁止|避ける)',
            r'(必要|絶対に|必ず)',
            r'(セキュリティ|脆弱性|機密)',
            r'(締め切り|緊急|優先)',
        ]
    },
    'code': {
        'priority': 6,
        'confidence': 0.7,
        'min_length': 200,  # 코드는 길이가 중요
        'patterns': [
            r'```[\s\S]{100,}```',  # 코드 블록
            r'\b(function|class|interface|type|const|let|var)\b.*[{(]',
            r'\b(def |async def |class )\w+',
            r'\b(import|from|require|export)\b',
            r'\b(fun |val |var |data class |sealed class)\b',  # Kotlin
            r'\b(Widget |StatelessWidget|StatefulWidget|@override)\b',  # Flutter
            r'\b(struct |impl |fn |pub |mod )\b',  # Rust
            r'\b(func |package |go |chan )\b',  # Go
        ]
    }
}

# 사용자 오버라이드 (다국어)
USER_OVERRIDES = {
    'remember': [
        '#remember', '@remember',           # 영어
        '#기억', '#저장', '#메모',           # 한국어
        '#覚える', '#保存', '#メモ',         # 일본어
    ],
    'skip': [
        '#skip', '@skip',                   # 영어
        '#스킵', '#무시', '#패스',           # 한국어
        '#スキップ', '#無視', '#パス',       # 일본어
    ]
}

# 스킵할 콘텐츠 패턴 (다국어)
SKIP_PATTERNS = [
    # 영어 인사/짧은 응답
    r'^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|cool|nice|good|great)[\s!.]*$',
    # 한국어 인사/짧은 응답
    r'^(안녕|감사|네|예|응|아니|ㅇㅇ|ㅋㅋ|ㅎㅎ|ㄱㄱ|ㅇㅋ|굿|좋아|알겠|오키)[\s!.]*$',
    # 일본어 인사/짧은 응답
    r'^(はい|いいえ|ありがとう|おはよう|こんにちは|了解|OK|うん|ええ)[\s!.]*$',
    # 너무 짧은 콘텐츠
    r'^.{0,20}$',  # 20자 미만
    r'^\s*$',  # 빈 문자열
    # 단순 확인/질문
    r'^(뭐|뭐야|왜|어떻게|언제|어디|누가)\?*$',
    r'^(what|why|how|when|where|who)\?*$',
    r'^(何|なぜ|どう|いつ|どこ|誰)\?*$',
]


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


def get_conversation_content() -> Optional[str]:
    """stdin에서 대화 내용 읽기"""
    try:
        if not sys.stdin.isatty():
            return sys.stdin.read()
    except:
        pass
    return None


def check_user_override(content: str) -> Tuple[bool, bool]:
    """사용자 오버라이드 확인: (force_remember, force_skip)"""
    content_lower = content.lower()

    for marker in USER_OVERRIDES['skip']:
        if marker in content_lower:
            return (False, True)

    for marker in USER_OVERRIDES['remember']:
        if marker in content_lower:
            return (True, False)

    return (False, False)


def should_skip_content(content: str) -> bool:
    """스킵해야 할 콘텐츠인지 확인"""
    for pattern in SKIP_PATTERNS:
        if re.match(pattern, content.strip(), re.IGNORECASE):
            return True
    return False


def detect_memory_type(content: str) -> Optional[Dict[str, Any]]:
    """대화 내용에서 메모리 타입 감지"""
    if should_skip_content(content):
        return None

    content_length = len(content)

    # 우선순위 순으로 패턴 검사
    sorted_types = sorted(
        MEMORY_PATTERNS.items(),
        key=lambda x: x[1]['priority']
    )

    for memory_type, config in sorted_types:
        # 최소 길이 체크
        if content_length < config['min_length']:
            continue

        # 패턴 매칭
        for pattern in config['patterns']:
            if re.search(pattern, content, re.IGNORECASE | re.MULTILINE):
                return {
                    'type': memory_type,
                    'confidence': config['confidence'],
                    'priority': config['priority'],
                    'pattern_matched': pattern[:50]
                }

    return None


def extract_tags(content: str) -> List[str]:
    """콘텐츠에서 태그 자동 추출 (다국어 키워드 지원)"""
    tags = set()

    # 기술 키워드 (다국어)
    tech_patterns = {
        # 프레임워크/라이브러리
        'flutter': r'\b(flutter|dart|widget|pubspec|플러터|위젯)\b',
        'react': r'\b(react|jsx|tsx|useState|useEffect|리액트|フック)\b',
        'nextjs': r'\b(next\.?js|getServerSideProps|app router|넥스트)\b',
        'vue': r'\b(vue|vuex|nuxt|composition api|뷰)\b',
        'angular': r'\b(angular|ng-|앵귤러)\b',
        'svelte': r'\b(svelte|sveltekit|스벨트)\b',

        # 언어
        'python': r'\b(python|pip|django|flask|fastapi|파이썬)\b',
        'typescript': r'\b(typescript|ts|타입스크립트|型)\b',
        'kotlin': r'\b(kotlin|coroutine|코틀린|コトリン)\b',
        'swift': r'\b(swift|swiftui|스위프트)\b',
        'rust': r'\b(rust|cargo|러스트|ラスト)\b',
        'go': r'\b(golang|go mod|고랭)\b',

        # 도메인
        'api': r'\b(api|endpoint|rest|graphql|fetch|엔드포인트|API)\b',
        'database': r'\b(database|db|sql|query|mongodb|postgres|데이터베이스|DB|クエリ)\b',
        'auth': r'\b(auth|login|token|jwt|session|oauth|인증|로그인|認証|ログイン)\b',
        'ui': r'\b(ui|ux|design|style|css|layout|디자인|레이아웃|デザイン)\b',
        'test': r'\b(test|spec|jest|pytest|unittest|테스트|テスト)\b',
        'deploy': r'\b(deploy|ci/cd|docker|kubernetes|배포|デプロイ)\b',
        'performance': r'\b(performance|optimization|cache|성능|최적화|パフォーマンス)\b',
        'security': r'\b(security|vulnerability|xss|csrf|보안|취약점|セキュリティ)\b',

        # 모바일
        'android': r'\b(android|gradle|안드로이드|アンドロイド)\b',
        'ios': r'\b(ios|xcode|cocoapods|아이폰|iOS)\b',

        # 상태관리
        'state': r'\b(state|redux|zustand|riverpod|bloc|상태관리|状態)\b',
    }

    for tag, pattern in tech_patterns.items():
        if re.search(pattern, content, re.IGNORECASE):
            tags.add(tag)

    return list(tags)[:5]


def compute_content_hash(content: str) -> str:
    """콘텐츠 해시 계산"""
    # 정규화: 공백 제거, 소문자
    normalized = re.sub(r'\s+', ' ', content.lower().strip())
    return hashlib.md5(normalized.encode()).hexdigest()[:16]


def is_duplicate(conn: sqlite3.Connection, project: str, content_hash: str) -> bool:
    """중복 메모리 체크"""
    cursor = conn.cursor()

    # 최근 24시간 내 동일 해시
    cursor.execute('''
        SELECT id FROM memories
        WHERE project = ?
          AND content LIKE ?
          AND created_at > datetime('now', '-24 hours')
        LIMIT 1
    ''', (project, f'%[{content_hash}]%'))

    return cursor.fetchone() is not None


def save_memory(project: str, content: str, detection: Dict[str, Any], tags: List[str]) -> Optional[int]:
    """메모리 저장"""
    if not os.path.exists(DB_PATH):
        return None

    content_hash = compute_content_hash(content)

    try:
        conn = sqlite3.connect(DB_PATH)

        # 중복 체크
        if is_duplicate(conn, project, content_hash):
            conn.close()
            return None

        cursor = conn.cursor()

        # 중요도 계산 (타입 + 신뢰도 기반)
        importance = min(10, max(1, int(detection['confidence'] * 10)))
        if detection['type'] in ['decision', 'error']:
            importance = min(10, importance + 2)

        # 저장할 콘텐츠 (너무 길면 자름)
        save_content = content[:2000] if len(content) > 2000 else content

        # 메타데이터
        metadata = json.dumps({
            'auto_captured': True,
            'detection': detection,
            'content_hash': content_hash
        })

        cursor.execute('''
            INSERT INTO memories (content, memory_type, tags, project, importance, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ''', (
            f"[{content_hash}] {save_content}",
            detection['type'],
            json.dumps(tags + ['auto-captured']) if tags else json.dumps(['auto-captured']),
            project,
            importance,
            metadata
        ))

        conn.commit()
        memory_id = cursor.lastrowid
        conn.close()

        return memory_id

    except Exception as e:
        print(f"<!-- Memory save error: {e} -->", file=sys.stderr)
        return None


def update_active_context(project: str, detection: Optional[Dict], content_preview: str):
    """활성 컨텍스트 업데이트"""
    if not os.path.exists(DB_PATH):
        return

    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        state = content_preview[:100] if content_preview else "Active session"
        if detection:
            state = f"[{detection['type']}] {state}"

        cursor.execute('''
            INSERT OR REPLACE INTO active_context (project, current_state, updated_at)
            VALUES (?, ?, datetime('now'))
        ''', (project, state))

        conn.commit()
        conn.close()
    except:
        pass


def main():
    """메인 실행 - 대화 기반 자동 캡처"""
    if os.environ.get('MCP_HOOKS_DISABLED') == 'true':
        return

    # 프로젝트 감지
    project = get_current_project()
    if not project:
        return

    # 대화 내용 읽기
    content = get_conversation_content()
    if not content:
        return

    # 사용자 오버라이드 확인
    force_remember, force_skip = check_user_override(content)

    if force_skip:
        print("<!-- Memory capture skipped by user -->", file=sys.stderr)
        return

    # 메모리 타입 감지
    detection = detect_memory_type(content)

    # 강제 기억 또는 감지된 경우에만 저장
    if force_remember:
        detection = detection or {
            'type': 'important',
            'confidence': 1.0,
            'priority': 0,
            'pattern_matched': '#remember override'
        }
    elif not detection:
        # 감지 안 됨 - 활성 컨텍스트만 업데이트
        update_active_context(project, None, content[:100])
        return

    # 태그 추출
    tags = extract_tags(content)

    # 메모리 저장
    memory_id = save_memory(project, content, detection, tags)

    # 활성 컨텍스트 업데이트
    update_active_context(project, detection, content[:100])

    # 결과 출력
    if memory_id:
        print(f"<!-- Auto-captured [{detection['type']}] memory #{memory_id} for {project} -->", file=sys.stderr)


if __name__ == '__main__':
    main()
