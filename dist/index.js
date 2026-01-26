#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';
// @ts-ignore - transformers.js
import { pipeline, env } from '@xenova/transformers';
// 모델 캐시 설정
env.cacheDir = path.join(process.env.HOME || '/tmp', '.cache', 'transformers');
env.allowLocalModels = true;
// 기본 경로 설정
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || '/Users/ibyeongchang/Documents/dev/ai-service-generator';
const APPS_DIR = path.join(WORKSPACE_ROOT, 'apps');
const DB_PATH = path.join(WORKSPACE_ROOT, '.claude', 'sessions.db');
// ===== SQLite 데이터베이스 초기화 =====
const db = new Database(DB_PATH);
// 테이블 생성
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_work TEXT NOT NULL,
    current_status TEXT,
    next_tasks TEXT,
    modified_files TEXT,
    issues TEXT,
    verification_result TEXT,
    duration_minutes INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
  CREATE INDEX IF NOT EXISTS idx_sessions_timestamp ON sessions(timestamp);

  CREATE TABLE IF NOT EXISTS work_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT NOT NULL,
    work_type TEXT NOT NULL,
    description TEXT,
    files_pattern TEXT,
    success_rate REAL DEFAULT 0,
    avg_duration_minutes REAL DEFAULT 0,
    count INTEGER DEFAULT 1,
    last_used DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_patterns_project ON work_patterns(project);
  CREATE INDEX IF NOT EXISTS idx_patterns_type ON work_patterns(work_type);

  -- ===== 메모리 시스템 테이블 (mcp-memory-service 영감) =====

  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    memory_type TEXT NOT NULL DEFAULT 'observation',
    tags TEXT,
    project TEXT,
    importance INTEGER DEFAULT 5,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    access_count INTEGER DEFAULT 0,
    metadata TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
  CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
  CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance);
  CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);

  -- FTS5 전체 텍스트 검색 (시맨틱 검색 대용)
  CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    content,
    tags,
    content='memories',
    content_rowid='id'
  );

  -- FTS 트리거
  CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
  END;

  CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES('delete', old.id, old.content, old.tags);
  END;

  CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES('delete', old.id, old.content, old.tags);
    INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
  END;

  -- 지식 그래프 관계 테이블
  CREATE TABLE IF NOT EXISTS memory_relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    relation_type TEXT NOT NULL,
    strength REAL DEFAULT 1.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_id) REFERENCES memories(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES memories(id) ON DELETE CASCADE,
    UNIQUE(source_id, target_id, relation_type)
  );

  CREATE INDEX IF NOT EXISTS idx_relations_source ON memory_relations(source_id);
  CREATE INDEX IF NOT EXISTS idx_relations_target ON memory_relations(target_id);
  CREATE INDEX IF NOT EXISTS idx_relations_type ON memory_relations(relation_type);

  -- ===== 시맨틱 검색용 임베딩 테이블 =====
  CREATE TABLE IF NOT EXISTS embeddings (
    memory_id INTEGER PRIMARY KEY,
    embedding BLOB NOT NULL,
    model TEXT DEFAULT 'all-MiniLM-L6-v2',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
  );

  -- ===== Content Filtering 학습 테이블 =====
  CREATE TABLE IF NOT EXISTS content_filter_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_type TEXT NOT NULL,
    pattern_description TEXT NOT NULL,
    file_extension TEXT,
    example_context TEXT,
    mitigation_strategy TEXT,
    occurrence_count INTEGER DEFAULT 1,
    last_occurred DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_filter_patterns_type ON content_filter_patterns(pattern_type);

  -- ===== 프로젝트 연속성 시스템 (v2) =====

  -- Layer 1: 프로젝트 고정 컨텍스트 (거의 안 바뀜)
  CREATE TABLE IF NOT EXISTS project_context (
    project TEXT PRIMARY KEY,
    tech_stack TEXT,              -- JSON: {framework, language, database, ...}
    architecture_decisions TEXT,  -- JSON array: 핵심 아키텍처 결정 (최대 5개)
    code_patterns TEXT,           -- JSON array: 코드 컨벤션/패턴 (최대 5개)
    special_notes TEXT,           -- 프로젝트 특이사항
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Layer 2: 활성 작업 컨텍스트 (자주 바뀜)
  CREATE TABLE IF NOT EXISTS active_context (
    project TEXT PRIMARY KEY,
    current_state TEXT,           -- 현재 상태 (1줄 요약)
    active_tasks TEXT,            -- JSON array: [{id, title, status}] (최대 3개)
    recent_files TEXT,            -- JSON array: 최근 수정 파일 (최대 10개)
    blockers TEXT,                -- 블로커/이슈
    last_verification TEXT,       -- passed/failed
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Layer 3: 태스크 백로그 (영구 보존)
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending',  -- pending, in_progress, done, blocked
    priority INTEGER DEFAULT 5,     -- 1-10 (10이 가장 높음)
    related_files TEXT,             -- JSON array
    acceptance_criteria TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project, status);
  CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority DESC);

  -- Layer 3: 해결된 이슈 아카이브 (검색용)
  CREATE TABLE IF NOT EXISTS resolved_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT,
    error_signature TEXT NOT NULL,  -- 에러 패턴 (검색 키)
    error_message TEXT,
    solution TEXT NOT NULL,
    related_files TEXT,             -- JSON array
    keywords TEXT,                  -- 자동 추출 키워드
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_issues_signature ON resolved_issues(error_signature);
  CREATE INDEX IF NOT EXISTS idx_issues_project ON resolved_issues(project);
