// 세션 관리 도구 (4개)
import { db } from '../db/database.js';
import type { Tool, CallToolResult } from '../types.js';

// ===== 도구 정의 =====

export const sessionTools: Tool[] = [
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
  }
];

// ===== 핸들러 =====

export function saveSessionHistory(
  project: string,
  lastWork: string,
  currentStatus?: string,
  nextTasks?: string[],
  modifiedFiles?: string[],
  issues?: string[],
  verificationResult?: string,
  durationMinutes?: number
): CallToolResult {
  try {
    const stmt = db.prepare(`
      INSERT INTO sessions (project, last_work, current_status, next_tasks, modified_files, issues, verification_result, duration_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      project,
      lastWork,
      currentStatus || null,
      nextTasks ? JSON.stringify(nextTasks) : null,
      modifiedFiles ? JSON.stringify(modifiedFiles) : null,
      issues ? JSON.stringify(issues) : null,
      verificationResult || null,
      durationMinutes || null
    );

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: true, id: result.lastInsertRowid })
      }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${error}` }],
      isError: true
    };
  }
}

export function getSessionHistory(
  project?: string,
  limit: number = 10,
  keyword?: string
): CallToolResult {
  try {
    let query = 'SELECT * FROM sessions WHERE 1=1';
    const params: (string | number)[] = [];

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
    const rows = stmt.all(...params) as Array<{
      id: number;
      project: string;
      timestamp: string;
      last_work: string;
      current_status: string | null;
      next_tasks: string | null;
      modified_files: string | null;
      issues: string | null;
      verification_result: string | null;
      duration_minutes: number | null;
    }>;

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
        type: 'text' as const,
        text: JSON.stringify({ sessions, count: sessions.length }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${error}` }],
      isError: true
    };
  }
}

export function searchSimilarWork(keyword: string, project?: string): CallToolResult {
  try {
    let query = `
      SELECT project, last_work, current_status, modified_files, verification_result, timestamp
      FROM sessions
      WHERE last_work LIKE ?
    `;
    const params: string[] = [`%${keyword}%`];

    if (project) {
      query += ' AND project = ?';
      params.push(project);
    }

    query += ' ORDER BY timestamp DESC LIMIT 20';

    const stmt = db.prepare(query);
    const rows = stmt.all(...params) as Array<{
      project: string;
      last_work: string;
      current_status: string | null;
      modified_files: string | null;
      verification_result: string | null;
      timestamp: string;
    }>;

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
        type: 'text' as const,
        text: JSON.stringify({
          keyword,
          found: results.length,
          results
        }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${error}` }],
      isError: true
    };
  }
}

export function recordWorkPattern(
  project: string,
  workType: string,
  description: string,
  filesPattern?: string,
  success?: boolean,
  durationMinutes?: number
): CallToolResult {
  try {
    // 기존 패턴이 있는지 확인
    const existingStmt = db.prepare(`
      SELECT id, count, success_rate, avg_duration_minutes
      FROM work_patterns
      WHERE project = ? AND work_type = ? AND description = ?
    `);

    const existing = existingStmt.get(project, workType, description) as {
      id: number;
      count: number;
      success_rate: number;
      avg_duration_minutes: number;
    } | undefined;

    if (existing) {
      // 기존 패턴 업데이트
      const newCount = existing.count + 1;
      const newSuccessRate = success !== undefined
        ? (existing.success_rate * existing.count + (success ? 1 : 0)) / newCount
        : existing.success_rate;
      const newAvgDuration = durationMinutes !== undefined
        ? (existing.avg_duration_minutes * existing.count + durationMinutes) / newCount
        : existing.avg_duration_minutes;

      const updateStmt = db.prepare(`
        UPDATE work_patterns
        SET count = ?, success_rate = ?, avg_duration_minutes = ?, last_used = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      updateStmt.run(newCount, newSuccessRate, newAvgDuration, existing.id);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: true, updated: true, id: existing.id, count: newCount })
        }]
      };
    } else {
      // 새 패턴 생성
      const insertStmt = db.prepare(`
        INSERT INTO work_patterns (project, work_type, description, files_pattern, success_rate, avg_duration_minutes)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const result = insertStmt.run(
        project,
        workType,
        description,
        filesPattern || null,
        success !== undefined ? (success ? 1 : 0) : 0,
        durationMinutes || 0
      );

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: true, created: true, id: result.lastInsertRowid })
        }]
      };
    }
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${error}` }],
      isError: true
    };
  }
}

export function getWorkPatterns(project?: string, workType?: string): CallToolResult {
  try {
    let query = 'SELECT * FROM work_patterns WHERE 1=1';
    const params: string[] = [];

    if (project) {
      query += ' AND project = ?';
      params.push(project);
    }

    if (workType) {
      query += ' AND work_type = ?';
      params.push(workType);
    }

    query += ' ORDER BY count DESC, last_used DESC LIMIT 50';

    const stmt = db.prepare(query);
    const rows = stmt.all(...params) as Array<{
      id: number;
      project: string;
      work_type: string;
      description: string;
      files_pattern: string | null;
      success_rate: number;
      avg_duration_minutes: number;
      count: number;
      last_used: string;
    }>;

    const patterns = rows.map(row => ({
      id: row.id,
      project: row.project,
      workType: row.work_type,
      description: row.description,
      filesPattern: row.files_pattern,
      successRate: Math.round(row.success_rate * 100),
      avgDurationMinutes: Math.round(row.avg_duration_minutes),
      count: row.count,
      lastUsed: row.last_used
    }));

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ patterns, count: patterns.length }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${error}` }],
      isError: true
    };
  }
}
