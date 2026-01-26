// 에러 솔루션 아카이브 및 시스템 평가 도구 (3개)
import { db } from '../db/database.js';
import type { Tool, CallToolResult } from '../types.js';

// ===== 도구 정의 =====

export const solutionTools: Tool[] = [
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

// ===== 핸들러 =====

export function recordSolution(
  errorSignature: string,
  solution: string,
  project?: string,
  errorMessage?: string,
  relatedFiles?: string[]
): CallToolResult {
  try {
    // 키워드 자동 추출
    const keywords = errorSignature
      .split(/\s+/)
      .filter(w => w.length > 3)
      .join(',');

    const stmt = db.prepare(`
      INSERT INTO resolved_issues (project, error_signature, error_message, solution, related_files, keywords)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      project || null,
      errorSignature,
      errorMessage || null,
      solution,
      relatedFiles ? JSON.stringify(relatedFiles) : null,
      keywords
    );

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          id: result.lastInsertRowid,
          errorSignature: errorSignature.substring(0, 50)
        })
      }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${error}` }],
      isError: true
    };
  }
}

export function findSolution(errorText: string, project?: string): CallToolResult {
  try {
    // 키워드 추출
    const keywords = errorText.split(/\s+/).filter(w => w.length > 3);

    let sql = `
      SELECT id, project, error_signature, error_message, solution, related_files, created_at
      FROM resolved_issues
      WHERE (
        error_signature LIKE ?
        OR error_message LIKE ?
        OR keywords LIKE ?
      )
    `;
    const params: unknown[] = [
      `%${keywords[0] || errorText}%`,
      `%${keywords[0] || errorText}%`,
      `%${keywords[0] || errorText}%`
    ];

    if (project) {
      sql += ` AND (project = ? OR project IS NULL)`;
      params.push(project);
    }

    sql += ` ORDER BY created_at DESC LIMIT 10`;

    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      id: number;
      project: string | null;
      error_signature: string;
      error_message: string | null;
      solution: string;
      related_files: string | null;
      created_at: string;
    }>;

    const solutions = rows.map(row => ({
      id: row.id,
      project: row.project,
      errorSignature: row.error_signature,
      solution: row.solution,
      relatedFiles: row.related_files ? JSON.parse(row.related_files) : [],
      createdAt: row.created_at
    }));

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          query: errorText.substring(0, 100),
          found: solutions.length,
          solutions
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

export function getContinuityStats(project?: string): CallToolResult {
  try {
    const stats: Record<string, unknown> = {};

    // 프로젝트 컨텍스트 통계
    if (project) {
      const projectContextStmt = db.prepare('SELECT * FROM project_context WHERE project = ?');
      const projectContext = projectContextStmt.get(project);
      stats.hasProjectContext = !!projectContext;

      const activeContextStmt = db.prepare('SELECT * FROM active_context WHERE project = ?');
      const activeContext = activeContextStmt.get(project);
      stats.hasActiveContext = !!activeContext;

      const taskCountStmt = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE project = ?');
      const taskCount = taskCountStmt.get(project) as { count: number };
      stats.totalTasks = taskCount.count;

      const issueCountStmt = db.prepare('SELECT COUNT(*) as count FROM resolved_issues WHERE project = ?');
      const issueCount = issueCountStmt.get(project) as { count: number };
      stats.resolvedIssues = issueCount.count;
    } else {
      // 전체 통계
      const projectContextCountStmt = db.prepare('SELECT COUNT(*) as count FROM project_context');
      stats.projectsWithContext = (projectContextCountStmt.get() as { count: number }).count;

      const activeContextCountStmt = db.prepare('SELECT COUNT(*) as count FROM active_context');
      stats.projectsWithActiveContext = (activeContextCountStmt.get() as { count: number }).count;

      const totalTasksStmt = db.prepare('SELECT COUNT(*) as count FROM tasks');
      stats.totalTasks = (totalTasksStmt.get() as { count: number }).count;

      const totalIssuesStmt = db.prepare('SELECT COUNT(*) as count FROM resolved_issues');
      stats.totalResolvedIssues = (totalIssuesStmt.get() as { count: number }).count;

      const totalMemoriesStmt = db.prepare('SELECT COUNT(*) as count FROM memories');
      stats.totalMemories = (totalMemoriesStmt.get() as { count: number }).count;

      const totalEmbeddingsStmt = db.prepare('SELECT COUNT(*) as count FROM embeddings');
      stats.totalEmbeddings = (totalEmbeddingsStmt.get() as { count: number }).count;
    }

    // 최근 활동
    const recentSessionsStmt = db.prepare(`
      SELECT project, last_work, timestamp
      FROM sessions
      ORDER BY timestamp DESC
      LIMIT 5
    `);
    stats.recentActivity = recentSessionsStmt.all();

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          scope: project || 'all',
          stats
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
