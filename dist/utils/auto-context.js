// 자동 컨텍스트 캡처 시스템
// 세션 시작 시 자동 로드, 세션 종료 시 자동 저장
import { db } from '../db/database.js';
import { logger } from './logger.js';
import { contextCache, makeContextKey, invalidateContext } from './cache.js';
// ===== 토큰 추정 =====
/**
 * 문자열의 토큰 수 추정 (평균 4자 = 1토큰)
 */
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
/**
 * 컨텍스트의 총 토큰 수 추정
 */
export function estimateContextTokens(context) {
    const json = JSON.stringify(context);
    return estimateTokens(json);
}
// ===== 자동 컨텍스트 로드 =====
/**
 * 프로젝트 컨텍스트 자동 로드 (캐시 우선)
 * 목표: < 5ms (캐시 히트 시)
 */
export async function loadContext(project) {
    const startTime = performance.now();
    const cacheKey = makeContextKey(project);
    // 캐시 확인
    const cached = contextCache.get(cacheKey);
    if (cached) {
        const elapsed = performance.now() - startTime;
        logger.debug('Context loaded from cache', { project, elapsed: `${elapsed.toFixed(2)}ms` });
        return cached;
    }
    // DB에서 로드
    const context = await loadContextFromDB(project);
    // 캐시에 저장
    contextCache.set(cacheKey, context);
    const elapsed = performance.now() - startTime;
    logger.info('Context loaded from DB', { project, elapsed: `${elapsed.toFixed(2)}ms` });
    return context;
}
/**
 * DB에서 컨텍스트 로드 (내부용)
 */
