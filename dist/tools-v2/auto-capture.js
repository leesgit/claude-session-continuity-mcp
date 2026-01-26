// 자동 컨텍스트 캡처 도구
// session_start, session_end 도구로 세션 라이프사이클 관리
import { db } from '../db/database.js';
import { logger } from '../utils/logger.js';
import { loadContext, saveContext, createContextSnapshot, getCompactContext } from '../utils/auto-context.js';
import { invalidateProjects } from '../utils/cache.js';
import { z } from 'zod';
// ===== 스키마 =====
const SessionStartSchema = z.object({
    project: z.string().min(1, 'project is required'),
    compact: z.boolean().optional().default(false)
});
const SessionEndSchema = z.object({
    project: z.string().min(1, 'project is required'),
    currentState: z.string().min(1, 'currentState is required'),
    recentFiles: z.array(z.string()).optional(),
    blockers: z.string().optional(),
    verification: z.enum(['passed', 'failed']).optional(),
    architectureDecision: z.string().optional(),
    codePattern: z.string().optional(),
    techStack: z.record(z.string()).optional()
});
const SessionSummarySchema = z.object({
    project: z.string().min(1, 'project is required')
});
// ===== 도구 정의 =====
export const autoCaptureTools = [
    {
        name: 'session_start',
        description: `세션 시작 시 자동 컨텍스트 로드. 새 세션의 첫 도구 호출.
- 프로젝트 컨텍스트 자동 복원 (< 5ms 목표)
- compact=true: 토큰 효율적 요약 (~650토큰)
- compact=false: 전체 JSON 컨텍스트
세션 시작 시 반드시 호출하여 연속성 확보.`,
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트명' },
                compact: { type: 'boolean', description: '간결한 요약 모드 (기본: false)', default: false }
            },
            required: ['project']
        }
    },
    {
        name: 'session_end',
        description: `세션 종료 시 자동 컨텍스트 저장. 작업 완료 후 호출.
- currentState: 현재 상태 1줄 요약 (필수)
- recentFiles: 수정한 파일 목록 (최대 10개)
- blockers: 발견한 블로커/이슈
- verification: 마지막 검증 결과
- architectureDecision: 새로운 아키텍처 결정
- codePattern: 새로운 코드 패턴
- techStack: 기술 스택 업데이트
다음 세션에서 이 컨텍스트가 자동 복원됨.`,
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트명' },
                currentState: { type: 'string', description: '현재 상태 (1줄 요약)' },
                recentFiles: { type: 'array', items: { type: 'string' }, description: '수정한 파일 목록' },
                blockers: { type: 'string', description: '블로커/이슈' },
                verification: { type: 'string', enum: ['passed', 'failed'], description: '검증 결과' },
                architectureDecision: { type: 'string', description: '새 아키텍처 결정' },
                codePattern: { type: 'string', description: '새 코드 패턴' },
                techStack: { type: 'object', additionalProperties: { type: 'string' }, description: '기술 스택 업데이트' }
            },
            required: ['project', 'currentState']
        }
    },
    {
        name: 'session_summary',
        description: `현재 프로젝트의 컨텍스트 요약 조회.
- 토큰 추정치 포함
- 전체 컨텍스트 스냅샷 반환
세션 중간에 컨텍스트 확인 시 사용.`,
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트명' }
            },
            required: ['project']
        }
    }
];
// ===== 핸들러 =====
export async function handleSessionStart(args) {
    return logger.withTool('session_start', async () => {
        const parsed = SessionStartSchema.safeParse(args);
        if (!parsed.success) {
            return {
                content: [{ type: 'text', text: `Validation error: ${parsed.error.message}` }],
                isError: true
            };
        }
        const { project, compact } = parsed.data;
        const startTime = performance.now();
        try {
            // 세션 시작 기록
            recordSessionStart(project);
            if (compact) {
                // 간결한 요약 반환
                const summary = await getCompactContext(project);
                const elapsed = performance.now() - startTime;
                return {
                    content: [{
                            type: 'text',
                            text: `${summary}\n\n---\n_Loaded in ${elapsed.toFixed(2)}ms_`
                        }]
                };
            }
            // 전체 컨텍스트 반환
            const context = await loadContext(project);
            const elapsed = performance.now() - startTime;
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            ...context,
                            _meta: {
                                loadTimeMs: parseFloat(elapsed.toFixed(2)),
                                timestamp: new Date().toISOString()
                            }
                        }, null, 2)
                    }]
            };
        }
        catch (error) {
            logger.error('Session start failed', { project, error: String(error) });
            return {
                content: [{ type: 'text', text: `Session start failed: ${error}` }],
                isError: true
            };
        }
    }, args);
}
export async function handleSessionEnd(args) {
    return logger.withTool('session_end', async () => {
        const parsed = SessionEndSchema.safeParse(args);
        if (!parsed.success) {
            return {
                content: [{ type: 'text', text: `Validation error: ${parsed.error.message}` }],
                isError: true
            };
        }
        const { project, currentState, recentFiles, blockers, verification, architectureDecision, codePattern, techStack } = parsed.data;
        try {
            // 컨텍스트 저장
            await saveContext(project, {
                currentState,
                recentFiles,
                blockers,
                verification,
                architectureDecision,
                codePattern,
                techStack
            });
            // 세션 종료 기록
            recordSessionEnd(project, currentState, verification);
            // 스냅샷 생성 (토큰 추정 포함)
            const snapshot = await createContextSnapshot(project);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            project,
                            saved: {
                                currentState,
                                recentFilesCount: recentFiles?.length || 0,
                                hasBlockers: !!blockers,
                                verification: verification || null,
                                newDecision: !!architectureDecision,
                                newPattern: !!codePattern,
                                techStackUpdated: !!techStack
                            },
                            tokenEstimate: snapshot.tokenEstimate,
                            timestamp: snapshot.timestamp
                        }, null, 2)
                    }]
            };
        }
        catch (error) {
            logger.error('Session end failed', { project, error: String(error) });
            return {
                content: [{ type: 'text', text: `Session end failed: ${error}` }],
                isError: true
            };
        }
    }, args);
}
export async function handleSessionSummary(args) {
    return logger.withTool('session_summary', async () => {
        const parsed = SessionSummarySchema.safeParse(args);
        if (!parsed.success) {
            return {
                content: [{ type: 'text', text: `Validation error: ${parsed.error.message}` }],
                isError: true
            };
        }
        const { project } = parsed.data;
        try {
            const snapshot = await createContextSnapshot(project);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(snapshot, null, 2)
                    }]
            };
        }
        catch (error) {
            logger.error('Session summary failed', { project, error: String(error) });
            return {
                content: [{ type: 'text', text: `Session summary failed: ${error}` }],
                isError: true
            };
        }
    }, args);
}
// ===== 세션 기록 헬퍼 =====
function recordSessionStart(project) {
    try {
        const stmt = db.prepare(`
      INSERT INTO sessions (project, last_work, current_status)
      VALUES (?, 'Session started', 'in_progress')
    `);
        stmt.run(project);
        invalidateProjects();
    }
    catch (error) {
        logger.warn('Failed to record session start', { project, error: String(error) });
    }
}
function recordSessionEnd(project, lastWork, verification) {
    try {
        // 마지막 in_progress 세션 업데이트
        const stmt = db.prepare(`
      UPDATE sessions
      SET last_work = ?,
          current_status = 'completed',
          verification_result = ?,
          timestamp = CURRENT_TIMESTAMP
      WHERE project = ? AND current_status = 'in_progress'
      ORDER BY id DESC
      LIMIT 1
    `);
        stmt.run(lastWork, verification || null, project);
        invalidateProjects();
    }
    catch (error) {
        logger.warn('Failed to record session end', { project, error: String(error) });
    }
}