`);
// Content Filtering 패턴 캐시 (메모리에 로드)
let contentFilterPatterns = [];
function loadContentFilterPatterns() {
    try {
        const stmt = db.prepare(`
      SELECT id, pattern_type, pattern_description, file_extension, mitigation_strategy
      FROM content_filter_patterns
      ORDER BY occurrence_count DESC
    `);
        const rows = stmt.all();
        contentFilterPatterns = rows.map(r => ({
            id: r.id,
            patternType: r.pattern_type,
            patternDescription: r.pattern_description,
            fileExtension: r.file_extension,
            mitigationStrategy: r.mitigation_strategy
        }));
    }
    catch {
        contentFilterPatterns = [];
    }
}
// 초기 로드
loadContentFilterPatterns();
// ===== 시맨틱 검색 엔진 =====
let embeddingPipeline = null;
let embeddingReady = false;
async function initEmbedding() {
    if (embeddingPipeline)
        return;
    try {
        console.error('Loading embedding model (first time may take a while)...');
        embeddingPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        embeddingReady = true;
        console.error('Embedding model loaded successfully!');
    }
    catch (error) {
        console.error('Failed to load embedding model:', error);
    }
}
// 백그라운드에서 모델 로드 시작
initEmbedding();
async function generateEmbedding(text) {
    if (!embeddingPipeline) {
        await initEmbedding();
    }
    if (!embeddingPipeline)
        return null;
    try {
        const output = await embeddingPipeline(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data);
    }
    catch (error) {
        console.error('Embedding generation error:', error);
        return null;
    }
}
function cosineSimilarity(a, b) {
    if (a.length !== b.length)
        return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
function embeddingToBuffer(embedding) {
    const float32Array = new Float32Array(embedding);
    return Buffer.from(float32Array.buffer);
}
function bufferToEmbedding(buffer) {
    const float32Array = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
    return Array.from(float32Array);
}
// MCP 서버 생성
const server = new Server({ name: 'project-manager', version: '1.0.0' }, { capabilities: { tools: { listChanged: true } } });
// ===== 유틸리티 함수 =====
async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
async function readFileContent(filePath) {
    try {
        return await fs.readFile(filePath, 'utf-8');
    }
    catch {
        return null;
    }
}
async function writeFileContent(filePath, content) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
}
function parseMarkdownTable(content, tableName) {
    const result = {};
    const lines = content.split('\n');
    let inTable = false;
    for (const line of lines) {
        if (line.includes(tableName)) {
            inTable = true;
            continue;
        }
        if (inTable && line.startsWith('|') && !line.includes('---')) {
            const cells = line.split('|').map(c => c.trim()).filter(Boolean);
            if (cells.length >= 2 && cells[0] !== '항목' && cells[0] !== '작업') {
                result[cells[0]] = cells[1];
            }
        }
        if (inTable && line.trim() === '') {
            inTable = false;
        }
    }
    return result;
}
const tools = [
    {
        name: 'list_projects',
        description: 'apps/ 디렉토리의 모든 프로젝트 목록과 상태를 반환합니다.',
        inputSchema: {
            type: 'object',
            properties: {},
        }
    },
    {
        name: 'get_session',
        description: '프로젝트의 SESSION.md를 파싱하여 구조화된 데이터로 반환합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트 이름' },
                includeRaw: { type: 'boolean', description: 'raw 전체 내용 포함 여부 (기본: false, 응답 크기 줄이기)' },
                maxContentLength: { type: 'number', description: '최대 내용 길이 (기본: 2000, 0이면 무제한)' }
            },
            required: ['project']
        }
    },
    {
        name: 'update_session',
        description: '프로젝트의 SESSION.md를 업데이트하고 DB에 이력을 저장합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트 이름' },
                lastWork: { type: 'string', description: '마지막 작업 내용' },
                currentStatus: { type: 'string', description: '현재 상태' },
                nextTasks: { type: 'array', items: { type: 'string' }, description: '다음 작업 목록' },
                modifiedFiles: { type: 'array', items: { type: 'string' }, description: '수정된 파일 목록' },
                issues: { type: 'array', items: { type: 'string' }, description: '알려진 이슈' },
                verificationResult: { type: 'string', description: '검증 결과 (passed/failed)' }
            },
            required: ['project', 'lastWork']
        }
    },
    {
        name: 'get_tech_stack',
        description: '프로젝트의 plan.md에서 기술 스택 정보를 추출합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트 이름' }
            },
            required: ['project']
        }
    },
    {
        name: 'run_verification',
        description: '프로젝트의 빌드/테스트/린트를 한 번에 실행하고 결과를 반환합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트 이름' },
                gates: {
                    type: 'array',
                    items: { type: 'string', enum: ['build', 'test', 'lint'] },
                    description: '실행할 게이트 목록 (기본: 전체)'
                }
            },
            required: ['project']
        }
    },
    {
        name: 'detect_platform',
        description: '프로젝트의 플랫폼을 자동 감지합니다 (Web, Android, Flutter, Server).',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트 이름' }
            },
            required: ['project']
        }
    },
    // ===== 새로운 SQLite 기반 도구들 =====
    {
        name: 'save_session_history',
        description: '세션 기록을 DB에 저장합니다. update_session 호출 시 자동으로 호출됩니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트 이름' },
                lastWork: { type: 'string', description: '작업 내용' },
                currentStatus: { type: 'string', description: '현재 상태' },
                nextTasks: { type: 'array', items: { type: 'string' }, description: '다음 작업' },
                modifiedFiles: { type: 'array', items: { type: 'string' }, description: '수정된 파일' },
                issues: { type: 'array', items: { type: 'string' }, description: '이슈' },
                verificationResult: { type: 'string', description: '검증 결과 (passed/failed)' },
                durationMinutes: { type: 'number', description: '작업 소요 시간 (분)' }
            },
            required: ['project', 'lastWork']
        }
    },
    {
        name: 'get_session_history',
        description: '프로젝트의 세션 이력을 조회합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트 이름 (없으면 전체)' },
                limit: { type: 'number', description: '조회 개수 (기본: 10)' },
                keyword: { type: 'string', description: '검색 키워드 (작업 내용에서 검색)' }
            }
        }
    },
    {
        name: 'search_similar_work',
        description: '과거에 비슷한 작업을 했는지 검색합니다. 이전 작업 패턴을 참고할 때 유용합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                keyword: { type: 'string', description: '검색할 작업 키워드 (예: 로그인, API 연동)' },
                project: { type: 'string', description: '특정 프로젝트만 검색 (선택)' }
            },
            required: ['keyword']
        }
    },
    {
        name: 'get_project_stats',
        description: '프로젝트별 작업 통계를 조회합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트 이름 (없으면 전체)' }
            }
        }
    },
    {
        name: 'record_work_pattern',
        description: '자주 사용하는 작업 패턴을 기록합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트 이름' },
                workType: { type: 'string', description: '작업 유형 (예: feature, bugfix, refactor)' },
                description: { type: 'string', description: '작업 설명' },
                filesPattern: { type: 'string', description: '관련 파일 패턴' },
                success: { type: 'boolean', description: '성공 여부' },
                durationMinutes: { type: 'number', description: '소요 시간' }
            },
            required: ['project', 'workType', 'description']
        }
    },
    {
        name: 'get_work_patterns',
        description: '프로젝트의 작업 패턴을 조회합니다. 자주 하는 작업과 성공률을 확인할 수 있습니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트 이름' },
                workType: { type: 'string', description: '작업 유형 필터' }
            }
        }
    },
    // ===== 메모리 시스템 도구 (mcp-memory-service 영감) =====
    {
        name: 'store_memory',
        description: '새로운 지식/학습/결정 사항을 메모리에 저장합니다. Claude가 배운 것들을 기억합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                content: { type: 'string', description: '저장할 내용' },
                memoryType: {
                    type: 'string',
                    enum: ['observation', 'decision', 'learning', 'error', 'pattern', 'preference'],
                    description: '메모리 유형 (observation: 관찰, decision: 결정, learning: 학습, error: 에러, pattern: 패턴, preference: 선호)'
                },
                tags: { type: 'array', items: { type: 'string' }, description: '태그 목록 (검색용)' },
                project: { type: 'string', description: '관련 프로젝트 (선택)' },
                importance: { type: 'number', description: '중요도 1-10 (기본: 5)' },
                metadata: { type: 'object', description: '추가 메타데이터 (선택)' }
            },
            required: ['content', 'memoryType']
        }
    },
    {
        name: 'recall_memory',
        description: '키워드로 관련 메모리를 검색합니다. FTS5 전체 텍스트 검색을 사용합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '검색 쿼리 (자연어)' },
                memoryType: { type: 'string', description: '메모리 유형 필터 (선택)' },
                project: { type: 'string', description: '프로젝트 필터 (선택)' },
                limit: { type: 'number', description: '최대 결과 수 (기본: 10)' },
                minImportance: { type: 'number', description: '최소 중요도 (기본: 1)' },
                maxContentLength: { type: 'number', description: '각 메모리 내용 최대 길이 (기본: 500, 0이면 무제한)' }
            },
            required: ['query']
        }
    },
    {
        name: 'recall_by_timeframe',
        description: '특정 기간의 메모리를 조회합니다. (예: 오늘, 이번주, 지난달)',
        inputSchema: {
            type: 'object',
            properties: {
                timeframe: {
                    type: 'string',
                    enum: ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month'],
                    description: '조회 기간'
                },
                memoryType: { type: 'string', description: '메모리 유형 필터 (선택)' },
                project: { type: 'string', description: '프로젝트 필터 (선택)' },
                limit: { type: 'number', description: '최대 결과 수 (기본: 20)' }
            },
            required: ['timeframe']
        }
    },
    {
        name: 'search_by_tag',
        description: '태그로 메모리를 검색합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                tags: { type: 'array', items: { type: 'string' }, description: '검색할 태그들' },
                matchAll: { type: 'boolean', description: '모든 태그 일치 필요 여부 (기본: false)' },
                limit: { type: 'number', description: '최대 결과 수 (기본: 20)' }
            },
            required: ['tags']
        }
    },
    {
        name: 'create_relation',
        description: '두 메모리 간의 관계를 생성합니다. (지식 그래프)',
        inputSchema: {
            type: 'object',
            properties: {
                sourceId: { type: 'number', description: '출발 메모리 ID' },
                targetId: { type: 'number', description: '도착 메모리 ID' },
                relationType: {
                    type: 'string',
                    enum: ['related_to', 'causes', 'solves', 'depends_on', 'contradicts', 'extends', 'example_of'],
                    description: '관계 유형'
                },
                strength: { type: 'number', description: '관계 강도 0-1 (기본: 1.0)' }
            },
            required: ['sourceId', 'targetId', 'relationType']
        }
    },
    {
        name: 'find_connected_memories',
        description: '특정 메모리와 연결된 모든 메모리를 찾습니다. (지식 그래프 탐색)',
        inputSchema: {
            type: 'object',
            properties: {
                memoryId: { type: 'number', description: '기준 메모리 ID' },
                depth: { type: 'number', description: '탐색 깊이 (기본: 1, 최대: 3)' },
                relationType: { type: 'string', description: '관계 유형 필터 (선택)' }
            },
            required: ['memoryId']
        }
    },
    {
        name: 'get_memory_stats',
        description: '메모리 시스템 통계를 조회합니다.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'delete_memory',
        description: '메모리를 삭제합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                memoryId: { type: 'number', description: '삭제할 메모리 ID' }
            },
            required: ['memoryId']
        }
    },
    // ===== 시맨틱 검색 도구 =====
    {
        name: 'semantic_search',
        description: '시맨틱 검색으로 의미적으로 유사한 메모리를 찾습니다. AI 임베딩(all-MiniLM-L6-v2)을 사용합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '검색 쿼리 (자연어, 의미 기반 검색)' },
                limit: { type: 'number', description: '최대 결과 수 (기본: 10)' },
                minSimilarity: { type: 'number', description: '최소 유사도 0-1 (기본: 0.3)' },
                memoryType: { type: 'string', description: '메모리 유형 필터 (선택)' },
                project: { type: 'string', description: '프로젝트 필터 (선택)' }
            },
            required: ['query']
        }
    },
    {
        name: 'rebuild_embeddings',
        description: '모든 메모리의 임베딩을 다시 생성합니다. 모델 업데이트 후 사용합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                force: { type: 'boolean', description: '기존 임베딩도 다시 생성 (기본: false, 누락된 것만)' }
            }
        }
    },
    {
        name: 'get_embedding_status',
        description: '임베딩 시스템 상태를 확인합니다.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    // ===== 자동 피드백 수집 도구 =====
    {
        name: 'collect_work_feedback',
        description: '/work 작업 완료 시 자동으로 피드백을 수집합니다. 에러, 타임아웃, 불편사항 등을 기록합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '작업한 프로젝트 이름' },
                workSummary: { type: 'string', description: '수행한 작업 요약' },
                feedbackType: {
                    type: 'string',
                    enum: ['bug', 'timeout', 'feature-request', 'ux', 'performance', 'none'],
                    description: '피드백 유형 (none: 피드백 없음)'
                },
                feedbackContent: { type: 'string', description: '피드백 내용 (feedbackType이 none이 아닐 때)' },
                affectedTool: { type: 'string', description: '문제가 발생한 MCP 도구명 (선택)' },
                verificationPassed: { type: 'boolean', description: '검증 통과 여부' },
                duration: { type: 'number', description: '작업 소요 시간 (분)' }
            },
            required: ['project', 'workSummary', 'feedbackType', 'verificationPassed']
        }
    },
    {
        name: 'get_pending_feedbacks',
        description: '해결되지 않은 피드백 목록을 중요도순으로 조회합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                feedbackType: { type: 'string', description: '피드백 유형 필터 (선택)' },
                limit: { type: 'number', description: '최대 결과 수 (기본: 20)' }
            }
        }
    },
    {
        name: 'resolve_feedback',
        description: '피드백을 해결 완료 처리합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                feedbackId: { type: 'number', description: '해결된 피드백 ID' },
                resolution: { type: 'string', description: '해결 방법 설명' }
            },
            required: ['feedbackId']
        }
    },
    // ===== Content Filtering 학습/회피 도구 =====
    {
        name: 'record_filter_pattern',
        description: 'API content filtering에 걸린 패턴을 기록합니다. 비슷한 상황 회피에 사용됩니다.',
        inputSchema: {
            type: 'object',
            properties: {
                patternType: {
                    type: 'string',
                    enum: ['code_block', 'file_content', 'long_output', 'sensitive_keyword', 'binary_like', 'other'],
                    description: '패턴 유형'
                },
                patternDescription: { type: 'string', description: '어떤 상황에서 발생했는지 설명' },
                fileExtension: { type: 'string', description: '관련 파일 확장자 (선택, 예: .kt, .tsx)' },
                exampleContext: { type: 'string', description: '발생 컨텍스트 예시 (민감 정보 제외)' },
                mitigationStrategy: { type: 'string', description: '회피 전략 (예: 청크 분할, 요약만 출력)' }
            },
            required: ['patternType', 'patternDescription']
        }
    },
    {
        name: 'get_filter_patterns',
        description: '기록된 content filtering 패턴 목록을 조회합니다. 응답 생성 시 참고용.',
        inputSchema: {
            type: 'object',
            properties: {
                patternType: { type: 'string', description: '패턴 유형 필터 (선택)' },
                fileExtension: { type: 'string', description: '파일 확장자 필터 (선택)' }
            }
        }
    },
    {
        name: 'get_safe_output_guidelines',
        description: '현재 학습된 패턴 기반으로 안전한 출력 가이드라인을 반환합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                context: { type: 'string', description: '현재 작업 컨텍스트 (예: kotlin 파일 분석, 긴 코드 출력)' }
            }
        }
    },
    // ===== 자동 학습 시스템 도구 =====
    {
        name: 'auto_learn_decision',
        description: '아키텍처/기술 결정 사항을 자동 기록합니다. 왜 이 선택을 했는지 기록하여 나중에 참조할 수 있습니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트명' },
                decision: { type: 'string', description: '결정 내용 (예: Socket.IO 대신 WebSocket 사용)' },
                reason: { type: 'string', description: '결정 이유' },
                context: { type: 'string', description: '결정 배경/맥락' },
                alternatives: { type: 'array', items: { type: 'string' }, description: '고려했던 대안들' },
                files: { type: 'array', items: { type: 'string' }, description: '관련 파일들' }
            },
            required: ['project', 'decision', 'reason']
        }
    },
    {
        name: 'auto_learn_fix',
        description: '에러/버그 해결 방법을 자동 기록합니다. 비슷한 에러 발생 시 참조할 수 있습니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트명' },
                error: { type: 'string', description: '에러 메시지 또는 증상' },
                cause: { type: 'string', description: '원인 (선택)' },
                solution: { type: 'string', description: '해결 방법' },
                files: { type: 'array', items: { type: 'string' }, description: '수정한 파일들' },
                preventionTip: { type: 'string', description: '재발 방지 팁 (선택)' }
            },
            required: ['project', 'error', 'solution']
        }
    },
    {
        name: 'auto_learn_pattern',
        description: '프로젝트의 코드 패턴/컨벤션을 자동 기록합니다. 일관성 유지에 활용됩니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트명' },
                patternName: { type: 'string', description: '패턴 이름 (예: Repository 패턴, State hoisting)' },
                description: { type: 'string', description: '패턴 설명' },
                example: { type: 'string', description: '예시 코드나 파일 경로' },
                appliesTo: { type: 'string', description: '적용 대상 (예: 모든 Repository, Compose UI)' }
            },
            required: ['project', 'patternName', 'description']
        }
    },
    {
        name: 'auto_learn_dependency',
        description: '의존성 변경 사항을 자동 기록합니다. 버전 충돌이나 업그레이드 시 참조합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트명' },
                dependency: { type: 'string', description: '의존성 이름' },
                action: { type: 'string', enum: ['add', 'remove', 'upgrade', 'downgrade'], description: '작업 유형' },
                fromVersion: { type: 'string', description: '이전 버전 (선택)' },
                toVersion: { type: 'string', description: '새 버전 (선택)' },
                reason: { type: 'string', description: '변경 이유' },
                breakingChanges: { type: 'string', description: 'Breaking changes 내용 (선택)' }
            },
            required: ['project', 'dependency', 'action', 'reason']
        }
    },
    {
        name: 'get_project_knowledge',
        description: '프로젝트에서 학습된 모든 지식을 조회합니다. 결정, 해결, 패턴, 의존성 변경 등.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트명' },
                knowledgeType: {
                    type: 'string',
                    enum: ['all', 'decision', 'fix', 'pattern', 'dependency'],
                    description: '지식 유형 필터 (기본: all)'
                },
                limit: { type: 'number', description: '최대 결과 수 (기본: 20)' }
            },
            required: ['project']
        }
    },
    {
        name: 'get_similar_issues',
        description: '비슷한 에러/이슈의 해결 방법을 검색합니다. 시맨틱 검색으로 유사한 문제를 찾습니다.',
        inputSchema: {
            type: 'object',
            properties: {
                errorOrIssue: { type: 'string', description: '에러 메시지 또는 이슈 설명' },
                project: { type: 'string', description: '특정 프로젝트에서만 검색 (선택)' },
                limit: { type: 'number', description: '최대 결과 수 (기본: 5)' }
            },
            required: ['errorOrIssue']
        }
    },
    // ===== 프로젝트 연속성 시스템 v2 =====
    {
        name: 'get_project_context',
        description: '프로젝트의 전체 컨텍스트를 한번에 조회합니다. /work 시작 시 필수 호출. 고정 컨텍스트(기술스택, 아키텍처)와 활성 컨텍스트(현재 상태, 태스크)를 ~650토큰으로 반환합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트명' }
            },
            required: ['project']
        }
    },
    {
        name: 'update_active_context',
        description: '프로젝트의 활성 컨텍스트를 업데이트합니다. 작업 종료 시 호출.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트명' },
                currentState: { type: 'string', description: '현재 상태 (1줄 요약)' },
                recentFiles: { type: 'array', items: { type: 'string' }, description: '최근 수정 파일' },
                blockers: { type: 'string', description: '블로커/이슈 (없으면 null)' },
                lastVerification: { type: 'string', enum: ['passed', 'failed'], description: '마지막 검증 결과' }
            },
            required: ['project', 'currentState']
        }
    },
    {
        name: 'init_project_context',
        description: '새 프로젝트의 고정 컨텍스트를 초기화합니다. plan.md 기반으로 자동 추출하거나 직접 입력.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트명' },
                techStack: { type: 'object', description: '기술 스택 {framework, language, database, ...}' },
                architectureDecisions: { type: 'array', items: { type: 'string' }, description: '핵심 아키텍처 결정 (최대 5개)' },
                codePatterns: { type: 'array', items: { type: 'string' }, description: '코드 컨벤션/패턴 (최대 5개)' },
                specialNotes: { type: 'string', description: '프로젝트 특이사항' }
            },
            required: ['project']
        }
    },
    {
        name: 'update_architecture_decision',
        description: '프로젝트에 아키텍처 결정을 추가합니다. 중요한 기술 결정 시 호출.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트명' },
                decision: { type: 'string', description: '결정 내용 (예: "Socket.IO 대신 WebSocket 사용 - 번들 사이즈 절약")' }
            },
            required: ['project', 'decision']
        }
    },
    // ===== 태스크 관리 =====
    {
        name: 'add_task',
        description: '프로젝트에 태스크를 추가합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트명' },
                title: { type: 'string', description: '태스크 제목' },
                description: { type: 'string', description: '태스크 설명 (선택)' },
                priority: { type: 'number', description: '우선순위 1-10 (기본: 5, 10이 가장 높음)' },
                relatedFiles: { type: 'array', items: { type: 'string' }, description: '관련 파일' },
                acceptanceCriteria: { type: 'string', description: '완료 조건' }
            },
            required: ['project', 'title']
        }
    },
    {
        name: 'complete_task',
        description: '태스크를 완료 처리합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                taskId: { type: 'number', description: '태스크 ID' }
            },
            required: ['taskId']
        }
    },
    {
        name: 'update_task_status',
        description: '태스크 상태를 변경합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                taskId: { type: 'number', description: '태스크 ID' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'blocked'], description: '새 상태' }
            },
            required: ['taskId', 'status']
        }
    },
    {
        name: 'get_pending_tasks',
        description: '프로젝트의 미완료 태스크 목록을 조회합니다. /work 시작 시 호출 권장.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트명' },
                includeBlocked: { type: 'boolean', description: 'blocked 상태 포함 여부 (기본: true)' }
            },
            required: ['project']
        }
    },
    // ===== 에러 솔루션 아카이브 =====
    {
        name: 'record_solution',
        description: '에러 해결 방법을 기록합니다. 에러 해결 후 호출하면 나중에 같은 에러 시 참조 가능.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트명 (선택, 범용 솔루션이면 생략)' },
                errorSignature: { type: 'string', description: '에러 패턴/시그니처 (검색 키, 예: "WorkManager not initialized")' },
                errorMessage: { type: 'string', description: '전체 에러 메시지 (선택)' },
                solution: { type: 'string', description: '해결 방법' },
                relatedFiles: { type: 'array', items: { type: 'string' }, description: '수정한 파일' }
            },
            required: ['errorSignature', 'solution']
        }
    },
    {
        name: 'find_solution',
        description: '비슷한 에러의 해결 방법을 검색합니다. 에러 발생 시 먼저 호출하여 기존 솔루션 확인.',
        inputSchema: {
            type: 'object',
            properties: {
                errorText: { type: 'string', description: '에러 메시지 또는 키워드' },
                project: { type: 'string', description: '특정 프로젝트에서만 검색 (선택)' }
            },
            required: ['errorText']
        }
    },
    // ===== 시스템 평가/모니터링 =====
    {
        name: 'get_continuity_stats',
        description: '연속성 시스템 사용 통계를 조회합니다. 시스템이 제대로 활용되고 있는지 평가용.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '특정 프로젝트 (선택, 없으면 전체)' }
            }
        }
    }
];
// ===== 도구 핸들러 =====
async function listProjects() {
    try {
        const entries = await fs.readdir(APPS_DIR, { withFileTypes: true });
        const projects = [];
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const projectPath = path.join(APPS_DIR, entry.name);
            const sessionPath = path.join(projectPath, 'docs', 'SESSION.md');
            const planPath = path.join(projectPath, 'plan.md');
            const hasSession = await fileExists(sessionPath);
            const hasPlan = await fileExists(planPath);
            // 플랫폼 감지
            let platform = 'Unknown';
            if (await fileExists(path.join(projectPath, 'package.json'))) {
                platform = 'Web';
            }
            else if (await fileExists(path.join(projectPath, 'build.gradle.kts')) ||
                await fileExists(path.join(projectPath, 'build.gradle'))) {
                platform = 'Android';
            }
            else if (await fileExists(path.join(projectPath, 'pubspec.yaml'))) {
                platform = 'Flutter';
            }
            projects.push({
                name: entry.name,
                path: projectPath,
                platform,
                hasSession,
                hasPlan
            });
        }
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({ projects, count: projects.length }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
async function getSession(project, includeRaw = false, maxContentLength = 2000) {
    const sessionPath = path.join(APPS_DIR, project, 'docs', 'SESSION.md');
    const content = await readFileContent(sessionPath);
    if (!content) {
        return {
            content: [{ type: 'text', text: JSON.stringify({ exists: false, project }) }]
        };
    }
    // SESSION.md 파싱
    const session = {
        exists: true,
        project
    };
    // 마지막 업데이트 추출
    const updateMatch = content.match(/마지막 업데이트[:\s]*(.+)/);
    if (updateMatch) {
        session.lastUpdate = updateMatch[1].trim();
    }
    // 현재 상태 추출
    const statusMatch = content.match(/현재 상태[:\s]*(.+)/);
    if (statusMatch) {
        session.currentStatus = statusMatch[1].trim();
    }
    // 다음 작업 추출
    const nextTasksMatch = content.match(/다음 작업[^:]*:([\s\S]*?)(?=##|$)/);
    if (nextTasksMatch) {
        const tasks = nextTasksMatch[1].match(/[-*]\s*(.+)/g);
        session.nextTasks = tasks?.map(t => t.replace(/^[-*]\s*/, '').trim()) || [];
    }
    // 수정된 파일 추출
    const filesMatch = content.match(/수정된 파일[^:]*:([\s\S]*?)(?=##|$)/);
    if (filesMatch) {
        const files = filesMatch[1].match(/[-*]\s*(.+)/g);
        session.modifiedFiles = files?.map(f => f.replace(/^[-*]\s*/, '').trim()) || [];
    }
    // 이슈 추출
    const issuesMatch = content.match(/(?:알려진 )?이슈[^:]*:([\s\S]*?)(?=##|$)/);
    if (issuesMatch) {
        const issues = issuesMatch[1].match(/[-*]\s*(.+)/g);
        session.issues = issues?.map(i => i.replace(/^[-*]\s*/, '').trim()) || [];
    }
    // raw 내용 (선택적, 응답 크기 조절용)
    if (includeRaw) {
        if (maxContentLength > 0 && content.length > maxContentLength) {
            session.raw = content.slice(0, maxContentLength);
            session.truncated = true;
            session.totalLength = content.length;
        }
        else {
            session.raw = content;
            session.truncated = false;
        }
    }
    // 응답 크기 정보 추가
    session.contentLength = content.length;
    return {
        content: [{ type: 'text', text: JSON.stringify(session, null, 2) }]
    };
}
async function updateSession(project, lastWork, currentStatus, nextTasks, modifiedFiles, issues, verificationResult) {
    const sessionPath = path.join(APPS_DIR, project, 'docs', 'SESSION.md');
    const now = new Date().toISOString().split('T')[0];
    let content = `# SESSION - ${project}

