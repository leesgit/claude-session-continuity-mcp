// 자동 컨텍스트 캡처 시스템
// 세션 시작 시 자동 로드, 세션 종료 시 자동 저장

import { db } from '../db/database.js';
import { logger } from './logger.js';
import { contextCache, makeContextKey, invalidateContext } from './cache.js';

// ===== 타입 정의 =====

export interface ProjectContext {
  project: string;
  fixed: {
    techStack: Record<string, string>;
    architectureDecisions: string[];
    codePatterns: string[];
    specialNotes: string | null;
  };
  active: {
    currentState: string;
    recentFiles: string[];
    blockers: string | null;
    lastVerification: string | null;
    updatedAt: string | null;
  };
  pendingTasks: Array<{
    id: number;
    title: string;
    status: string;
    priority: number;
  }>;
  directives: Array<{
    directive: string;
    priority: string;
  }>;
  hotPaths: Array<{
    filePath: string;
    accessCount: number;
  }>;
}

export interface ContextSnapshot {
  project: string;
  timestamp: string;
  tokenEstimate: number;
  context: ProjectContext;
}

// ===== 토큰 추정 =====

/**
 * 문자열의 토큰 수 추정 (평균 4자 = 1토큰)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * 컨텍스트의 총 토큰 수 추정
 */
export function estimateContextTokens(context: ProjectContext): number {
  const json = JSON.stringify(context);
  return estimateTokens(json);
}

// ===== 자동 컨텍스트 로드 =====

/**
 * 프로젝트 컨텍스트 자동 로드 (캐시 우선)
 * 목표: < 5ms (캐시 히트 시)
 */
export async function loadContext(project: string): Promise<ProjectContext> {
  const startTime = performance.now();
  const cacheKey = makeContextKey(project);

  // 캐시 확인
  const cached = contextCache.get(cacheKey) as ProjectContext | undefined;
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
async function loadContextFromDB(project: string): Promise<ProjectContext> {
  // Layer 1: 고정 컨텍스트
  const projectContextStmt = db.prepare('SELECT * FROM project_context WHERE project = ?');
  const projectContext = projectContextStmt.get(project) as {
    tech_stack: string | null;
    architecture_decisions: string | null;
    code_patterns: string | null;
    special_notes: string | null;
  } | undefined;

  // Layer 2: 활성 컨텍스트
  const activeContextStmt = db.prepare('SELECT * FROM active_context WHERE project = ?');
  const activeContext = activeContextStmt.get(project) as {
    current_state: string | null;
    recent_files: string | null;
    blockers: string | null;
    last_verification: string | null;
    updated_at: string;
  } | undefined;

  // Layer 3: 미완료 태스크 (최대 3개, 우선순위순)
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

  // Layer 4: 사용자 지시사항
  let directives: Array<{ directive: string; priority: string }> = [];
  try {
    directives = db.prepare(`
      SELECT directive, priority FROM user_directives
      WHERE project = ? ORDER BY priority DESC, created_at DESC LIMIT 10
    `).all(project) as Array<{ directive: string; priority: string }>;
  } catch { /* table may not exist yet */ }

  // Layer 5: Hot paths (7일 이내, 상위 10개)
  let hotPaths: Array<{ file_path: string; access_count: number }> = [];
  try {
    hotPaths = db.prepare(`
      SELECT file_path, access_count FROM hot_paths
      WHERE project = ? AND last_accessed > datetime('now', '-7 days')
      ORDER BY access_count DESC LIMIT 10
    `).all(project) as Array<{ file_path: string; access_count: number }>;
  } catch { /* table may not exist yet */ }

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
    pendingTasks: tasks,
    directives,
    hotPaths: hotPaths.map(h => ({ filePath: h.file_path, accessCount: h.access_count }))
  };
}

// ===== 자동 컨텍스트 저장 =====

export interface SaveContextOptions {
  currentState: string;
  recentFiles?: string[];
  blockers?: string | null;
  verification?: 'passed' | 'failed' | null;
  architectureDecision?: string;
  codePattern?: string;
  techStack?: Record<string, string>;
}

/**
 * 프로젝트 컨텍스트 자동 저장
 */
export async function saveContext(project: string, options: SaveContextOptions): Promise<void> {
  const startTime = performance.now();

  const transaction = db.transaction(() => {
    // 활성 컨텍스트 업데이트
    const activeStmt = db.prepare(`
      INSERT OR REPLACE INTO active_context (project, current_state, recent_files, blockers, last_verification, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    activeStmt.run(
      project,
      options.currentState,
      options.recentFiles ? JSON.stringify(options.recentFiles.slice(0, 10)) : null,
      options.blockers || null,
      options.verification || null
    );

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

function updateArchitectureDecision(project: string, decision: string): void {
  const getStmt = db.prepare('SELECT architecture_decisions FROM project_context WHERE project = ?');
  const row = getStmt.get(project) as { architecture_decisions: string | null } | undefined;

  let decisions: string[] = [];
  if (row?.architecture_decisions) {
    try {
      decisions = JSON.parse(row.architecture_decisions);
    } catch { /* ignore */ }
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

function updateCodePattern(project: string, pattern: string): void {
  const getStmt = db.prepare('SELECT code_patterns FROM project_context WHERE project = ?');
  const row = getStmt.get(project) as { code_patterns: string | null } | undefined;

  let patterns: string[] = [];
  if (row?.code_patterns) {
    try {
      patterns = JSON.parse(row.code_patterns);
    } catch { /* ignore */ }
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

function updateTechStack(project: string, newStack: Record<string, string>): void {
  const getStmt = db.prepare('SELECT tech_stack FROM project_context WHERE project = ?');
  const row = getStmt.get(project) as { tech_stack: string | null } | undefined;

  let stack: Record<string, string> = {};
  if (row?.tech_stack) {
    try {
      stack = JSON.parse(row.tech_stack);
    } catch { /* ignore */ }
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
export async function createContextSnapshot(project: string): Promise<ContextSnapshot> {
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
export async function getCompactContext(project: string): Promise<string> {
  const context = await loadContext(project);

  const lines: string[] = [
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

  // 사용자 지시사항
  if (context.directives.length > 0) {
    const dirs = context.directives.map(d => `${d.priority === 'high' ? '🔴' : '📎'} ${d.directive}`).join(' | ');
    lines.push(`**Directives**: ${dirs}`);
  }

  // Hot files
  if (context.hotPaths.length > 0) {
    const files = context.hotPaths.slice(0, 5).map(h => `${h.filePath.split('/').pop()}(${h.accessCount}x)`).join(', ');
    lines.push(`**Hot Files**: ${files}`);
  }

  return lines.join('\n');
}
