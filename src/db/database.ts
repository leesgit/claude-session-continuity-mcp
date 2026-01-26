// SQLite 데이터베이스 초기화 및 관리
import Database, { Database as DatabaseType } from 'better-sqlite3';
import * as path from 'path';
import type { ContentFilterPattern } from '../types.js';

// 기본 경로 설정
export const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || '/Users/ibyeongchang/Documents/dev/ai-service-generator';
export const APPS_DIR = path.join(WORKSPACE_ROOT, 'apps');
const DB_PATH = path.join(WORKSPACE_ROOT, '.claude', 'sessions.db');

// 데이터베이스 인스턴스
export const db: DatabaseType = new Database(DB_PATH);

// Content Filtering 패턴 캐시
export let contentFilterPatterns: ContentFilterPattern[] = [];

// 테이블 생성
export function initDatabase() {
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

    -- ===== 메모리 시스템 테이블 =====

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

    -- FTS5 전체 텍스트 검색
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

    -- Layer 1: 프로젝트 고정 컨텍스트
    CREATE TABLE IF NOT EXISTS project_context (
      project TEXT PRIMARY KEY,
      tech_stack TEXT,
      architecture_decisions TEXT,
      code_patterns TEXT,
      special_notes TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Layer 2: 활성 작업 컨텍스트
    CREATE TABLE IF NOT EXISTS active_context (
      project TEXT PRIMARY KEY,
      current_state TEXT,
      active_tasks TEXT,
      recent_files TEXT,
      blockers TEXT,
      last_verification TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Layer 3: 태스크 백로그
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'pending',
      priority INTEGER DEFAULT 5,
      related_files TEXT,
      acceptance_criteria TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project, status);
    CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority DESC);

    -- Layer 3: 해결된 이슈 아카이브
    CREATE TABLE IF NOT EXISTS resolved_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT,
      error_signature TEXT NOT NULL,
      error_message TEXT,
      solution TEXT NOT NULL,
      related_files TEXT,
      keywords TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_issues_signature ON resolved_issues(error_signature);
    CREATE INDEX IF NOT EXISTS idx_issues_project ON resolved_issues(project);
  `);
}

// Content Filter 패턴 로드
export function loadContentFilterPatterns() {
  try {
    const stmt = db.prepare(`
      SELECT id, pattern_type, pattern_description, file_extension, mitigation_strategy
      FROM content_filter_patterns
      ORDER BY occurrence_count DESC
    `);
    const rows = stmt.all() as Array<{
      id: number;
      pattern_type: string;
      pattern_description: string;
      file_extension: string | null;
      mitigation_strategy: string | null;
    }>;
    contentFilterPatterns = rows.map(r => ({
      id: r.id,
      patternType: r.pattern_type,
      patternDescription: r.pattern_description,
      fileExtension: r.file_extension,
      mitigationStrategy: r.mitigation_strategy
    }));
  } catch {
    contentFilterPatterns = [];
  }
}

// 초기화
initDatabase();
loadContentFilterPatterns();