## 마지막 업데이트
- **날짜**: ${now}
- **작업**: ${lastWork}

## 현재 상태
${currentStatus || '진행 중'}

`;
    if (nextTasks && nextTasks.length > 0) {
        content += `## 다음 작업
${nextTasks.map(t => `- ${t}`).join('\n')}

`;
    }
    if (modifiedFiles && modifiedFiles.length > 0) {
        content += `## 수정된 파일
${modifiedFiles.map(f => `- ${f}`).join('\n')}

`;
    }
    if (issues && issues.length > 0) {
        content += `## 알려진 이슈
${issues.map(i => `- ${i}`).join('\n')}
`;
    }
    await writeFileContent(sessionPath, content);
    // DB에도 자동 저장
    try {
        const stmt = db.prepare(`
      INSERT INTO sessions (project, last_work, current_status, next_tasks, modified_files, issues, verification_result)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(project, lastWork, currentStatus || null, nextTasks ? JSON.stringify(nextTasks) : null, modifiedFiles ? JSON.stringify(modifiedFiles) : null, issues ? JSON.stringify(issues) : null, verificationResult || null);
    }
    catch (dbError) {
        console.error('DB save error:', dbError);
    }
    return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, path: sessionPath, savedToDb: true }) }]
    };
}
async function getTechStack(project) {
    const planPath = path.join(APPS_DIR, project, 'plan.md');
    const content = await readFileContent(planPath);
    if (!content) {
        return {
            content: [{ type: 'text', text: JSON.stringify({ exists: false, project }) }]
        };
    }
    const stack = parseMarkdownTable(content, '기술 스택');
    const commands = parseMarkdownTable(content, '명령어');
    return {
        content: [{
                type: 'text',
                text: JSON.stringify({
                    exists: true,
                    project,
                    techStack: stack,
                    commands: commands
                }, null, 2)
            }]
    };
}
async function runVerification(project, gates) {
    const projectPath = path.join(APPS_DIR, project);
    const planPath = path.join(projectPath, 'plan.md');
    // plan.md에서 명령어 추출
    const planContent = await readFileContent(planPath);
    let commands = {};
    if (planContent) {
        commands = parseMarkdownTable(planContent, '명령어');
    }
    // 플랫폼별 기본 명령어
    const defaultCommands = {
        Web: { build: 'pnpm build', test: 'pnpm test:run', lint: 'pnpm lint' },
        Android: { build: './gradlew assembleDebug', test: './gradlew test', lint: './gradlew lint' },
        Flutter: { build: 'flutter build', test: 'flutter test', lint: 'flutter analyze' }
    };
    // 플랫폼 감지
    let platform = 'Web';
    if (await fileExists(path.join(projectPath, 'build.gradle.kts')) ||
        await fileExists(path.join(projectPath, 'build.gradle'))) {
        platform = 'Android';
    }
    else if (await fileExists(path.join(projectPath, 'pubspec.yaml'))) {
        platform = 'Flutter';
    }
    const finalCommands = { ...defaultCommands[platform], ...commands };
    const gatesToRun = gates || ['build', 'test', 'lint'];
    const results = {};
    for (const gate of gatesToRun) {
        const cmd = finalCommands[gate === 'build' ? '빌드' : gate === 'test' ? '테스트' : '린트']
            || finalCommands[gate];
        if (!cmd) {
            results[gate] = { success: false, output: `No command found for ${gate}` };
            continue;
        }
        try {
            const output = execSync(cmd, {
                cwd: projectPath,
                encoding: 'utf-8',
                timeout: 300000, // 5분 타임아웃
                stdio: ['pipe', 'pipe', 'pipe']
            });
            results[gate] = { success: true, output: output.slice(-1000) }; // 마지막 1000자만
        }
        catch (error) {
            const execError = error;
            results[gate] = {
                success: false,
                output: (execError.stdout || execError.stderr || execError.message || 'Unknown error').slice(-1000)
            };
        }
    }
    const allPassed = Object.values(results).every(r => r.success);
    return {
        content: [{
                type: 'text',
                text: JSON.stringify({
                    project,
                    platform,
                    allPassed,
                    results
                }, null, 2)
            }]
    };
}
async function detectPlatform(project) {
    const projectPath = path.join(APPS_DIR, project);
    const checks = {
        'package.json': 'Web',
        'build.gradle.kts': 'Android',
        'build.gradle': 'Android',
        'pubspec.yaml': 'Flutter',
        'go.mod': 'Server (Go)',
        'Cargo.toml': 'Server (Rust)',
        'pom.xml': 'Server (Java)',
        'requirements.txt': 'Server (Python)'
    };
    for (const [file, platform] of Object.entries(checks)) {
        if (await fileExists(path.join(projectPath, file))) {
            // 추가 정보 수집
            const info = { platform };
            if (file === 'package.json') {
                const pkg = JSON.parse(await readFileContent(path.join(projectPath, file)) || '{}');
                info.framework = pkg.dependencies?.next ? 'Next.js' :
                    pkg.dependencies?.react ? 'React' :
                        pkg.dependencies?.vue ? 'Vue' : 'Unknown';
            }
            if (file === 'pubspec.yaml') {
                const content = await readFileContent(path.join(projectPath, file)) || '';
                info.hasFlame = content.includes('flame:');
                info.hasRiverpod = content.includes('riverpod');
            }
            return {
                content: [{ type: 'text', text: JSON.stringify({ project, ...info }) }]
            };
        }
    }
    return {
        content: [{ type: 'text', text: JSON.stringify({ project, platform: 'Unknown' }) }]
    };
}
// ===== SQLite 기반 새 도구 핸들러 =====
function saveSessionHistory(project, lastWork, currentStatus, nextTasks, modifiedFiles, issues, verificationResult, durationMinutes) {
    try {
        const stmt = db.prepare(`
      INSERT INTO sessions (project, last_work, current_status, next_tasks, modified_files, issues, verification_result, duration_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
        const result = stmt.run(project, lastWork, currentStatus || null, nextTasks ? JSON.stringify(nextTasks) : null, modifiedFiles ? JSON.stringify(modifiedFiles) : null, issues ? JSON.stringify(issues) : null, verificationResult || null, durationMinutes || null);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({ success: true, id: result.lastInsertRowid })
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
function getSessionHistory(project, limit = 10, keyword) {
    try {
        let query = 'SELECT * FROM sessions WHERE 1=1';
        const params = [];
        if (project) {
            query += ' AND project = ?';
            params.push(project);
        }
        if (keyword) {
            query += ' AND (last_work LIKE ? OR current_status LIKE ?)';
            params.push(`%${keyword}%`, `%${keyword}%`);
        }
        query += ' ORDER BY timestamp DESC LIMIT ?';
        params.push(limit);
        const stmt = db.prepare(query);
        const rows = stmt.all(...params);
        const sessions = rows.map(row => ({
            id: row.id,
            project: row.project,
            timestamp: row.timestamp,
            lastWork: row.last_work,
            currentStatus: row.current_status,
            nextTasks: row.next_tasks ? JSON.parse(row.next_tasks) : [],
            modifiedFiles: row.modified_files ? JSON.parse(row.modified_files) : [],
            issues: row.issues ? JSON.parse(row.issues) : [],
            verificationResult: row.verification_result,
            durationMinutes: row.duration_minutes
        }));
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({ sessions, count: sessions.length }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
function searchSimilarWork(keyword, project) {
    try {
        let query = `
      SELECT project, last_work, current_status, modified_files, verification_result, timestamp
      FROM sessions
      WHERE last_work LIKE ?
    `;
        const params = [`%${keyword}%`];
        if (project) {
            query += ' AND project = ?';
            params.push(project);
        }
        query += ' ORDER BY timestamp DESC LIMIT 20';
        const stmt = db.prepare(query);
        const rows = stmt.all(...params);
        const results = rows.map(row => ({
            project: row.project,
            work: row.last_work,
            status: row.current_status,
            files: row.modified_files ? JSON.parse(row.modified_files) : [],
            result: row.verification_result,
            date: row.timestamp
        }));
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        keyword,
                        found: results.length,
                        results
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
function getProjectStats(project) {
    try {
        let query;
        let params = [];
        if (project) {
            query = `
        SELECT
          project,
          COUNT(*) as total_sessions,
          SUM(CASE WHEN verification_result = 'passed' THEN 1 ELSE 0 END) as passed,
          SUM(CASE WHEN verification_result = 'failed' THEN 1 ELSE 0 END) as failed,
          AVG(duration_minutes) as avg_duration,
          MAX(timestamp) as last_session
        FROM sessions
        WHERE project = ?
        GROUP BY project
      `;
            params = [project];
        }
        else {
            query = `
        SELECT
          project,
          COUNT(*) as total_sessions,
          SUM(CASE WHEN verification_result = 'passed' THEN 1 ELSE 0 END) as passed,
          SUM(CASE WHEN verification_result = 'failed' THEN 1 ELSE 0 END) as failed,
          AVG(duration_minutes) as avg_duration,
          MAX(timestamp) as last_session
        FROM sessions
        GROUP BY project
        ORDER BY last_session DESC
      `;
        }
        const stmt = db.prepare(query);
        const rows = stmt.all(...params);
        const stats = rows.map(row => ({
            project: row.project,
            totalSessions: row.total_sessions,
            passed: row.passed || 0,
            failed: row.failed || 0,
            successRate: row.total_sessions > 0
                ? Math.round(((row.passed || 0) / row.total_sessions) * 100)
                : 0,
            avgDurationMinutes: row.avg_duration ? Math.round(row.avg_duration) : null,
            lastSession: row.last_session
        }));
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({ stats }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
function recordWorkPattern(project, workType, description, filesPattern, success, durationMinutes) {
    try {
        // 기존 패턴 확인
        const existingStmt = db.prepare(`
      SELECT id, success_rate, avg_duration_minutes, count
      FROM work_patterns
      WHERE project = ? AND work_type = ? AND description = ?
    `);
        const existing = existingStmt.get(project, workType, description);
        if (existing) {
            // 업데이트
            const newCount = existing.count + 1;
            const newSuccessRate = success !== undefined
                ? ((existing.success_rate * existing.count) + (success ? 1 : 0)) / newCount
                : existing.success_rate;
            const newAvgDuration = durationMinutes !== undefined
                ? ((existing.avg_duration_minutes * existing.count) + durationMinutes) / newCount
                : existing.avg_duration_minutes;
            const updateStmt = db.prepare(`
        UPDATE work_patterns
        SET success_rate = ?, avg_duration_minutes = ?, count = ?, last_used = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
            updateStmt.run(newSuccessRate, newAvgDuration, newCount, existing.id);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({ success: true, action: 'updated', count: newCount })
                    }]
            };
        }
        else {
            // 새로 삽입
            const insertStmt = db.prepare(`
        INSERT INTO work_patterns (project, work_type, description, files_pattern, success_rate, avg_duration_minutes)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
            insertStmt.run(project, workType, description, filesPattern || null, success ? 1 : 0, durationMinutes || 0);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({ success: true, action: 'created' })
                    }]
            };
        }
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
function getWorkPatterns(project, workType) {
    try {
        let query = 'SELECT * FROM work_patterns WHERE 1=1';
        const params = [];
        if (project) {
            query += ' AND project = ?';
            params.push(project);
        }
        if (workType) {
            query += ' AND work_type = ?';
            params.push(workType);
        }
        query += ' ORDER BY count DESC, last_used DESC';
        const stmt = db.prepare(query);
        const rows = stmt.all(...params);
        const patterns = rows.map(row => ({
            project: row.project,
            workType: row.work_type,
            description: row.description,
            filesPattern: row.files_pattern,
            successRate: Math.round(row.success_rate * 100),
            avgDurationMinutes: Math.round(row.avg_duration_minutes),
            usageCount: row.count,
            lastUsed: row.last_used
        }));
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({ patterns, count: patterns.length }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
async function storeMemory(content, memoryType, tags, project, importance, metadata) {
    try {
        const stmt = db.prepare(`
      INSERT INTO memories (content, memory_type, tags, project, importance, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
        const result = stmt.run(content, memoryType, tags ? JSON.stringify(tags) : null, project || null, importance || 5, metadata ? JSON.stringify(metadata) : null);
        const memoryId = result.lastInsertRowid;
        // 백그라운드에서 임베딩 생성 (비동기, 실패해도 메모리는 저장됨)
        generateEmbedding(content).then(embedding => {
            if (embedding) {
                try {
                    const embStmt = db.prepare(`
            INSERT OR REPLACE INTO embeddings (memory_id, embedding)
            VALUES (?, ?)
          `);
                    embStmt.run(memoryId, embeddingToBuffer(embedding));
                }
                catch (e) {
                    console.error('Failed to save embedding:', e);
                }
            }
        });
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        id: memoryId,
                        message: `메모리 저장 완료: ${memoryType}`,
                        embeddingStatus: embeddingReady ? 'generating' : 'model_loading'
                    })
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
function recallMemory(query, memoryType, project, limit = 10, minImportance = 1, maxContentLength = 500) {
    try {
        // FTS5 검색 쿼리 구성
        const searchTerms = query.split(/\s+/).filter(t => t.length > 0);
        const ftsQuery = searchTerms.map(t => `"${t}"*`).join(' OR ');
        let sql = `
      SELECT m.*, bm25(memories_fts) as rank
      FROM memories m
      JOIN memories_fts ON m.id = memories_fts.rowid
      WHERE memories_fts MATCH ? AND m.importance >= ?
    `;
        const params = [ftsQuery, minImportance];
        if (memoryType) {
            sql += ' AND m.memory_type = ?';
            params.push(memoryType);
        }
        if (project) {
            sql += ' AND m.project = ?';
            params.push(project);
        }
        sql += ' ORDER BY rank LIMIT ?';
        params.push(limit);
        const stmt = db.prepare(sql);
        const rows = stmt.all(...params);
        // 접근 횟수 업데이트
        const updateStmt = db.prepare(`
      UPDATE memories SET accessed_at = CURRENT_TIMESTAMP, access_count = access_count + 1
      WHERE id = ?
    `);
        rows.forEach(row => updateStmt.run(row.id));
        const memories = rows.map(row => {
            const contentTruncated = maxContentLength > 0 && row.content.length > maxContentLength;
            return {
                id: row.id,
                content: contentTruncated ? row.content.slice(0, maxContentLength) + '...' : row.content,
                contentTruncated,
                type: row.memory_type,
                tags: row.tags ? JSON.parse(row.tags) : [],
                project: row.project,
                importance: row.importance,
                createdAt: row.created_at,
                accessCount: row.access_count + 1,
                relevance: Math.abs(row.rank)
            };
        });
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        query,
                        found: memories.length,
                        memories
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        // FTS 검색 실패 시 LIKE 폴백
        try {
            let sql = `
        SELECT * FROM memories
        WHERE (content LIKE ? OR tags LIKE ?) AND importance >= ?
      `;
            const likePattern = `%${query}%`;
            const params = [likePattern, likePattern, minImportance];
            if (memoryType) {
                sql += ' AND memory_type = ?';
                params.push(memoryType);
            }
            if (project) {
                sql += ' AND project = ?';
                params.push(project);
            }
            sql += ' ORDER BY importance DESC, created_at DESC LIMIT ?';
            params.push(limit);
            const stmt = db.prepare(sql);
            const rows = stmt.all(...params);
            const memories = rows.map(row => ({
                id: row.id,
                content: row.content,
                type: row.memory_type,
                tags: row.tags ? JSON.parse(row.tags) : [],
                project: row.project,
                importance: row.importance,
                createdAt: row.created_at
            }));
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            query,
                            found: memories.length,
                            memories,
                            note: 'Used LIKE fallback'
                        }, null, 2)
                    }]
            };
        }
        catch (fallbackError) {
            return {
                content: [{ type: 'text', text: `Error: ${fallbackError}` }],
                isError: true
            };
        }
    }
}
function recallByTimeframe(timeframe, memoryType, project, limit = 20) {
    try {
        const timeConditions = {
            'today': "date(created_at) = date('now')",
            'yesterday': "date(created_at) = date('now', '-1 day')",
            'this_week': "created_at >= date('now', '-7 days')",
            'last_week': "created_at >= date('now', '-14 days') AND created_at < date('now', '-7 days')",
            'this_month': "created_at >= date('now', '-30 days')",
            'last_month': "created_at >= date('now', '-60 days') AND created_at < date('now', '-30 days')"
        };
        const timeCondition = timeConditions[timeframe];
        if (!timeCondition) {
            return {
                content: [{ type: 'text', text: `Invalid timeframe: ${timeframe}` }],
                isError: true
            };
        }
        let sql = `SELECT * FROM memories WHERE ${timeCondition}`;
        const params = [];
        if (memoryType) {
            sql += ' AND memory_type = ?';
            params.push(memoryType);
        }
        if (project) {
            sql += ' AND project = ?';
            params.push(project);
        }
        sql += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);
        const stmt = db.prepare(sql);
        const rows = stmt.all(...params);
        const memories = rows.map(row => ({
            id: row.id,
            content: row.content,
            type: row.memory_type,
            tags: row.tags ? JSON.parse(row.tags) : [],
            project: row.project,
            importance: row.importance,
            createdAt: row.created_at
        }));
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        timeframe,
                        found: memories.length,
                        memories
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
function searchByTag(tags, matchAll = false, limit = 20) {
    try {
        const stmt = db.prepare(`SELECT * FROM memories ORDER BY importance DESC, created_at DESC`);
        const allRows = stmt.all();
        const filteredRows = allRows.filter(row => {
            if (!row.tags)
                return false;
            const memoryTags = JSON.parse(row.tags);
            if (matchAll) {
                return tags.every(tag => memoryTags.includes(tag));
            }
            else {
                return tags.some(tag => memoryTags.includes(tag));
            }
        }).slice(0, limit);
        const memories = filteredRows.map(row => ({
            id: row.id,
            content: row.content,
            type: row.memory_type,
            tags: JSON.parse(row.tags),
            project: row.project,
            importance: row.importance,
            createdAt: row.created_at
        }));
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        searchTags: tags,
                        matchAll,
                        found: memories.length,
                        memories
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
function createRelation(sourceId, targetId, relationType, strength = 1.0) {
    try {
        const stmt = db.prepare(`
      INSERT OR REPLACE INTO memory_relations (source_id, target_id, relation_type, strength)
      VALUES (?, ?, ?, ?)
    `);
        stmt.run(sourceId, targetId, relationType, strength);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        relation: { sourceId, targetId, relationType, strength }
                    })
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
function findConnectedMemories(memoryId, depth = 1, relationType) {
    try {
        const maxDepth = Math.min(depth, 3);
        const visited = new Set([memoryId]);
        const results = [];
        const findAtDepth = (currentIds, currentDepth) => {
            if (currentDepth > maxDepth || currentIds.length === 0)
                return;
            let sql = `
        SELECT m.*, mr.relation_type, mr.source_id, mr.target_id
        FROM memory_relations mr
        JOIN memories m ON (
          (mr.source_id IN (${currentIds.join(',')}) AND m.id = mr.target_id) OR
          (mr.target_id IN (${currentIds.join(',')}) AND m.id = mr.source_id)
        )
      `;
            if (relationType) {
                sql += ` WHERE mr.relation_type = '${relationType}'`;
            }
            const stmt = db.prepare(sql);
            const rows = stmt.all();
            const nextIds = [];
            for (const row of rows) {
                const connectedId = currentIds.includes(row.source_id) ? row.target_id : row.source_id;
                if (!visited.has(connectedId)) {
                    visited.add(connectedId);
                    nextIds.push(connectedId);
                    results.push({
                        memory: row,
                        relation: row.relation_type,
                        direction: row.source_id === memoryId ? 'outgoing' : 'incoming',
                        depth: currentDepth
                    });
                }
            }
            findAtDepth(nextIds, currentDepth + 1);
        };
        findAtDepth([memoryId], 1);
        const connected = results.map(r => ({
            id: r.memory.id,
            content: r.memory.content,
            type: r.memory.memory_type,
            relation: r.relation,
            direction: r.direction,
            depth: r.depth
        }));
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        sourceMemoryId: memoryId,
                        depth: maxDepth,
                        found: connected.length,
                        connected
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
function getMemoryStats() {
    try {
        const totalStmt = db.prepare('SELECT COUNT(*) as count FROM memories');
        const total = totalStmt.get().count;
        const byTypeStmt = db.prepare(`
      SELECT memory_type, COUNT(*) as count
      FROM memories
      GROUP BY memory_type
      ORDER BY count DESC
    `);
        const byType = byTypeStmt.all();
        const byProjectStmt = db.prepare(`
      SELECT project, COUNT(*) as count
      FROM memories
      WHERE project IS NOT NULL
      GROUP BY project
      ORDER BY count DESC
    `);
        const byProject = byProjectStmt.all();
        const relationsStmt = db.prepare('SELECT COUNT(*) as count FROM memory_relations');
        const relationsCount = relationsStmt.get().count;
        const recentStmt = db.prepare(`
      SELECT * FROM memories
      ORDER BY created_at DESC
      LIMIT 5
    `);
        const recentRows = recentStmt.all();
        const recent = recentRows.map(row => ({
            id: row.id,
            content: row.content.slice(0, 100) + (row.content.length > 100 ? '...' : ''),
            type: row.memory_type,
            createdAt: row.created_at
        }));
        const mostAccessedStmt = db.prepare(`
      SELECT * FROM memories
      ORDER BY access_count DESC
      LIMIT 5
    `);
        const mostAccessedRows = mostAccessedStmt.all();
        const mostAccessed = mostAccessedRows.map(row => ({
            id: row.id,
            content: row.content.slice(0, 100) + (row.content.length > 100 ? '...' : ''),
            type: row.memory_type,
            accessCount: row.access_count
        }));
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        totalMemories: total,
                        totalRelations: relationsCount,
                        byType: Object.fromEntries(byType.map(t => [t.memory_type, t.count])),
                        byProject: Object.fromEntries(byProject.map(p => [p.project, p.count])),
                        recentMemories: recent,
                        mostAccessedMemories: mostAccessed
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
function deleteMemory(memoryId) {
    try {
        // 관계도 함께 삭제 (CASCADE)
        const stmt = db.prepare('DELETE FROM memories WHERE id = ?');
        const result = stmt.run(memoryId);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: result.changes > 0,
                        deleted: result.changes > 0 ? memoryId : null
                    })
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
// ===== 시맨틱 검색 핸들러 =====
async function semanticSearch(query, limit = 10, minSimilarity = 0.3, memoryType, project) {
    try {
        // 쿼리 임베딩 생성
        const queryEmbedding = await generateEmbedding(query);
        if (!queryEmbedding) {
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            error: 'Embedding model not ready',
                            fallback: 'Using FTS search instead'
                        })
                    }]
            };
        }
        // 모든 임베딩 가져오기
        let sql = `
      SELECT e.memory_id, e.embedding, m.*
      FROM embeddings e
      JOIN memories m ON e.memory_id = m.id
      WHERE 1=1
    `;
        const params = [];
        if (memoryType) {
            sql += ' AND m.memory_type = ?';
            params.push(memoryType);
        }
        if (project) {
            sql += ' AND m.project = ?';
            params.push(project);
        }
        const stmt = db.prepare(sql);
        const rows = stmt.all(...params);
        // 유사도 계산
        const results = rows.map(row => {
            const embedding = bufferToEmbedding(row.embedding);
            const similarity = cosineSimilarity(queryEmbedding, embedding);
            return { ...row, similarity };
        })
            .filter(r => r.similarity >= minSimilarity)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);
        // 접근 횟수 업데이트
        const updateStmt = db.prepare(`
      UPDATE memories SET accessed_at = CURRENT_TIMESTAMP, access_count = access_count + 1
      WHERE id = ?
    `);
        results.forEach(r => updateStmt.run(r.id));
        const memories = results.map(r => ({
            id: r.id,
            content: r.content,
            type: r.memory_type,
            tags: r.tags ? JSON.parse(r.tags) : [],
            project: r.project,
            importance: r.importance,
            createdAt: r.created_at,
            similarity: Math.round(r.similarity * 1000) / 1000
        }));
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        query,
                        searchType: 'semantic',
                        found: memories.length,
                        memories
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
async function rebuildEmbeddings(force = false) {
    try {
        let sql = 'SELECT id, content FROM memories';
        if (!force) {
            sql += ' WHERE id NOT IN (SELECT memory_id FROM embeddings)';
        }
        const stmt = db.prepare(sql);
        const rows = stmt.all();
        if (rows.length === 0) {
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({ message: 'No memories need embedding', processed: 0 })
                    }]
            };
        }
        let processed = 0;
        let failed = 0;
        for (const row of rows) {
            const embedding = await generateEmbedding(row.content);
            if (embedding) {
                try {
                    const embStmt = db.prepare(`
            INSERT OR REPLACE INTO embeddings (memory_id, embedding)
            VALUES (?, ?)
          `);
                    embStmt.run(row.id, embeddingToBuffer(embedding));
                    processed++;
                }
                catch {
                    failed++;
                }
            }
            else {
                failed++;
            }
        }
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        message: 'Embedding rebuild complete',
                        total: rows.length,
                        processed,
                        failed
                    })
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
function getEmbeddingStatus() {
    try {
        const totalMemories = db.prepare('SELECT COUNT(*) as count FROM memories').get().count;
        const totalEmbeddings = db.prepare('SELECT COUNT(*) as count FROM embeddings').get().count;
        const missingEmbeddings = totalMemories - totalEmbeddings;
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        modelReady: embeddingReady,
                        model: 'all-MiniLM-L6-v2',
                        dimensions: 384,
                        totalMemories,
                        totalEmbeddings,
                        missingEmbeddings,
                        coverage: totalMemories > 0 ? Math.round((totalEmbeddings / totalMemories) * 100) : 100
                    })
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
// ===== 자동 피드백 수집 핸들러 =====
const FEEDBACK_IMPORTANCE = {
    'bug': 8,
    'timeout': 7,
    'performance': 6,
    'feature-request': 5,
    'ux': 4,
    'none': 0
};
async function collectWorkFeedback(project, workSummary, feedbackType, verificationPassed, feedbackContent, affectedTool, duration) {
    try {
        const result = {
            workRecorded: false,
            feedbackRecorded: false,
            message: ''
        };
        // 1. 작업 기록 저장 (항상)
        try {
            const sessionStmt = db.prepare(`
        INSERT INTO sessions (project, last_work, verification_result, duration_minutes)
        VALUES (?, ?, ?, ?)
      `);
            sessionStmt.run(project, workSummary, verificationPassed ? 'passed' : 'failed', duration || null);
            result.workRecorded = true;
        }
        catch (e) {
            console.error('Failed to record work session:', e);
        }
        // 2. 피드백이 있으면 메모리에 저장
        if (feedbackType !== 'none' && feedbackContent) {
            const importance = FEEDBACK_IMPORTANCE[feedbackType] || 5;
            const tags = ['mcp-feedback', feedbackType];
            if (affectedTool) {
                tags.push(affectedTool);
            }
            const content = `[MCP 피드백] ${feedbackContent}${affectedTool ? ` (도구: ${affectedTool})` : ''}`;
            const memoryStmt = db.prepare(`
        INSERT INTO memories (content, memory_type, tags, project, importance, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
            const memoryResult = memoryStmt.run(content, 'feedback', JSON.stringify(tags), 'project-manager-mcp', importance, JSON.stringify({
                sourceProject: project,
                workSummary,
                feedbackType,
                affectedTool,
                verificationPassed,
                collectedAt: new Date().toISOString()
            }));
            result.feedbackRecorded = true;
            result.feedbackId = memoryResult.lastInsertRowid;
            // 임베딩 생성 (백그라운드)
            generateEmbedding(content).then(embedding => {
                if (embedding) {
                    try {
                        const embStmt = db.prepare(`
              INSERT OR REPLACE INTO embeddings (memory_id, embedding)
              VALUES (?, ?)
            `);
                        embStmt.run(result.feedbackId, embeddingToBuffer(embedding));
                    }
                    catch (e) {
                        console.error('Failed to save feedback embedding:', e);
                    }
                }
            });
        }
        // 결과 메시지 생성
        const messages = [];
        if (result.workRecorded) {
            messages.push(`작업 기록 저장됨: ${project}`);
        }
        if (result.feedbackRecorded) {
            messages.push(`피드백 저장됨 (ID: ${result.feedbackId}, 유형: ${feedbackType})`);
        }
        if (!result.workRecorded && !result.feedbackRecorded) {
            messages.push('저장된 내용 없음');
        }
        result.message = messages.join(', ');
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify(result, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
function getPendingFeedbacks(feedbackType, limit = 20) {
    try {
        let sql = `
      SELECT * FROM memories
      WHERE memory_type = 'feedback'
        AND tags LIKE '%mcp-feedback%'
    `;
        const params = [];
        if (feedbackType) {
            sql += ` AND tags LIKE ?`;
            params.push(`%${feedbackType}%`);
        }
        sql += ` ORDER BY importance DESC, created_at DESC LIMIT ?`;
        params.push(limit);
        const stmt = db.prepare(sql);
        const rows = stmt.all(...params);
        const feedbacks = rows.map(row => {
            const metadata = row.metadata ? JSON.parse(row.metadata) : {};
            const tags = row.tags ? JSON.parse(row.tags) : [];
            return {
                id: row.id,
                content: row.content.replace('[MCP 피드백] ', ''),
                type: tags.find((t) => ['bug', 'timeout', 'feature-request', 'ux', 'performance'].includes(t)) || 'unknown',
                affectedTool: metadata.affectedTool || null,
                sourceProject: metadata.sourceProject || null,
                importance: row.importance,
                createdAt: row.created_at
            };
        });
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        found: feedbacks.length,
                        feedbacks
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
function resolveFeedback(feedbackId, resolution) {
    try {
        // 피드백 존재 확인
        const checkStmt = db.prepare('SELECT * FROM memories WHERE id = ? AND memory_type = ?');
        const existing = checkStmt.get(feedbackId, 'feedback');
        if (!existing) {
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({ success: false, error: 'Feedback not found' })
                    }]
            };
        }
        // 해결 기록 저장 (선택사항)
        if (resolution) {
            const metadata = existing.metadata ? JSON.parse(existing.metadata) : {};
            metadata.resolved = true;
            metadata.resolution = resolution;
            metadata.resolvedAt = new Date().toISOString();
            const updateStmt = db.prepare('UPDATE memories SET metadata = ? WHERE id = ?');
            updateStmt.run(JSON.stringify(metadata), feedbackId);
        }
        // 피드백 삭제
        const deleteStmt = db.prepare('DELETE FROM memories WHERE id = ?');
        deleteStmt.run(feedbackId);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        resolvedId: feedbackId,
                        resolution: resolution || 'No resolution provided'
                    })
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
// ===== Content Filtering 학습/회피 핸들러 =====
function recordFilterPattern(patternType, patternDescription, fileExtension, exampleContext, mitigationStrategy) {
    try {
        // 기존 유사 패턴 확인
        const existingStmt = db.prepare(`
      SELECT id, occurrence_count FROM content_filter_patterns
      WHERE pattern_type = ? AND pattern_description = ?
    `);
        const existing = existingStmt.get(patternType, patternDescription);
        if (existing) {
            // 기존 패턴 업데이트
            const updateStmt = db.prepare(`
        UPDATE content_filter_patterns
        SET occurrence_count = occurrence_count + 1,
            last_occurred = CURRENT_TIMESTAMP,
            mitigation_strategy = COALESCE(?, mitigation_strategy)
        WHERE id = ?
      `);
            updateStmt.run(mitigationStrategy || null, existing.id);
            // 캐시 갱신
            loadContentFilterPatterns();
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            action: 'updated',
                            id: existing.id,
                            occurrenceCount: existing.occurrence_count + 1
                        })
                    }]
            };
        }
        else {
            // 새 패턴 추가
            const insertStmt = db.prepare(`
        INSERT INTO content_filter_patterns
        (pattern_type, pattern_description, file_extension, example_context, mitigation_strategy)
        VALUES (?, ?, ?, ?, ?)
      `);
            const result = insertStmt.run(patternType, patternDescription, fileExtension || null, exampleContext || null, mitigationStrategy || null);
            // 캐시 갱신
            loadContentFilterPatterns();
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            action: 'created',
                            id: result.lastInsertRowid
                        })
                    }]
            };
        }
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
function getFilterPatterns(patternType, fileExtension) {
    try {
        let sql = 'SELECT * FROM content_filter_patterns WHERE 1=1';
        const params = [];
        if (patternType) {
            sql += ' AND pattern_type = ?';
            params.push(patternType);
        }
        if (fileExtension) {
            sql += ' AND file_extension = ?';
            params.push(fileExtension);
        }
        sql += ' ORDER BY occurrence_count DESC, last_occurred DESC';
        const stmt = db.prepare(sql);
        const rows = stmt.all(...params);
        const patterns = rows.map(row => ({
            id: row.id,
            patternType: row.pattern_type,
            patternDescription: row.pattern_description,
            fileExtension: row.file_extension,
            exampleContext: row.example_context,
            mitigationStrategy: row.mitigation_strategy,
            occurrenceCount: row.occurrence_count,
            lastOccurred: row.last_occurred
        }));
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        found: patterns.length,
                        patterns
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
function getProjectContext(project) {
    try {
        // Layer 1: 고정 컨텍스트
        const fixedStmt = db.prepare(`SELECT * FROM project_context WHERE project = ?`);
        const fixed = fixedStmt.get(project);
        // Layer 2: 활성 컨텍스트
        const activeStmt = db.prepare(`SELECT * FROM active_context WHERE project = ?`);
        const active = activeStmt.get(project);
        // Layer 3: 미완료 태스크 (상위 3개만)
        const tasksStmt = db.prepare(`
      SELECT id, title, status FROM tasks
      WHERE project = ? AND status IN ('pending', 'in_progress', 'blocked')
      ORDER BY
        CASE status WHEN 'in_progress' THEN 0 WHEN 'blocked' THEN 1 ELSE 2 END,
        priority DESC
      LIMIT 3
    `);
        const topTasks = tasksStmt.all(project);
        // 전체 미완료 태스크 수
        const countStmt = db.prepare(`
      SELECT COUNT(*) as count FROM tasks
      WHERE project = ? AND status IN ('pending', 'in_progress', 'blocked')
    `);
        const countResult = countStmt.get(project);
        const result = {
            project,
            tokenEstimate: 0,
            fixed: {
                techStack: fixed?.tech_stack ? JSON.parse(fixed.tech_stack) : null,
                architecture: fixed?.architecture_decisions ? JSON.parse(fixed.architecture_decisions) : [],
                patterns: fixed?.code_patterns ? JSON.parse(fixed.code_patterns) : [],
                specialNotes: fixed?.special_notes || null
            },
            active: {
                state: active?.current_state || null,
                tasks: topTasks,
                recentFiles: active?.recent_files ? JSON.parse(active.recent_files) : [],
                blockers: active?.blockers || null,
                lastVerification: active?.last_verification || null
            },
            pendingTaskCount: countResult.count
        };
        // 토큰 추정 (대략 4자 = 1토큰)
        const jsonStr = JSON.stringify(result);
        result.tokenEstimate = Math.ceil(jsonStr.length / 4);
        // 사용 통계 기록
        recordContextAccess(project, 'get');
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify(result, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
function updateActiveContext(project, currentState, recentFiles, blockers, lastVerification) {
    try {
        // 활성 태스크 자동 조회
        const tasksStmt = db.prepare(`
      SELECT id, title, status FROM tasks
      WHERE project = ? AND status IN ('in_progress', 'blocked')
      ORDER BY priority DESC LIMIT 3
    `);
        const activeTasks = tasksStmt.all(project);
        const stmt = db.prepare(`
      INSERT INTO active_context (project, current_state, active_tasks, recent_files, blockers, last_verification, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(project) DO UPDATE SET
        current_state = excluded.current_state,
        active_tasks = excluded.active_tasks,
        recent_files = excluded.recent_files,
        blockers = excluded.blockers,
        last_verification = excluded.last_verification,
        updated_at = CURRENT_TIMESTAMP
    `);
        stmt.run(project, currentState, JSON.stringify(activeTasks), recentFiles ? JSON.stringify(recentFiles.slice(0, 10)) : null, blockers || null, lastVerification || null);
        // 사용 통계 기록
        recordContextAccess(project, 'update');
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        project,
                        updated: {
                            currentState,
                            activeTasks: activeTasks.length,
                            recentFiles: recentFiles?.length || 0,
                            blockers: !!blockers,
                            lastVerification
                        }
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
function initProjectContext(project, techStack, architectureDecisions, codePatterns, specialNotes) {
    try {
        const stmt = db.prepare(`
      INSERT INTO project_context (project, tech_stack, architecture_decisions, code_patterns, special_notes, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(project) DO UPDATE SET
        tech_stack = COALESCE(excluded.tech_stack, project_context.tech_stack),
        architecture_decisions = COALESCE(excluded.architecture_decisions, project_context.architecture_decisions),
        code_patterns = COALESCE(excluded.code_patterns, project_context.code_patterns),
        special_notes = COALESCE(excluded.special_notes, project_context.special_notes),
        updated_at = CURRENT_TIMESTAMP
    `);
        stmt.run(project, techStack ? JSON.stringify(techStack) : null, architectureDecisions ? JSON.stringify(architectureDecisions.slice(0, 5)) : null, codePatterns ? JSON.stringify(codePatterns.slice(0, 5)) : null, specialNotes || null);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        project,
                        initialized: {
                            techStack: !!techStack,
                            architectureDecisions: architectureDecisions?.length || 0,
                            codePatterns: codePatterns?.length || 0,
                            specialNotes: !!specialNotes
                        }
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
function updateArchitectureDecision(project, decision) {
    try {
        // 기존 결정들 조회
        const selectStmt = db.prepare(`SELECT architecture_decisions FROM project_context WHERE project = ?`);
        const row = selectStmt.get(project);
        let decisions = [];
        if (row?.architecture_decisions) {
            decisions = JSON.parse(row.architecture_decisions);
        }
        // 중복 체크 및 추가 (최대 5개, 최신이 앞으로)
        if (!decisions.includes(decision)) {
            decisions.unshift(decision);
            decisions = decisions.slice(0, 5);
        }
        const stmt = db.prepare(`
      INSERT INTO project_context (project, architecture_decisions, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(project) DO UPDATE SET
        architecture_decisions = excluded.architecture_decisions,
        updated_at = CURRENT_TIMESTAMP
    `);
        stmt.run(project, JSON.stringify(decisions));
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        project,
                        decision,
                        totalDecisions: decisions.length
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
// ===== 태스크 관리 핸들러 =====
function addTask(project, title, description, priority = 5, relatedFiles, acceptanceCriteria) {
    try {
        const stmt = db.prepare(`
      INSERT INTO tasks (project, title, description, priority, related_files, acceptance_criteria)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
        const result = stmt.run(project, title, description || null, Math.min(10, Math.max(1, priority)), relatedFiles ? JSON.stringify(relatedFiles) : null, acceptanceCriteria || null);
        // 활성 컨텍스트의 태스크 목록 자동 업데이트
        syncActiveTasksToContext(project);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        taskId: result.lastInsertRowid,
                        project,
                        title,
                        priority
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
function completeTask(taskId) {
    try {
        const stmt = db.prepare(`
      UPDATE tasks SET status = 'done', completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
        const result = stmt.run(taskId);
        if (result.changes === 0) {
            return {
                content: [{ type: 'text', text: `Task ${taskId} not found` }],
                isError: true
            };
        }
        // 프로젝트 조회해서 활성 컨텍스트 업데이트
        const taskStmt = db.prepare(`SELECT project, title FROM tasks WHERE id = ?`);
        const task = taskStmt.get(taskId);
        if (task) {
            syncActiveTasksToContext(task.project);
        }
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        taskId,
                        title: task?.title,
                        status: 'done'
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
function updateTaskStatus(taskId, status) {
    try {
        const validStatuses = ['pending', 'in_progress', 'done', 'blocked'];
        if (!validStatuses.includes(status)) {
            return {
                content: [{ type: 'text', text: `Invalid status. Use: ${validStatuses.join(', ')}` }],
                isError: true
            };
        }
        const stmt = db.prepare(`
      UPDATE tasks SET status = ?,
        completed_at = CASE WHEN ? = 'done' THEN CURRENT_TIMESTAMP ELSE completed_at END
      WHERE id = ?
    `);
        const result = stmt.run(status, status, taskId);
        if (result.changes === 0) {
            return {
                content: [{ type: 'text', text: `Task ${taskId} not found` }],
                isError: true
            };
        }
        // 프로젝트 조회해서 활성 컨텍스트 업데이트
        const taskStmt = db.prepare(`SELECT project, title FROM tasks WHERE id = ?`);
        const task = taskStmt.get(taskId);
        if (task) {
            syncActiveTasksToContext(task.project);
        }
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        taskId,
                        title: task?.title,
                        newStatus: status
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
function getPendingTasks(project, includeBlocked = true) {
    try {
        const statusFilter = includeBlocked
            ? `('pending', 'in_progress', 'blocked')`
            : `('pending', 'in_progress')`;
        const stmt = db.prepare(`
      SELECT id, title, description, status, priority, related_files, acceptance_criteria, created_at
      FROM tasks
      WHERE project = ? AND status IN ${statusFilter}
      ORDER BY
        CASE status WHEN 'in_progress' THEN 0 WHEN 'blocked' THEN 1 ELSE 2 END,
        priority DESC,
        created_at ASC
    `);
        const tasks = stmt.all(project);
        const formattedTasks = tasks.map(t => ({
            id: t.id,
            title: t.title,
            description: t.description,
            status: t.status,
            priority: t.priority,
            relatedFiles: t.related_files ? JSON.parse(t.related_files) : [],
            acceptanceCriteria: t.acceptance_criteria,
            createdAt: t.created_at
        }));
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        project,
                        totalPending: formattedTasks.length,
                        tasks: formattedTasks
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
// 헬퍼: 활성 태스크를 active_context에 동기화
function syncActiveTasksToContext(project) {
    try {
        const tasksStmt = db.prepare(`
      SELECT id, title, status FROM tasks
      WHERE project = ? AND status IN ('in_progress', 'blocked')
      ORDER BY priority DESC LIMIT 3
    `);
        const activeTasks = tasksStmt.all(project);
        const updateStmt = db.prepare(`
      UPDATE active_context SET active_tasks = ?, updated_at = CURRENT_TIMESTAMP
      WHERE project = ?
    `);
        updateStmt.run(JSON.stringify(activeTasks), project);
    }
    catch {
        // 실패해도 무시 (active_context가 없을 수 있음)
    }
}
// ===== 에러 솔루션 아카이브 핸들러 =====
function recordSolution(errorSignature, solution, project, errorMessage, relatedFiles) {
    try {
        // 키워드 자동 추출 (에러 시그니처에서)
        const keywords = errorSignature
            .toLowerCase()
            .split(/[\s:.\-_]+/)
            .filter(w => w.length > 2)
            .slice(0, 10)
            .join(',');
        const stmt = db.prepare(`
      INSERT INTO resolved_issues (project, error_signature, error_message, solution, related_files, keywords)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
        const result = stmt.run(project || null, errorSignature, errorMessage || null, solution, relatedFiles ? JSON.stringify(relatedFiles) : null, keywords);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        solutionId: result.lastInsertRowid,
                        errorSignature,
                        keywords: keywords.split(',')
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
function findSolution(errorText, project) {
    try {
        // 1. 정확한 시그니처 매칭
        let stmt = db.prepare(`
      SELECT id, project, error_signature, solution, related_files, created_at
      FROM resolved_issues
      WHERE error_signature LIKE ?
      ${project ? 'AND (project = ? OR project IS NULL)' : ''}
      ORDER BY created_at DESC
      LIMIT 5
    `);
        let results = project
            ? stmt.all(`%${errorText}%`, project)
            : stmt.all(`%${errorText}%`);
        // 2. 시그니처 매칭 없으면 키워드 검색
        if (results.length === 0) {
            const keywords = errorText
                .toLowerCase()
                .split(/[\s:.\-_]+/)
                .filter(w => w.length > 2)
                .slice(0, 5);
            if (keywords.length > 0) {
                const keywordPattern = keywords.map(k => `keywords LIKE '%${k}%'`).join(' OR ');
                stmt = db.prepare(`
          SELECT id, project, error_signature, solution, related_files, created_at
          FROM resolved_issues
          WHERE (${keywordPattern})
          ${project ? 'AND (project = ? OR project IS NULL)' : ''}
          ORDER BY created_at DESC
          LIMIT 5
        `);
                results = project ? stmt.all(project) : stmt.all();
            }
        }
        const solutions = results.map(r => ({
            id: r.id,
            project: r.project,
            errorSignature: r.error_signature,
            solution: r.solution,
            relatedFiles: r.related_files ? JSON.parse(r.related_files) : [],
            createdAt: r.created_at
        }));
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        query: errorText.substring(0, 100),
                        found: solutions.length,
                        solutions
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
// ===== 시스템 평가/모니터링 =====
// 컨텍스트 접근 기록용 (평가에 사용)
function recordContextAccess(project, accessType) {
    try {
        // memories 테이블에 접근 로그 저장 (기존 시스템 활용)
        const stmt = db.prepare(`
      INSERT INTO memories (content, memory_type, tags, project, importance, metadata)
      VALUES (?, 'observation', ?, ?, 1, ?)
    `);
        stmt.run(`Context ${accessType}: ${project}`, JSON.stringify(['system', 'context-access', accessType]), project, JSON.stringify({ accessType, timestamp: new Date().toISOString() }));
    }
    catch {
        // 실패해도 무시
    }
}
function getContinuityStats(project) {
    try {
        const stats = {};
        // 1. 프로젝트 컨텍스트 현황
        if (project) {
            const contextStmt = db.prepare(`SELECT * FROM project_context WHERE project = ?`);
            const context = contextStmt.get(project);
            stats.hasProjectContext = !!context;
            const activeStmt = db.prepare(`SELECT * FROM active_context WHERE project = ?`);
            const active = activeStmt.get(project);
            stats.hasActiveContext = !!active;
        }
        // 2. 태스크 통계
        const taskStatsStmt = db.prepare(`
      SELECT
        ${project ? '' : 'project,'}
        status,
        COUNT(*) as count
      FROM tasks
      ${project ? 'WHERE project = ?' : ''}
      GROUP BY ${project ? 'status' : 'project, status'}
    `);
        const taskStats = project ? taskStatsStmt.all(project) : taskStatsStmt.all();
        stats.taskStats = taskStats;
        // 3. 솔루션 아카이브 통계
        const solutionStmt = db.prepare(`
      SELECT COUNT(*) as count FROM resolved_issues
      ${project ? 'WHERE project = ? OR project IS NULL' : ''}
    `);
        const solutionCount = (project ? solutionStmt.get(project) : solutionStmt.get());
        stats.solutionCount = solutionCount.count;
        // 4. 컨텍스트 접근 통계 (최근 7일)
        const accessStmt = db.prepare(`
      SELECT
        json_extract(metadata, '$.accessType') as accessType,
        COUNT(*) as count
      FROM memories
      WHERE memory_type = 'observation'
        AND tags LIKE '%context-access%'
        AND created_at > datetime('now', '-7 days')
        ${project ? 'AND project = ?' : ''}
      GROUP BY json_extract(metadata, '$.accessType')
    `);
        const accessStats = project ? accessStmt.all(project) : accessStmt.all();
        stats.contextAccessLast7Days = accessStats;
        // 5. 전체 프로젝트 수
        if (!project) {
            const projectCountStmt = db.prepare(`SELECT COUNT(DISTINCT project) as count FROM project_context`);
            const projectCount = projectCountStmt.get();
            stats.totalProjectsWithContext = projectCount.count;
        }
        // 6. 평가 메트릭
        stats.evaluation = {
            contextSystemUsed: stats.contextAccessLast7Days?.length > 0,
            hasTasks: taskStats.length > 0,
            hasSolutions: solutionCount.count > 0,
            recommendation: generateRecommendation(stats)
        };
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify(stats, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
function generateRecommendation(stats) {
    const issues = [];
    if (!stats.hasProjectContext && stats.hasProjectContext !== undefined) {
        issues.push('init_project_context로 프로젝트 컨텍스트 초기화 필요');
    }
    if (stats.contextAccessLast7Days?.length === 0) {
        issues.push('/work 시작 시 get_project_context 호출 권장');
    }
    if (stats.solutionCount === 0) {
        issues.push('에러 해결 시 record_solution으로 기록하면 재활용 가능');
    }
    return issues.length > 0 ? issues.join('; ') : '시스템 정상 활용 중';
}
function getSafeOutputGuidelines(context) {
    try {
        // 캐시된 패턴에서 가이드라인 생성
        const guidelines = [];
        const relevantPatterns = [];
        // 컨텍스트 기반 필터링
        if (context) {
            const contextLower = context.toLowerCase();
            for (const pattern of contentFilterPatterns) {
                // 파일 확장자 매칭
                if (pattern.fileExtension && contextLower.includes(pattern.fileExtension.replace('.', ''))) {
                    relevantPatterns.push(pattern);
                    continue;
                }
                // 패턴 설명 매칭
                if (pattern.patternDescription.toLowerCase().split(' ').some(word => word.length > 3 && contextLower.includes(word))) {
                    relevantPatterns.push(pattern);
                }
            }
        }
        else {
            // 모든 패턴 사용
            relevantPatterns.push(...contentFilterPatterns);
        }
        // 기본 가이드라인
        guidelines.push('1. 긴 코드 블록은 500자 이내로 요약하거나 청크로 분할');
        guidelines.push('2. 파일 전체 내용 대신 핵심 부분만 인용');
        guidelines.push('3. 바이너리/인코딩된 데이터는 메타정보만 출력');
        // 학습된 패턴 기반 가이드라인
        for (const pattern of relevantPatterns.slice(0, 5)) {
            if (pattern.mitigationStrategy) {
                guidelines.push(`- [${pattern.patternType}] ${pattern.mitigationStrategy}`);
            }
        }
        // 파일 확장자별 특별 주의사항
        const extensionWarnings = {};
        for (const pattern of contentFilterPatterns) {
            if (pattern.fileExtension && pattern.mitigationStrategy) {
                extensionWarnings[pattern.fileExtension] = pattern.mitigationStrategy;
            }
        }
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        context: context || 'general',
                        guidelines,
                        extensionSpecificWarnings: extensionWarnings,
                        relevantPatternsCount: relevantPatterns.length,
                        totalPatternsLearned: contentFilterPatterns.length
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
async function autoLearnDecision(args) {
    try {
        const { project, decision, reason, context, alternatives, files } = args;
        const content = `[결정] ${decision}\n이유: ${reason}${context ? `\n맥락: ${context}` : ''}${alternatives?.length ? `\n대안: ${alternatives.join(', ')}` : ''}`;
        const metadata = {
            type: 'decision',
            alternatives,
            files,
            context
        };
        const stmt = db.prepare(`
      INSERT INTO memories (content, memory_type, tags, project, importance, metadata)
      VALUES (?, 'decision', ?, ?, 7, ?)
    `);
        const tags = JSON.stringify(['decision', project, ...(files?.map(f => path.basename(f)) || [])]);
        const result = stmt.run(content, tags, project, JSON.stringify(metadata));
        const memoryId = result.lastInsertRowid;
        // 백그라운드 임베딩 생성
        generateEmbedding(content).then(embedding => {
            if (embedding) {
                try {
                    const embStmt = db.prepare(`INSERT OR REPLACE INTO embeddings (memory_id, embedding) VALUES (?, ?)`);
                    embStmt.run(memoryId, embeddingToBuffer(embedding));
                }
                catch { }
            }
        });
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        id: result.lastInsertRowid,
                        message: `결정 기록 저장됨: ${decision}`,
                        project
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
async function autoLearnFix(args) {
    try {
        const { project, error, cause, solution, files, preventionTip } = args;
        const content = `[에러] ${error}\n${cause ? `원인: ${cause}\n` : ''}해결: ${solution}${preventionTip ? `\n예방: ${preventionTip}` : ''}`;
        const metadata = {
            type: 'fix',
            error,
            cause,
            solution,
            files,
            preventionTip
        };
        const stmt = db.prepare(`
      INSERT INTO memories (content, memory_type, tags, project, importance, metadata)
      VALUES (?, 'error', ?, ?, 8, ?)
    `);
        const tags = JSON.stringify(['fix', 'error', project, ...(files?.map(f => path.basename(f)) || [])]);
        const result = stmt.run(content, tags, project, JSON.stringify(metadata));
        const memoryId = result.lastInsertRowid;
        // 백그라운드 임베딩 생성
        generateEmbedding(content).then(embedding => {
            if (embedding) {
                try {
                    const embStmt = db.prepare(`INSERT OR REPLACE INTO embeddings (memory_id, embedding) VALUES (?, ?)`);
                    embStmt.run(memoryId, embeddingToBuffer(embedding));
                }
                catch { }
            }
        });
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        id: result.lastInsertRowid,
                        message: `에러 해결 기록 저장됨`,
                        error: error.substring(0, 100),
                        project
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
async function autoLearnPattern(args) {
    try {
        const { project, patternName, description, example, appliesTo } = args;
        const content = `[패턴] ${patternName}\n${description}${appliesTo ? `\n적용 대상: ${appliesTo}` : ''}${example ? `\n예시: ${example}` : ''}`;
        const metadata = {
            type: 'pattern',
            patternName,
            example,
            appliesTo
        };
        const stmt = db.prepare(`
      INSERT INTO memories (content, memory_type, tags, project, importance, metadata)
      VALUES (?, 'pattern', ?, ?, 6, ?)
    `);
        const tags = JSON.stringify(['pattern', project, patternName.toLowerCase().replace(/\s+/g, '-')]);
        const result = stmt.run(content, tags, project, JSON.stringify(metadata));
        const memoryId = result.lastInsertRowid;
        generateEmbedding(content).then(embedding => {
            if (embedding) {
                try {
                    const embStmt = db.prepare(`INSERT OR REPLACE INTO embeddings (memory_id, embedding) VALUES (?, ?)`);
                    embStmt.run(memoryId, embeddingToBuffer(embedding));
                }
                catch { }
            }
        });
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        id: result.lastInsertRowid,
                        message: `패턴 기록 저장됨: ${patternName}`,
                        project
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
async function autoLearnDependency(args) {
    try {
        const { project, dependency, action, fromVersion, toVersion, reason, breakingChanges } = args;
        const actionText = {
            add: '추가',
            remove: '제거',
            upgrade: '업그레이드',
            downgrade: '다운그레이드'
        }[action];
        const versionInfo = fromVersion && toVersion
            ? `${fromVersion} → ${toVersion}`
            : toVersion || fromVersion || '';
        const content = `[의존성] ${dependency} ${actionText}${versionInfo ? ` (${versionInfo})` : ''}\n이유: ${reason}${breakingChanges ? `\nBreaking changes: ${breakingChanges}` : ''}`;
        const metadata = {
            type: 'dependency',
            dependency,
            action,
            fromVersion,
            toVersion,
            breakingChanges
        };
        const stmt = db.prepare(`
      INSERT INTO memories (content, memory_type, tags, project, importance, metadata)
      VALUES (?, 'learning', ?, ?, 6, ?)
    `);
        const tags = JSON.stringify(['dependency', action, project, dependency.toLowerCase()]);
        const result = stmt.run(content, tags, project, JSON.stringify(metadata));
        const memoryId = result.lastInsertRowid;
        generateEmbedding(content).then(embedding => {
            if (embedding) {
                try {
                    const embStmt = db.prepare(`INSERT OR REPLACE INTO embeddings (memory_id, embedding) VALUES (?, ?)`);
                    embStmt.run(memoryId, embeddingToBuffer(embedding));
                }
                catch { }
            }
        });
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        id: result.lastInsertRowid,
                        message: `의존성 변경 기록됨: ${dependency} ${actionText}`,
                        project
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
function getProjectKnowledge(project, knowledgeType = 'all', limit = 20) {
    try {
        let query = `
      SELECT id, content, memory_type, tags, importance, created_at, metadata
      FROM memories
      WHERE project = ?
    `;
        const params = [project];
        if (knowledgeType !== 'all') {
            const typeMap = {
                'decision': 'decision',
                'fix': 'error',
                'pattern': 'pattern',
                'dependency': 'learning'
            };
            query += ` AND memory_type = ?`;
            params.push(typeMap[knowledgeType] || knowledgeType);
        }
        query += ` ORDER BY created_at DESC LIMIT ?`;
        params.push(limit);
        const stmt = db.prepare(query);
        const rows = stmt.all(...params);
        const knowledge = rows.map(row => {
            let metadata = {};
            try {
                metadata = JSON.parse(row.metadata || '{}');
            }
            catch { }
            const metaObj = metadata;
            const typeValue = typeof metaObj.type === 'string' ? metaObj.type : row.memory_type;
            return {
                id: row.id,
                type: typeValue,
                content: row.content,
                importance: row.importance,
                createdAt: row.created_at
            };
        });
        // 유형별 통계
        const stats = {};
        for (const k of knowledge) {
            const typeKey = k.type;
            stats[typeKey] = (stats[typeKey] || 0) + 1;
        }
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        project,
                        totalKnowledge: knowledge.length,
                        stats,
                        knowledge: knowledge.slice(0, limit)
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
async function getSimilarIssues(errorOrIssue, project, limit = 5) {
    try {
        // 먼저 시맨틱 검색 시도
        if (embeddingPipeline) {
            const result = await semanticSearch(errorOrIssue, limit, 0.3, 'error', project);
            const resultText = JSON.parse(result.content[0].text);
            if (resultText.found > 0) {
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify({
                                searchType: 'semantic',
                                query: errorOrIssue.substring(0, 100),
                                found: resultText.found,
                                solutions: resultText.results.map((r) => ({
                                    id: r.id,
                                    similarity: r.similarity,
                                    content: r.content,
                                    project: r.project
                                }))
                            }, null, 2)
                        }]
                };
            }
        }
        // 시맨틱 검색 결과 없으면 FTS 검색
        const keywords = errorOrIssue.split(/\s+/).filter(w => w.length > 3).slice(0, 5);
        const ftsQuery = keywords.join(' OR ');
        let query = `
      SELECT m.id, m.content, m.project, m.metadata
      FROM memories_fts fts
      JOIN memories m ON m.id = fts.rowid
      WHERE memories_fts MATCH ?
      AND m.memory_type = 'error'
    `;
        const params = [ftsQuery];
        if (project) {
            query += ` AND m.project = ?`;
            params.push(project);
        }
        query += ` LIMIT ?`;
        params.push(limit);
        const stmt = db.prepare(query);
        const rows = stmt.all(...params);
        const solutions = rows.map(row => {
            let metadata = {};
            try {
                metadata = JSON.parse(row.metadata || '{}');
            }
            catch { }
            return {
                id: row.id,
                content: row.content,
                project: row.project,
                solution: metadata.solution
            };
        });
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        searchType: 'fts',
                        query: errorOrIssue.substring(0, 100),
                        found: solutions.length,
                        solutions
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
// ===== 요청 핸들러 등록 =====
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    switch (name) {
        case 'list_projects':
            return listProjects();
        case 'get_session':
            return getSession(args?.project, args?.includeRaw || false, args?.maxContentLength ?? 2000);
        case 'update_session':
            return updateSession(args?.project, args?.lastWork, args?.currentStatus, args?.nextTasks, args?.modifiedFiles, args?.issues, args?.verificationResult);
        case 'get_tech_stack':
            return getTechStack(args?.project);
        case 'run_verification':
            return runVerification(args?.project, args?.gates);
        case 'detect_platform':
            return detectPlatform(args?.project);
        // ===== SQLite 기반 새 도구들 =====
        case 'save_session_history':
            return saveSessionHistory(args?.project, args?.lastWork, args?.currentStatus, args?.nextTasks, args?.modifiedFiles, args?.issues, args?.verificationResult, args?.durationMinutes);
        case 'get_session_history':
            return getSessionHistory(args?.project, args?.limit || 10, args?.keyword);
        case 'search_similar_work':
            return searchSimilarWork(args?.keyword, args?.project);
        case 'get_project_stats':
            return getProjectStats(args?.project);
        case 'record_work_pattern':
            return recordWorkPattern(args?.project, args?.workType, args?.description, args?.filesPattern, args?.success, args?.durationMinutes);
        case 'get_work_patterns':
            return getWorkPatterns(args?.project, args?.workType);
        // ===== 메모리 시스템 도구 =====
        case 'store_memory':
            return storeMemory(args?.content, args?.memoryType, args?.tags, args?.project, args?.importance, args?.metadata);
        case 'recall_memory':
            return recallMemory(args?.query, args?.memoryType, args?.project, args?.limit || 10, args?.minImportance || 1, args?.maxContentLength ?? 500);
        case 'recall_by_timeframe':
            return recallByTimeframe(args?.timeframe, args?.memoryType, args?.project, args?.limit || 20);
        case 'search_by_tag':
            return searchByTag(args?.tags, args?.matchAll || false, args?.limit || 20);
        case 'create_relation':
            return createRelation(args?.sourceId, args?.targetId, args?.relationType, args?.strength || 1.0);
        case 'find_connected_memories':
            return findConnectedMemories(args?.memoryId, args?.depth || 1, args?.relationType);
        case 'get_memory_stats':
            return getMemoryStats();
        case 'delete_memory':
            return deleteMemory(args?.memoryId);
        // ===== 시맨틱 검색 도구 =====
        case 'semantic_search':
            return semanticSearch(args?.query, args?.limit || 10, args?.minSimilarity || 0.3, args?.memoryType, args?.project);
        case 'rebuild_embeddings':
            return rebuildEmbeddings(args?.force || false);
        case 'get_embedding_status':
            return getEmbeddingStatus();
        // ===== 자동 피드백 수집 도구 =====
        case 'collect_work_feedback':
            return collectWorkFeedback(args?.project, args?.workSummary, args?.feedbackType, args?.verificationPassed, args?.feedbackContent, args?.affectedTool, args?.duration);
        case 'get_pending_feedbacks':
            return getPendingFeedbacks(args?.feedbackType, args?.limit || 20);
        case 'resolve_feedback':
            return resolveFeedback(args?.feedbackId, args?.resolution);
        // ===== Content Filtering 학습/회피 도구 =====
        case 'record_filter_pattern':
            return recordFilterPattern(args?.patternType, args?.patternDescription, args?.fileExtension, args?.exampleContext, args?.mitigationStrategy);
        case 'get_filter_patterns':
            return getFilterPatterns(args?.patternType, args?.fileExtension);
        case 'get_safe_output_guidelines':
            return getSafeOutputGuidelines(args?.context);
        // ===== 자동 학습 시스템 =====
        case 'auto_learn_decision':
            return await autoLearnDecision(args);
        case 'auto_learn_fix':
            return await autoLearnFix(args);
        case 'auto_learn_pattern':
            return await autoLearnPattern(args);
        case 'auto_learn_dependency':
            return await autoLearnDependency(args);
        case 'get_project_knowledge':
            return getProjectKnowledge(args?.project, args?.knowledgeType, args?.limit);
        case 'get_similar_issues':
            return await getSimilarIssues(args?.errorOrIssue, args?.project, args?.limit);
        // ===== 프로젝트 연속성 시스템 v2 =====
        case 'get_project_context':
            return getProjectContext(args?.project);
        case 'update_active_context':
            return updateActiveContext(args?.project, args?.currentState, args?.recentFiles, args?.blockers, args?.lastVerification);
        case 'init_project_context':
            return initProjectContext(args?.project, args?.techStack, args?.architectureDecisions, args?.codePatterns, args?.specialNotes);
        case 'update_architecture_decision':
            return updateArchitectureDecision(args?.project, args?.decision);
        // 태스크 관리
        case 'add_task':
            return addTask(args?.project, args?.title, args?.description, args?.priority, args?.relatedFiles, args?.acceptanceCriteria);
        case 'complete_task':
            return completeTask(args?.taskId);
        case 'update_task_status':
            return updateTaskStatus(args?.taskId, args?.status);
        case 'get_pending_tasks':
            return getPendingTasks(args?.project, args?.includeBlocked);
        // 에러 솔루션 아카이브
        case 'record_solution':
            return recordSolution(args?.errorSignature, args?.solution, args?.project, args?.errorMessage, args?.relatedFiles);
        case 'find_solution':
            return findSolution(args?.errorText, args?.project);
        // 시스템 평가
        case 'get_continuity_stats':
            return getContinuityStats(args?.project);
        default:
            return {
                content: [{ type: 'text', text: `Unknown tool: ${name}` }],
                isError: true
            };
    }
});
// ===== 서버 시작 =====
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Project Manager MCP Server running on stdio');
}
main().catch(console.error);
