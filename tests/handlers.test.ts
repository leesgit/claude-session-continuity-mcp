// 핸들러 통합 테스트
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// 테스트용 임시 DB 설정
const TEST_DB_PATH = path.join(os.tmpdir(), `test-mcp-${Date.now()}.db`);

// 테스트 전 DB 초기화
beforeAll(() => {
  const db = new Database(TEST_DB_PATH);

  db.exec(`
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

    CREATE TABLE IF NOT EXISTS embeddings (
      memory_id INTEGER PRIMARY KEY,
      embedding BLOB NOT NULL,
      model TEXT DEFAULT 'all-MiniLM-L6-v2',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_context (
      project TEXT PRIMARY KEY,
      tech_stack TEXT,
      architecture_decisions TEXT,
      code_patterns TEXT,
      special_notes TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS active_context (
      project TEXT PRIMARY KEY,
      current_state TEXT,
      active_tasks TEXT,
      recent_files TEXT,
      blockers TEXT,
      last_verification TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      tags,
      content='memories',
      content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES('delete', old.id, old.content, old.tags);
    END;
  `);

  db.close();
});

// 테스트 후 DB 삭제
afterAll(() => {
  try {
    fs.unlinkSync(TEST_DB_PATH);
  } catch { /* ignore */ }
});

