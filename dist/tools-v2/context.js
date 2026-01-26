// 컨텍스트 도구 (context_get, context_update)
// 프로젝트 연속성의 핵심 - 세션 간 컨텍스트 유지
import * as path from 'path';
import { db, APPS_DIR } from '../db/database.js';
import { readFileContent, parseMarkdownTable } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';
import { ContextGetSchema, ContextUpdateSchema } from '../schemas.js';
// ===== 도구 정의 =====
export const contextTools = [
    {
        name: 'context_get',
        description: `프로젝트 컨텍스트 조회. 새 세션 시작 시 필수 호출.
- 고정 컨텍스트: 기술 스택, 아키텍처 결정, 코드 패턴
- 활성 컨텍스트: 현재 상태, 최근 파일, 블로커
- 미완료 태스크 (최대 3개)
~650토큰으로 압축된 프로젝트 정보 반환.`,
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트명' }
            },
            required: ['project']
        }
    },
    {
        name: 'context_update',
        description: `프로젝트 컨텍스트 업데이트. 작업 종료 시 호출.
- currentState: 현재 상태 1줄 요약 (필수)
- recentFiles: 최근 수정 파일 (최대 10개)
- blockers: 블로커/이슈 (없으면 생략)
- verification: 마지막 검증 결과 (passed/failed)
- architectureDecision: 새로운 아키텍처 결정`,
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트명' },
                currentState: { type: 'string', description: '현재 상태 (1줄 요약)' },
                recentFiles: { type: 'array', items: { type: 'string' }, description: '최근 수정 파일' },
                blockers: { type: 'string', description: '블로커/이슈' },
                verification: { type: 'string', enum: ['passed', 'failed'], description: '검증 결과' },
                architectureDecision: { type: 'string', description: '추가할 아키텍처 결정' }
            },
            required: ['project', 'currentState']
        }
    }
];
// ===== 핸들러 =====
export async function handleContextGet(args) {
    return logger.withTool('context_get', async () => {
        // 입력 검증
        const parsed = ContextGetSchema.safeParse(args);
        if (!parsed.success) {
            return {
                content: [{ type: 'text', text: `Validation error: ${parsed.error.message}` }],
                isError: true
            };
        }
        const { project } = parsed.data;
        // Layer 1: 고정 컨텍스트
        const projectContextStmt = db.prepare('SELECT * FROM project_context WHERE project = ?');
        const projectContext = projectContextStmt.get(project);
        // Layer 2: 활성 컨텍스트
        const activeContextStmt = db.prepare('SELECT * FROM active_context WHERE project = ?');
        const activeContext = activeContextStmt.get(project);
        // Layer 3: 미완료 태스크 (최대 3개)
        const tasksStmt = db.prepare(`
      SELECT id, title, status, priority
      FROM tasks
      WHERE project = ? AND status IN ('pending', 'in_progress')
      ORDER BY priority DESC, created_at DESC
      LIMIT 3
    `);
        const tasks = tasksStmt.all(project);
        // 고정 컨텍스트가 없으면 plan.md에서 자동 추출
        let techStack = {};
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
            pendingTasks: tasks.map(t => ({
                id: t.id,
                title: t.title,
                status: t.status,
                priority: t.priority
            }))
        };
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify(result, null, 2)
                }]
        };
    }, args);
}
export async function handleContextUpdate(args) {
    return logger.withTool('context_update', async () => {
        // 입력 검증
        const parsed = ContextUpdateSchema.safeParse(args);
        if (!parsed.success) {
            return {
                content: [{ type: 'text', text: `Validation error: ${parsed.error.message}` }],
                isError: true
            };
        }
        const { project, currentState, recentFiles, blockers, verification, architectureDecision } = parsed.data;
        // 활성 컨텍스트 업데이트
        const stmt = db.prepare(`
      INSERT OR REPLACE INTO active_context (project, current_state, recent_files, blockers, last_verification, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
        stmt.run(project, currentState, recentFiles ? JSON.stringify(recentFiles.slice(0, 10)) : null, blockers || null, verification || null);
        // 아키텍처 결정 추가 (있으면)
        if (architectureDecision) {
            const getStmt = db.prepare('SELECT architecture_decisions FROM project_context WHERE project = ?');
            const row = getStmt.get(project);
            let decisions = [];
            if (row?.architecture_decisions) {
                try {
                    decisions = JSON.parse(row.architecture_decisions);
                }
                catch { /* ignore */ }
            }
            decisions.unshift(architectureDecision);
            decisions = decisions.slice(0, 5);
            const updateStmt = db.prepare(`
        INSERT INTO project_context (project, architecture_decisions, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(project) DO UPDATE SET
          architecture_decisions = ?,
          updated_at = CURRENT_TIMESTAMP
      `);
            const decisionsJson = JSON.stringify(decisions);
            updateStmt.run(project, decisionsJson, decisionsJson);
        }
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        project,
                        updated: {
                            currentState,
                            recentFiles: recentFiles?.length || 0,
                            hasBlockers: !!blockers,
                            verification: verification || null,
                            architectureDecision: architectureDecision || null
                        }
                    })
                }]
        };
    }, args);
}