async function loadContextFromDB(project) {
    // Layer 1: 고정 컨텍스트
    const projectContextStmt = db.prepare('SELECT * FROM project_context WHERE project = ?');
    const projectContext = projectContextStmt.get(project);
    // Layer 2: 활성 컨텍스트
    const activeContextStmt = db.prepare('SELECT * FROM active_context WHERE project = ?');
    const activeContext = activeContextStmt.get(project);
    // Layer 3: 미완료 태스크 (최대 3개, 우선순위순)
    const tasksStmt = db.prepare(`
    SELECT id, title, status, priority
    FROM tasks
    WHERE project = ? AND status IN ('pending', 'in_progress')
    ORDER BY priority DESC, created_at DESC
    LIMIT 3
  `);
    const tasks = tasksStmt.all(project);
    return {
        project,
        fixed: {
            techStack: projectContext?.tech_stack ? JSON.parse(projectContext.tech_stack) : {},
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
        pendingTasks: tasks
    };
}
/**
 * 프로젝트 컨텍스트 자동 저장
 */
export async function saveContext(project, options) {
    const startTime = performance.now();
    const transaction = db.transaction(() => {
        // 활성 컨텍스트 업데이트
        const activeStmt = db.prepare(`
      INSERT OR REPLACE INTO active_context (project, current_state, recent_files, blockers, last_verification, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
        activeStmt.run(project, options.currentState, options.recentFiles ? JSON.stringify(options.recentFiles.slice(0, 10)) : null, options.blockers || null, options.verification || null);
        // 아키텍처 결정 추가 (있으면)
        if (options.architectureDecision) {
            updateArchitectureDecision(project, options.architectureDecision);
        }
        // 코드 패턴 추가 (있으면)
        if (options.codePattern) {
            updateCodePattern(project, options.codePattern);
        }
        // 기술 스택 업데이트 (있으면)
        if (options.techStack) {
            updateTechStack(project, options.techStack);
        }
    });
    transaction();
    // 캐시 무효화
    invalidateContext(project);
    const elapsed = performance.now() - startTime;
    logger.info('Context saved', { project, elapsed: `${elapsed.toFixed(2)}ms` });
}
// ===== 고정 컨텍스트 업데이트 헬퍼 =====
function updateArchitectureDecision(project, decision) {
    const getStmt = db.prepare('SELECT architecture_decisions FROM project_context WHERE project = ?');
    const row = getStmt.get(project);
    let decisions = [];
    if (row?.architecture_decisions) {
        try {
            decisions = JSON.parse(row.architecture_decisions);
        }
        catch { /* ignore */ }
    }
    // 중복 제거 후 앞에 추가 (최대 5개)
    decisions = decisions.filter(d => d !== decision);
    decisions.unshift(decision);
    decisions = decisions.slice(0, 5);
    const upsertStmt = db.prepare(`
    INSERT INTO project_context (project, architecture_decisions, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(project) DO UPDATE SET
      architecture_decisions = ?,
      updated_at = CURRENT_TIMESTAMP
  `);
    const json = JSON.stringify(decisions);
    upsertStmt.run(project, json, json);
}
function updateCodePattern(project, pattern) {
    const getStmt = db.prepare('SELECT code_patterns FROM project_context WHERE project = ?');
    const row = getStmt.get(project);
    let patterns = [];
    if (row?.code_patterns) {
        try {
            patterns = JSON.parse(row.code_patterns);
        }
        catch { /* ignore */ }
    }
    // 중복 제거 후 앞에 추가 (최대 5개)
    patterns = patterns.filter(p => p !== pattern);
    patterns.unshift(pattern);
    patterns = patterns.slice(0, 5);
    const upsertStmt = db.prepare(`
    INSERT INTO project_context (project, code_patterns, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(project) DO UPDATE SET
      code_patterns = ?,
      updated_at = CURRENT_TIMESTAMP
  `);
    const json = JSON.stringify(patterns);
    upsertStmt.run(project, json, json);
}
function updateTechStack(project, newStack) {
    const getStmt = db.prepare('SELECT tech_stack FROM project_context WHERE project = ?');
    const row = getStmt.get(project);
    let stack = {};
    if (row?.tech_stack) {
        try {
            stack = JSON.parse(row.tech_stack);
        }
        catch { /* ignore */ }
    }
    // 병합 (새 값이 기존 값 덮어씀)
    stack = { ...stack, ...newStack };
    const upsertStmt = db.prepare(`
    INSERT INTO project_context (project, tech_stack, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(project) DO UPDATE SET
      tech_stack = ?,
      updated_at = CURRENT_TIMESTAMP
  `);
    const json = JSON.stringify(stack);
    upsertStmt.run(project, json, json);
}
// ===== 컨텍스트 스냅샷 =====
/**
 * 현재 컨텍스트의 스냅샷 생성 (토큰 추정 포함)
 */
export async function createContextSnapshot(project) {
    const context = await loadContext(project);
    const tokenEstimate = estimateContextTokens(context);
    return {
        project,
        timestamp: new Date().toISOString(),
        tokenEstimate,
        context
    };
}
// ===== 컨텍스트 요약 =====
/**
 * 토큰 효율적 컨텍스트 요약 (650토큰 목표)
 */
export async function getCompactContext(project) {
    const context = await loadContext(project);
    const lines = [
        `# ${project}`,
        '',
    ];
    // 기술 스택 (간결하게)
    if (Object.keys(context.fixed.techStack).length > 0) {
        const stackStr = Object.entries(context.fixed.techStack)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ');
        lines.push(`**Stack**: ${stackStr}`);
    }
    // 아키텍처 결정 (최대 3개)
    if (context.fixed.architectureDecisions.length > 0) {
        lines.push(`**Decisions**: ${context.fixed.architectureDecisions.slice(0, 3).join(' | ')}`);
    }
    // 현재 상태
    lines.push(`**State**: ${context.active.currentState}`);
    // 최근 파일 (최대 5개)
    if (context.active.recentFiles.length > 0) {
        const files = context.active.recentFiles.slice(0, 5).map(f => f.split('/').pop()).join(', ');
        lines.push(`**Files**: ${files}`);
    }
    // 블로커
    if (context.active.blockers) {
        lines.push(`**Blocker**: ${context.active.blockers}`);
    }
    // 미완료 태스크
    if (context.pendingTasks.length > 0) {
        const tasks = context.pendingTasks.map(t => `[P${t.priority}] ${t.title}`).join(' | ');
        lines.push(`**Tasks**: ${tasks}`);
    }
    return lines.join('\n');
}