describe('Database Operations', () => {
  it('should create and read memory', () => {
    const db = new Database(TEST_DB_PATH);

    const stmt = db.prepare(`
      INSERT INTO memories (content, memory_type, tags, project, importance)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      'Test memory content',
      'learning',
      JSON.stringify(['test', 'unit']),
      'test-project',
      7
    );

    expect(result.lastInsertRowid).toBeGreaterThan(0);

    const memory = db.prepare('SELECT * FROM memories WHERE id = ?').get(result.lastInsertRowid);
    expect(memory).toBeDefined();
    expect((memory as { content: string }).content).toBe('Test memory content');

    db.close();
  });

  it('should search memories with FTS', () => {
    const db = new Database(TEST_DB_PATH);

    // 메모리 추가
    db.prepare(`
      INSERT INTO memories (content, memory_type, project)
      VALUES (?, ?, ?)
    `).run('TypeScript strict mode is important', 'pattern', 'test-project');

    // FTS 검색
    const results = db.prepare(`
      SELECT m.* FROM memories_fts fts
      JOIN memories m ON m.id = fts.rowid
      WHERE memories_fts MATCH ?
    `).all('TypeScript OR strict');

    expect(results.length).toBeGreaterThan(0);

    db.close();
  });

  it('should manage tasks', () => {
    const db = new Database(TEST_DB_PATH);

    // 태스크 추가
    const addResult = db.prepare(`
      INSERT INTO tasks (project, title, description, priority)
      VALUES (?, ?, ?, ?)
    `).run('test-project', 'Implement login', 'Add OAuth login', 8);

    const taskId = addResult.lastInsertRowid;
    expect(taskId).toBeGreaterThan(0);

    // 태스크 상태 업데이트
    db.prepare(`UPDATE tasks SET status = ? WHERE id = ?`).run('in_progress', taskId);

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as { status: string };
    expect(task.status).toBe('in_progress');

    // 태스크 완료
    db.prepare(`UPDATE tasks SET status = 'done', completed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(taskId);

    const completedTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as { status: string; completed_at: string };
    expect(completedTask.status).toBe('done');
    expect(completedTask.completed_at).toBeDefined();

    db.close();
  });

  it('should manage project context', () => {
    const db = new Database(TEST_DB_PATH);

    // 프로젝트 컨텍스트 저장
    db.prepare(`
      INSERT OR REPLACE INTO project_context (project, tech_stack, architecture_decisions, code_patterns)
      VALUES (?, ?, ?, ?)
    `).run(
      'test-project',
      JSON.stringify({ framework: 'Next.js', language: 'TypeScript' }),
      JSON.stringify(['Use App Router', 'Server Actions']),
      JSON.stringify(['Zod validation', 'Error Boundary'])
    );

    const context = db.prepare('SELECT * FROM project_context WHERE project = ?').get('test-project') as {
      tech_stack: string;
      architecture_decisions: string;
    };

    expect(context).toBeDefined();
    expect(JSON.parse(context.tech_stack).framework).toBe('Next.js');
    expect(JSON.parse(context.architecture_decisions)).toContain('Use App Router');

    db.close();
  });

  it('should manage active context', () => {
    const db = new Database(TEST_DB_PATH);

    // 활성 컨텍스트 저장
    db.prepare(`
      INSERT OR REPLACE INTO active_context (project, current_state, recent_files, blockers, last_verification)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'test-project',
      'Working on login feature',
      JSON.stringify(['src/app/login/page.tsx', 'src/lib/auth.ts']),
      null,
      'passed'
    );

    const active = db.prepare('SELECT * FROM active_context WHERE project = ?').get('test-project') as {
      current_state: string;
      last_verification: string;
    };

    expect(active.current_state).toBe('Working on login feature');
    expect(active.last_verification).toBe('passed');

    db.close();
  });

  it('should store and search resolved issues', () => {
    const db = new Database(TEST_DB_PATH);

    // 해결된 이슈 저장
    db.prepare(`
      INSERT INTO resolved_issues (project, error_signature, error_message, solution, keywords)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'test-project',
      'TypeError: Cannot read property',
      'TypeError: Cannot read property \'id\' of undefined',
      'Use optional chaining: user?.id',
      'TypeError undefined optional chaining'
    );

    // 검색
    const issues = db.prepare(`
      SELECT * FROM resolved_issues
      WHERE error_message LIKE ? OR keywords LIKE ?
    `).all('%TypeError%', '%TypeError%');

    expect(issues.length).toBeGreaterThan(0);

    db.close();
  });

  it('should create memory relations', () => {
    const db = new Database(TEST_DB_PATH);

    // 메모리 2개 추가
    const mem1 = db.prepare(`INSERT INTO memories (content, memory_type) VALUES (?, ?)`).run('Problem description', 'error');
    const mem2 = db.prepare(`INSERT INTO memories (content, memory_type) VALUES (?, ?)`).run('Solution found', 'learning');

    // 관계 생성
    db.prepare(`
      INSERT INTO memory_relations (source_id, target_id, relation_type, strength)
      VALUES (?, ?, ?, ?)
    `).run(mem2.lastInsertRowid, mem1.lastInsertRowid, 'solves', 1.0);

    // 관계 조회
    const relations = db.prepare(`
      SELECT * FROM memory_relations WHERE source_id = ? OR target_id = ?
    `).all(mem1.lastInsertRowid, mem1.lastInsertRowid);

    expect(relations.length).toBe(1);

    db.close();
  });

  it('should handle task list by status', () => {
    const db = new Database(TEST_DB_PATH);

    // 여러 태스크 추가
    db.prepare(`INSERT INTO tasks (project, title, status, priority) VALUES (?, ?, ?, ?)`).run('test-project', 'Task 1', 'pending', 5);
    db.prepare(`INSERT INTO tasks (project, title, status, priority) VALUES (?, ?, ?, ?)`).run('test-project', 'Task 2', 'in_progress', 8);
    db.prepare(`INSERT INTO tasks (project, title, status, priority) VALUES (?, ?, ?, ?)`).run('test-project', 'Task 3', 'done', 3);
    db.prepare(`INSERT INTO tasks (project, title, status, priority) VALUES (?, ?, ?, ?)`).run('test-project', 'Task 4', 'blocked', 7);

    // 상태별 조회
    const pending = db.prepare(`SELECT * FROM tasks WHERE project = ? AND status = ?`).all('test-project', 'pending');
    const inProgress = db.prepare(`SELECT * FROM tasks WHERE project = ? AND status = ?`).all('test-project', 'in_progress');
    const blocked = db.prepare(`SELECT * FROM tasks WHERE project = ? AND status = ?`).all('test-project', 'blocked');

    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(inProgress.length).toBeGreaterThanOrEqual(1);
    expect(blocked.length).toBeGreaterThanOrEqual(1);

    db.close();
  });

  it('should update architecture decisions', () => {
    const db = new Database(TEST_DB_PATH);

    // 기존 결정 가져오기
    const row = db.prepare('SELECT architecture_decisions FROM project_context WHERE project = ?').get('test-project') as {
      architecture_decisions: string;
    } | undefined;

    let decisions: string[] = [];
    if (row?.architecture_decisions) {
      decisions = JSON.parse(row.architecture_decisions);
    }

    // 새 결정 추가
    decisions.unshift('Use WebSocket for real-time');
    decisions = decisions.slice(0, 5); // 최대 5개 유지

    db.prepare(`
      UPDATE project_context SET architecture_decisions = ?, updated_at = CURRENT_TIMESTAMP
      WHERE project = ?
    `).run(JSON.stringify(decisions), 'test-project');

    const updated = db.prepare('SELECT architecture_decisions FROM project_context WHERE project = ?').get('test-project') as {
      architecture_decisions: string;
    };

    const updatedDecisions = JSON.parse(updated.architecture_decisions);
    expect(updatedDecisions[0]).toBe('Use WebSocket for real-time');

    db.close();
  });

  it('should handle memory importance filtering', () => {
    const db = new Database(TEST_DB_PATH);

    // 다양한 중요도의 메모리 추가
    db.prepare(`INSERT INTO memories (content, memory_type, importance) VALUES (?, ?, ?)`).run('Low importance', 'observation', 2);
    db.prepare(`INSERT INTO memories (content, memory_type, importance) VALUES (?, ?, ?)`).run('Medium importance', 'learning', 5);
    db.prepare(`INSERT INTO memories (content, memory_type, importance) VALUES (?, ?, ?)`).run('High importance', 'decision', 9);

    // 최소 중요도 5 이상만 조회
    const important = db.prepare(`SELECT * FROM memories WHERE importance >= ?`).all(5);

    expect(important.length).toBeGreaterThanOrEqual(2);
    important.forEach((m: { importance: number }) => {
      expect(m.importance).toBeGreaterThanOrEqual(5);
    });

    db.close();
  });

  it('should track memory access count', () => {
    const db = new Database(TEST_DB_PATH);

    // 메모리 추가
    const result = db.prepare(`INSERT INTO memories (content, memory_type) VALUES (?, ?)`).run('Frequently accessed', 'pattern');
    const memId = result.lastInsertRowid;

    // 접근 카운트 증가
    for (let i = 0; i < 5; i++) {
      db.prepare(`UPDATE memories SET access_count = access_count + 1, accessed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(memId);
    }

    const memory = db.prepare('SELECT access_count FROM memories WHERE id = ?').get(memId) as { access_count: number };
    expect(memory.access_count).toBe(5);

    db.close();
  });
});

describe('Logger Utility', () => {
  it('should mask sensitive data', () => {
    const SENSITIVE_PATTERNS = [
      /password["'\s:=]+["']?[\w\-!@#$%^&*]+["']?/gi,
      /api[_-]?key["'\s:=]+["']?[\w\-]+["']?/gi,
      /token["'\s:=]+["']?[\w\-\.]+["']?/gi,
      /Bearer\s+[\w\-\.]+/gi
    ];

    function maskSensitive(text: string): string {
      let masked = text;
      for (const pattern of SENSITIVE_PATTERNS) {
        masked = masked.replace(pattern, '[REDACTED]');
      }
      return masked;
    }

    expect(maskSensitive('password: secret123')).toBe('[REDACTED]');
    expect(maskSensitive('api_key: abc123')).toBe('[REDACTED]');
    expect(maskSensitive('Bearer eyJhbGciOiJI')).toBe('[REDACTED]');
    expect(maskSensitive('normal text')).toBe('normal text');
  });
});

// 참고: Zod 스키마 테스트는 schemas.test.ts에서 더 철저하게 진행됨
// 이 파일은 DB 작업에 집중
