// 프로젝트 연속성 시스템 v2 도구 (4개)
import * as path from 'path';
import { db, APPS_DIR } from '../db/database.js';
import { readFileContent, parseMarkdownTable } from '../utils/helpers.js';
import type { Tool, CallToolResult } from '../types.js';

// ===== 도구 정의 =====

export const contextTools: Tool[] = [
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
  }
];

// ===== 핸들러 =====

export async function getProjectContext(project: string): Promise<CallToolResult> {
  try {
    // Layer 1: 고정 컨텍스트
    const projectContextStmt = db.prepare('SELECT * FROM project_context WHERE project = ?');
    const projectContext = projectContextStmt.get(project) as {
      project: string;
      tech_stack: string | null;
      architecture_decisions: string | null;
      code_patterns: string | null;
      special_notes: string | null;
    } | undefined;

    // Layer 2: 활성 컨텍스트
    const activeContextStmt = db.prepare('SELECT * FROM active_context WHERE project = ?');
    const activeContext = activeContextStmt.get(project) as {
      project: string;
      current_state: string | null;
      active_tasks: string | null;
      recent_files: string | null;
      blockers: string | null;
      last_verification: string | null;
      updated_at: string;
    } | undefined;

    // Layer 3: 미완료 태스크 (최대 3개)
    const tasksStmt = db.prepare(`
      SELECT id, title, status, priority
      FROM tasks
      WHERE project = ? AND status IN ('pending', 'in_progress')
      ORDER BY priority DESC, created_at DESC
      LIMIT 3
    `);
    const tasks = tasksStmt.all(project) as Array<{
      id: number;
      title: string;
      status: string;
      priority: number;
    }>;

    // 고정 컨텍스트가 없으면 plan.md에서 자동 추출 시도
    let techStack: Record<string, string> = {};
    if (!projectContext) {
      const planPath = path.join(APPS_DIR, project, 'plan.md');
      const planContent = await readFileContent(planPath);
      if (planContent) {
        techStack = parseMarkdownTable(planContent, '기술 스택');
      }
    }

    const result = {
      project,
      fixed: {
        techStack: projectContext?.tech_stack ? JSON.parse(projectContext.tech_stack) : techStack,
        architectureDecisions: projectContext?.architecture_decisions ? JSON.parse(projectContext.architecture_decisions) : [],
        codePatterns: projectContext?.code_patterns ? JSON.parse(projectContext.code_patterns) : [],
        specialNotes: projectContext?.special_notes || null
      },
      active: {
        currentState: activeContext?.current_state || 'No active context',
        recentFiles: activeContext?.recent_files ? JSON.parse(activeContext.recent_files) : [],
        blockers: activeContext?.blockers || null,
        lastVerification: activeContext?.last_verification || null,
        updatedAt: activeContext?.updated_at || null
      },
      tasks: tasks.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority
      }))
    };

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${error}` }],
      isError: true
    };
  }
}

export function updateActiveContext(
  project: string,
  currentState: string,
  recentFiles?: string[],
  blockers?: string,
  lastVerification?: string
): CallToolResult {
  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO active_context (project, current_state, recent_files, blockers, last_verification, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    stmt.run(
      project,
      currentState,
      recentFiles ? JSON.stringify(recentFiles.slice(0, 10)) : null,
      blockers || null,
      lastVerification || null
    );

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: true, project, currentState })
      }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${error}` }],
      isError: true
    };
  }
}

export async function initProjectContext(
  project: string,
  techStack?: Record<string, unknown>,
  architectureDecisions?: string[],
  codePatterns?: string[],
  specialNotes?: string
): Promise<CallToolResult> {
  try {
    // techStack이 없으면 plan.md에서 자동 추출
    let finalTechStack = techStack;
    if (!finalTechStack) {
      const planPath = path.join(APPS_DIR, project, 'plan.md');
      const planContent = await readFileContent(planPath);
      if (planContent) {
        finalTechStack = parseMarkdownTable(planContent, '기술 스택');
      }
    }

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO project_context (project, tech_stack, architecture_decisions, code_patterns, special_notes, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    stmt.run(
      project,
      finalTechStack ? JSON.stringify(finalTechStack) : null,
      architectureDecisions ? JSON.stringify(architectureDecisions.slice(0, 5)) : null,
      codePatterns ? JSON.stringify(codePatterns.slice(0, 5)) : null,
      specialNotes || null
    );

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          project,
          initialized: {
            techStack: !!finalTechStack,
            architectureDecisions: architectureDecisions?.length || 0,
            codePatterns: codePatterns?.length || 0,
            specialNotes: !!specialNotes
          }
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

export function updateArchitectureDecision(project: string, decision: string): CallToolResult {
  try {
    // 현재 결정 목록 가져오기
    const getStmt = db.prepare('SELECT architecture_decisions FROM project_context WHERE project = ?');
    const row = getStmt.get(project) as { architecture_decisions: string | null } | undefined;

    let decisions: string[] = [];
    if (row?.architecture_decisions) {
      try {
        decisions = JSON.parse(row.architecture_decisions);
      } catch {}
    }

    // 새 결정 추가 (최대 5개 유지)
    decisions.unshift(decision);
    decisions = decisions.slice(0, 5);

    // 업데이트 또는 새로 생성
    const stmt = db.prepare(`
      INSERT INTO project_context (project, architecture_decisions, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(project) DO UPDATE SET
        architecture_decisions = ?,
        updated_at = CURRENT_TIMESTAMP
    `);

    const decisionsJson = JSON.stringify(decisions);
    stmt.run(project, decisionsJson, decisionsJson);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          project,
          totalDecisions: decisions.length,
          latestDecision: decision
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
