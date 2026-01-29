#!/usr/bin/env node
/**
 * Project Manager MCP v3
 *
 * 18개 도구로 리팩토링된 버전
 * - mcp-memory-service 스타일 채택
 * - Hook 자동 주입 + 도구 최소화
 *
 * 카테고리:
 * 1. 세션/컨텍스트 (4개): session_start, session_end, session_history, search_sessions
 * 2. 프로젝트 관리 (4개): project_status, project_init, project_analyze, list_projects
 * 3. 태스크/백로그 (4개): task_add, task_update, task_list, task_suggest
 * 4. 솔루션 아카이브 (3개): solution_record, solution_find, solution_suggest
 * 5. 검증/품질 (3개): verify_build, verify_test, verify_all
 */
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
// v3 스키마 - 기존 테이블과 호환 유지
db.exec(`
  -- 기존 sessions 테이블 사용 (스키마 변경 없음)
  -- last_work = summary
  -- current_status = work_done
  -- next_tasks = next_steps (JSON array)
  -- modified_files = modified_files (JSON array)
  -- issues = blockers

  -- 프로젝트 컨텍스트 (고정)
  CREATE TABLE IF NOT EXISTS project_context (
    project TEXT PRIMARY KEY,
    tech_stack TEXT,
    architecture_decisions TEXT,
    code_patterns TEXT,
    special_notes TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 활성 컨텍스트 (자주 변경)
  CREATE TABLE IF NOT EXISTS active_context (
    project TEXT PRIMARY KEY,
    current_state TEXT,
    active_tasks TEXT,
    recent_files TEXT,
    blockers TEXT,
    last_verification TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 태스크 백로그
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending',
    priority INTEGER DEFAULT 5,
    related_files TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project, status);

  -- 솔루션 아카이브
  CREATE TABLE IF NOT EXISTS solutions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT,
    error_signature TEXT NOT NULL,
    error_message TEXT,
    solution TEXT NOT NULL,
    related_files TEXT,
    keywords TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_solutions_signature ON solutions(error_signature);
  CREATE INDEX IF NOT EXISTS idx_solutions_project ON solutions(project);

  -- 임베딩 v3 (시맨틱 검색용) - 기존 embeddings 테이블과 별도
  CREATE TABLE IF NOT EXISTS embeddings_v3 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    ref_id INTEGER NOT NULL,
    embedding BLOB NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(type, ref_id)
  );
  CREATE INDEX IF NOT EXISTS idx_embeddings_v3_type ON embeddings_v3(type, ref_id);
`);
// ===== 임베딩 엔진 =====
let embeddingPipeline = null;
async function initEmbedding() {
    if (embeddingPipeline)
        return;
    try {
        embeddingPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }
    catch (error) {
        console.error('Failed to load embedding model:', error);
    }
}
// 백그라운드 로드
initEmbedding();
async function generateEmbedding(text) {
    if (!embeddingPipeline)
        await initEmbedding();
    if (!embeddingPipeline)
        return null;
    try {
        const output = await embeddingPipeline(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data);
    }
    catch {
        return null;
    }
}
function cosineSimilarity(a, b) {
    if (a.length !== b.length)
        return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
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
async function detectPlatform(projectPath) {
    if (await fileExists(path.join(projectPath, 'pubspec.yaml')))
        return 'flutter';
    if (await fileExists(path.join(projectPath, 'build.gradle.kts')))
        return 'android';
    if (await fileExists(path.join(projectPath, 'package.json')))
        return 'web';
    return 'unknown';
}
async function detectTechStack(projectPath) {
    const stack = {};
    // Flutter
    if (await fileExists(path.join(projectPath, 'pubspec.yaml'))) {
        stack.framework = 'Flutter';
        const content = await fs.readFile(path.join(projectPath, 'pubspec.yaml'), 'utf-8');
        if (content.includes('flutter_riverpod'))
            stack.state = 'Riverpod';
        if (content.includes('provider:'))
            stack.state = 'Provider';
        if (content.includes('bloc:'))
            stack.state = 'BLoC';
    }
    // Web (Next.js, etc.)
    const pkgPath = path.join(projectPath, 'package.json');
    if (await fileExists(pkgPath)) {
        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
        if (pkg.dependencies?.next)
            stack.framework = 'Next.js';
        else if (pkg.dependencies?.react)
            stack.framework = 'React';
        else if (pkg.dependencies?.vue)
            stack.framework = 'Vue';
        if (pkg.dependencies?.typescript || pkg.devDependencies?.typescript)
            stack.language = 'TypeScript';
    }
    return stack;
}
function runCommand(cmd, cwd) {
    try {
        const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] });
        return { success: true, output };
    }
    catch (error) {
        const e = error;
        return { success: false, output: e.stdout || e.stderr || e.message || 'Unknown error' };
    }
}
// ===== MCP 서버 =====
const server = new Server({ name: 'project-manager-v3', version: '3.0.0' }, { capabilities: { tools: { listChanged: true } } });
const tools = [
    // ===== 1. 세션/컨텍스트 (4개) =====
    {
        name: 'session_start',
        description: '세션 시작 시 프로젝트 컨텍스트를 로드합니다. Hook에서 자동 호출되지만 수동 호출도 가능합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트 이름' },
                compact: { type: 'boolean', description: '간결한 포맷 (기본: true)' }
            },
            required: ['project']
        }
    },
    {
        name: 'session_end',
        description: '세션 종료 시 현재 상태를 저장합니다. 다음 세션에서 자동 복구됩니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트 이름' },
                summary: { type: 'string', description: '이번 세션 요약 (1-2줄)' },
                workDone: { type: 'string', description: '완료한 작업' },
                nextSteps: { type: 'array', items: { type: 'string' }, description: '다음 할 일' },
                modifiedFiles: { type: 'array', items: { type: 'string' }, description: '수정한 파일' },
                blockers: { type: 'string', description: '막힌 것/이슈' }
            },
            required: ['project', 'summary']
        }
    },
    {
        name: 'session_history',
        description: '프로젝트의 세션 이력을 조회합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트 이름' },
                limit: { type: 'number', description: '조회 개수 (기본: 5)' },
                days: { type: 'number', description: '최근 N일 (기본: 7)' }
            },
            required: ['project']
        }
    },
    {
        name: 'search_sessions',
        description: '세션 이력을 시맨틱 검색합니다. "저번에 인증 작업했을 때" 같은 검색에 유용합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '검색어' },
                project: { type: 'string', description: '프로젝트 (선택)' },
                limit: { type: 'number', description: '결과 개수 (기본: 5)' }
            },
            required: ['query']
        }
    },
    // ===== 2. 프로젝트 관리 (4개) =====
    {
        name: 'project_status',
        description: '프로젝트 진행 현황을 조회합니다. 완성도, 태스크, 최근 변경 등.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트 이름' }
            },
            required: ['project']
        }
    },
    {
        name: 'project_init',
        description: '새 프로젝트를 초기화합니다. 컨텍스트 테이블에 기본 정보를 저장합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트 이름' },
                techStack: { type: 'object', description: '기술 스택 (자동 감지 가능)' },
                description: { type: 'string', description: '프로젝트 설명' }
            },
            required: ['project']
        }
    },
    {
        name: 'project_analyze',
        description: '프로젝트를 분석하여 기술 스택, 구조 등을 자동 감지합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트 이름' }
            },
            required: ['project']
        }
    },
    {
        name: 'list_projects',
        description: 'apps/ 디렉토리의 모든 프로젝트 목록을 반환합니다.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    // ===== 3. 태스크/백로그 (4개) =====
    {
        name: 'task_add',
        description: '새 태스크를 추가합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트 이름' },
                title: { type: 'string', description: '태스크 제목' },
                description: { type: 'string', description: '상세 설명' },
                priority: { type: 'number', description: '우선순위 1-10 (기본: 5)' },
                relatedFiles: { type: 'array', items: { type: 'string' }, description: '관련 파일' }
            },
            required: ['project', 'title']
        }
    },
    {
        name: 'task_update',
        description: '태스크 상태를 변경합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                taskId: { type: 'number', description: '태스크 ID' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'blocked'], description: '새 상태' },
                note: { type: 'string', description: '메모 (완료 시 결과 등)' }
            },
            required: ['taskId', 'status']
        }
    },
    {
        name: 'task_list',
        description: '프로젝트의 태스크 목록을 조회합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트 이름' },
                status: { type: 'string', enum: ['all', 'pending', 'in_progress', 'done', 'blocked'], description: '필터 (기본: pending)' }
            },
            required: ['project']
        }
    },
    {
        name: 'task_suggest',
        description: '코드 분석 기반으로 TODO, FIXME 등에서 태스크를 추출하여 제안합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트 이름' },
                path: { type: 'string', description: '특정 경로만 분석 (선택)' }
            },
            required: ['project']
        }
    },
    // ===== 4. 솔루션 아카이브 (3개) =====
    {
        name: 'solution_record',
        description: '에러 해결 방법을 기록합니다. 나중에 같은 에러 발생 시 자동 검색됩니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트 이름' },
                errorSignature: { type: 'string', description: '에러 패턴/시그니처 (검색 키)' },
                errorMessage: { type: 'string', description: '전체 에러 메시지' },
                solution: { type: 'string', description: '해결 방법' },
                relatedFiles: { type: 'array', items: { type: 'string' }, description: '관련 파일' }
            },
            required: ['errorSignature', 'solution']
        }
    },
    {
        name: 'solution_find',
        description: '유사한 에러의 해결 방법을 검색합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '에러 메시지 또는 키워드' },
                project: { type: 'string', description: '프로젝트 (선택)' },
                limit: { type: 'number', description: '결과 개수 (기본: 3)' }
            },
            required: ['query']
        }
    },
    {
        name: 'solution_suggest',
        description: '과거 솔루션 기반으로 현재 에러에 대한 해결책을 AI가 제안합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                errorMessage: { type: 'string', description: '현재 에러 메시지' },
                project: { type: 'string', description: '프로젝트' }
            },
            required: ['errorMessage']
        }
    },
    // ===== 5. 검증/품질 (3개) =====
    {
        name: 'verify_build',
        description: '프로젝트 빌드를 실행합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트 이름' }
            },
            required: ['project']
        }
    },
    {
        name: 'verify_test',
        description: '프로젝트 테스트를 실행합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트 이름' },
                testPath: { type: 'string', description: '특정 테스트 파일/폴더 (선택)' }
            },
            required: ['project']
        }
    },
    {
        name: 'verify_all',
        description: '빌드 + 테스트 + 린트를 한 번에 실행합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트 이름' },
                stopOnFail: { type: 'boolean', description: '실패 시 중단 (기본: false)' }
            },
            required: ['project']
        }
    }
];
// ===== 도구 핸들러 =====
async function handleTool(name, args) {
    try {
        switch (name) {
            // ===== 세션/컨텍스트 =====
            case 'session_start': {
                const project = args.project;
                const compact = args.compact !== false;
                const projectPath = path.join(APPS_DIR, project);
                if (!await fileExists(projectPath)) {
                    return { content: [{ type: 'text', text: `Project not found: ${project}` }] };
                }
                // 고정 컨텍스트
                const fixedRow = db.prepare('SELECT * FROM project_context WHERE project = ?').get(project);
                // 활성 컨텍스트
                const activeRow = db.prepare('SELECT * FROM active_context WHERE project = ?').get(project);
                // 최근 세션
                const lastSession = db.prepare('SELECT * FROM sessions WHERE project = ? ORDER BY timestamp DESC LIMIT 1').get(project);
                // 미완료 태스크
                const pendingTasks = db.prepare(`
          SELECT id, title, status, priority FROM tasks
          WHERE project = ? AND status IN ('pending', 'in_progress')
          ORDER BY priority DESC LIMIT 5
        `).all(project);
                if (compact) {
                    const lines = [`# ${project} Context`];
                    if (fixedRow?.tech_stack) {
                        const stack = JSON.parse(fixedRow.tech_stack);
                        lines.push(`**Stack**: ${Object.entries(stack).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
                    }
                    if (activeRow?.current_state) {
                        lines.push(`**State**: ${activeRow.current_state}`);
                    }
                    if (lastSession?.last_work) {
                        lines.push(`**Last**: ${lastSession.last_work}`);
                    }
                    if (pendingTasks.length > 0) {
                        lines.push(`**Tasks**: ${pendingTasks.map(t => `[P${t.priority}] ${t.title}`).join(' | ')}`);
                    }
                    if (activeRow?.blockers) {
                        lines.push(`**Blocker**: ${activeRow.blockers}`);
                    }
                    return { content: [{ type: 'text', text: lines.join('\n') }] };
                }
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify({
                                project,
                                fixed: fixedRow ? {
                                    techStack: fixedRow.tech_stack ? JSON.parse(fixedRow.tech_stack) : {},
                                    architectureDecisions: fixedRow.architecture_decisions ? JSON.parse(fixedRow.architecture_decisions) : [],
                                    codePatterns: fixedRow.code_patterns ? JSON.parse(fixedRow.code_patterns) : []
                                } : null,
                                active: activeRow ? {
                                    currentState: activeRow.current_state,
                                    activeTasks: activeRow.active_tasks ? JSON.parse(activeRow.active_tasks) : [],
                                    recentFiles: activeRow.recent_files ? JSON.parse(activeRow.recent_files) : [],
                                    blockers: activeRow.blockers,
                                    lastVerification: activeRow.last_verification
                                } : null,
                                lastSession: lastSession ? {
                                    summary: lastSession.last_work,
                                    workDone: lastSession.current_status,
                                    nextSteps: lastSession.next_tasks ? JSON.parse(lastSession.next_tasks) : [],
                                    timestamp: lastSession.timestamp
                                } : null,
                                pendingTasks
                            }, null, 2)
                        }]
                };
            }
            case 'session_end': {
                const project = args.project;
                const summary = args.summary;
                const workDone = args.workDone;
                const nextSteps = args.nextSteps;
                const modifiedFiles = args.modifiedFiles;
                const blockers = args.blockers;
                // 세션 저장 (기존 스키마 호환)
                // last_work = summary, current_status = workDone, issues = blockers
                db.prepare(`
          INSERT INTO sessions (project, last_work, current_status, next_tasks, modified_files, issues)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(project, summary, workDone || null, nextSteps ? JSON.stringify(nextSteps) : null, modifiedFiles ? JSON.stringify(modifiedFiles) : null, blockers || null);
                // 활성 컨텍스트 업데이트
                db.prepare(`
          INSERT OR REPLACE INTO active_context (project, current_state, recent_files, blockers, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `).run(project, summary, modifiedFiles ? JSON.stringify(modifiedFiles) : null, blockers || null);
                return { content: [{ type: 'text', text: `✅ Session saved for ${project}` }] };
            }
            case 'session_history': {
                const project = args.project;
                const limit = args.limit || 5;
                const days = args.days || 7;
                const sessions = db.prepare(`
          SELECT * FROM sessions
          WHERE project = ? AND timestamp > datetime('now', '-${days} days')
          ORDER BY timestamp DESC LIMIT ?
        `).all(project, limit);
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify(sessions.map(s => ({
                                id: s.id,
                                summary: s.last_work,
                                workDone: s.current_status,
                                nextSteps: s.next_tasks ? JSON.parse(s.next_tasks) : [],
                                timestamp: s.timestamp
                            })), null, 2)
                        }]
                };
            }
            case 'search_sessions': {
                const query = args.query;
                const project = args.project;
                const limit = args.limit || 5;
                // 시맨틱 검색 (임베딩 사용)
                const queryEmbedding = await generateEmbedding(query);
                if (!queryEmbedding) {
                    // 폴백: 키워드 검색 (기존 스키마: last_work, current_status)
                    const sql = project
                        ? 'SELECT * FROM sessions WHERE project = ? AND (last_work LIKE ? OR current_status LIKE ?) ORDER BY timestamp DESC LIMIT ?'
                        : 'SELECT * FROM sessions WHERE last_work LIKE ? OR current_status LIKE ? ORDER BY timestamp DESC LIMIT ?';
                    const params = project
                        ? [project, `%${query}%`, `%${query}%`, limit]
                        : [`%${query}%`, `%${query}%`, limit];
                    const results = db.prepare(sql).all(...params);
                    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
                }
                // 모든 세션 가져와서 유사도 계산
                const allSessions = db.prepare(project
                    ? 'SELECT * FROM sessions WHERE project = ? ORDER BY timestamp DESC LIMIT 100'
                    : 'SELECT * FROM sessions ORDER BY timestamp DESC LIMIT 100').all(project ? [project] : []);
                const scored = await Promise.all(allSessions.map(async (s) => {
                    const text = `${s.last_work} ${s.current_status || ''}`;
                    const emb = await generateEmbedding(text);
                    const similarity = emb ? cosineSimilarity(queryEmbedding, emb) : 0;
                    return { ...s, similarity };
                }));
                scored.sort((a, b) => b.similarity - a.similarity);
                const top = scored.slice(0, limit);
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify(top.map(s => ({
                                id: s.id,
                                project: s.project,
                                summary: s.last_work,
                                similarity: Math.round(s.similarity * 100) + '%',
                                timestamp: s.timestamp
                            })), null, 2)
                        }]
                };
            }
            // ===== 프로젝트 관리 =====
            case 'project_status': {
                const project = args.project;
                const projectPath = path.join(APPS_DIR, project);
                if (!await fileExists(projectPath)) {
                    return { content: [{ type: 'text', text: `Project not found: ${project}` }] };
                }
                // 태스크 통계
                const taskStats = db.prepare(`
          SELECT status, COUNT(*) as count FROM tasks WHERE project = ? GROUP BY status
        `).all(project);
                // 최근 세션
                const recentSessions = db.prepare(`
          SELECT last_work as summary, timestamp FROM sessions WHERE project = ? ORDER BY timestamp DESC LIMIT 3
        `).all(project);
                // 활성 컨텍스트
                const active = db.prepare('SELECT * FROM active_context WHERE project = ?').get(project);
                // 진행도 계산
                const done = taskStats.find(t => t.status === 'done')?.count || 0;
                const total = taskStats.reduce((sum, t) => sum + t.count, 0);
                const progress = total > 0 ? Math.round((done / total) * 100) : 0;
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify({
                                project,
                                progress: `${progress}%`,
                                tasks: {
                                    done,
                                    inProgress: taskStats.find(t => t.status === 'in_progress')?.count || 0,
                                    pending: taskStats.find(t => t.status === 'pending')?.count || 0,
                                    blocked: taskStats.find(t => t.status === 'blocked')?.count || 0,
                                    total
                                },
                                currentState: active?.current_state || 'No active context',
                                lastVerification: active?.last_verification || 'N/A',
                                recentActivity: recentSessions.map(s => ({
                                    summary: s.summary,
                                    date: s.timestamp
                                }))
                            }, null, 2)
                        }]
                };
            }
            case 'project_init': {
                const project = args.project;
                const techStack = args.techStack;
                const description = args.description;
                const projectPath = path.join(APPS_DIR, project);
                // 기술 스택 자동 감지
                const detectedStack = await detectTechStack(projectPath);
                const finalStack = { ...detectedStack, ...techStack };
                db.prepare(`
          INSERT OR REPLACE INTO project_context (project, tech_stack, special_notes, updated_at)
          VALUES (?, ?, ?, datetime('now'))
        `).run(project, JSON.stringify(finalStack), description || null);
                db.prepare(`
          INSERT OR REPLACE INTO active_context (project, current_state, updated_at)
          VALUES (?, 'Project initialized', datetime('now'))
        `).run(project);
                return {
                    content: [{
                            type: 'text',
                            text: `✅ Project "${project}" initialized\nTech Stack: ${JSON.stringify(finalStack)}`
                        }]
                };
            }
            case 'project_analyze': {
                const project = args.project;
                const projectPath = path.join(APPS_DIR, project);
                if (!await fileExists(projectPath)) {
                    return { content: [{ type: 'text', text: `Project not found: ${project}` }] };
                }
                const platform = await detectPlatform(projectPath);
                const techStack = await detectTechStack(projectPath);
                // 파일 구조 분석
                const structure = [];
                try {
                    const entries = await fs.readdir(projectPath, { withFileTypes: true });
                    for (const entry of entries) {
                        if (entry.name.startsWith('.'))
                            continue;
                        structure.push(entry.isDirectory() ? `📁 ${entry.name}/` : `📄 ${entry.name}`);
                    }
                }
                catch { }
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify({
                                project,
                                platform,
                                techStack,
                                structure: structure.slice(0, 20)
                            }, null, 2)
                        }]
                };
            }
            case 'list_projects': {
                try {
                    const entries = await fs.readdir(APPS_DIR, { withFileTypes: true });
                    const projects = entries
                        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
                        .map(e => e.name);
                    // 각 프로젝트 상태 조회
                    const projectsWithStatus = await Promise.all(projects.map(async (p) => {
                        const active = db.prepare('SELECT current_state FROM active_context WHERE project = ?').get(p);
                        const taskCount = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE project = ? AND status != ?').get(p, 'done');
                        return {
                            name: p,
                            status: active?.current_state || 'No context',
                            pendingTasks: taskCount?.count || 0
                        };
                    }));
                    return { content: [{ type: 'text', text: JSON.stringify(projectsWithStatus, null, 2) }] };
                }
                catch (error) {
                    return { content: [{ type: 'text', text: `Failed to list projects: ${error instanceof Error ? error.message : String(error)}` }] };
                }
            }
            // ===== 태스크/백로그 =====
            case 'task_add': {
                const project = args.project;
                const title = args.title;
                const description = args.description;
                const priority = args.priority || 5;
                const relatedFiles = args.relatedFiles;
                const result = db.prepare(`
          INSERT INTO tasks (project, title, description, priority, related_files)
          VALUES (?, ?, ?, ?, ?)
        `).run(project, title, description || null, priority, relatedFiles ? JSON.stringify(relatedFiles) : null);
                return {
                    content: [{
                            type: 'text',
                            text: `✅ Task added (ID: ${result.lastInsertRowid})\n[P${priority}] ${title}`
                        }]
                };
            }
            case 'task_update': {
                const taskId = args.taskId;
                const status = args.status;
                const note = args.note;
                const completedAt = status === 'done' ? "datetime('now')" : 'NULL';
                db.prepare(`
          UPDATE tasks SET status = ?, completed_at = ${status === 'done' ? "datetime('now')" : 'NULL'}
          WHERE id = ?
        `).run(status, taskId);
                const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
                return {
                    content: [{
                            type: 'text',
                            text: `✅ Task #${taskId} → ${status}${note ? `\nNote: ${note}` : ''}\n${task?.title || ''}`
                        }]
                };
            }
            case 'task_list': {
                const project = args.project;
                const status = args.status || 'pending';
                const sql = status === 'all'
                    ? 'SELECT * FROM tasks WHERE project = ? ORDER BY priority DESC, created_at DESC'
                    : 'SELECT * FROM tasks WHERE project = ? AND status = ? ORDER BY priority DESC, created_at DESC';
                const tasks = status === 'all'
                    ? db.prepare(sql).all(project)
                    : db.prepare(sql).all(project, status);
                return { content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }] };
            }
            case 'task_suggest': {
                const project = args.project;
                const searchPath = args.path;
                const projectPath = path.join(APPS_DIR, project, searchPath || '');
                // TODO, FIXME 등 검색
                try {
                    const result = runCommand(`grep -rn "TODO\\|FIXME\\|HACK\\|XXX" --include="*.ts" --include="*.tsx" --include="*.dart" --include="*.kt" . | head -20`, projectPath);
                    if (!result.success || !result.output.trim()) {
                        return { content: [{ type: 'text', text: 'No TODO/FIXME comments found' }] };
                    }
                    const lines = result.output.trim().split('\n');
                    const suggestions = lines.map(line => {
                        const match = line.match(/^(.+?):(\d+):(.+)$/);
                        if (match) {
                            return {
                                file: match[1],
                                line: parseInt(match[2]),
                                comment: match[3].trim()
                            };
                        }
                        return { comment: line };
                    });
                    return {
                        content: [{
                                type: 'text',
                                text: `Found ${suggestions.length} potential tasks:\n\n${JSON.stringify(suggestions, null, 2)}`
                            }]
                    };
                }
                catch {
                    return { content: [{ type: 'text', text: 'Failed to search for tasks' }] };
                }
            }
            // ===== 솔루션 아카이브 =====
            case 'solution_record': {
                const project = args.project;
                const errorSignature = args.errorSignature;
                const errorMessage = args.errorMessage;
                const solution = args.solution;
                const relatedFiles = args.relatedFiles;
                // 키워드 자동 추출
                const keywords = errorSignature.toLowerCase()
                    .replace(/[^a-z0-9\s]/g, ' ')
                    .split(/\s+/)
                    .filter(w => w.length > 2)
                    .slice(0, 10)
                    .join(',');
                const result = db.prepare(`
          INSERT INTO solutions (project, error_signature, error_message, solution, related_files, keywords)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(project || null, errorSignature, errorMessage || null, solution, relatedFiles ? JSON.stringify(relatedFiles) : null, keywords);
                // 임베딩 저장 (시맨틱 검색용)
                const embedding = await generateEmbedding(`${errorSignature} ${errorMessage || ''} ${solution}`);
                if (embedding) {
                    const buffer = Buffer.from(new Float32Array(embedding).buffer);
                    db.prepare('INSERT OR REPLACE INTO embeddings_v3 (type, ref_id, embedding) VALUES (?, ?, ?)').run('solution', result.lastInsertRowid, buffer);
                }
                return {
                    content: [{
                            type: 'text',
                            text: `✅ Solution recorded (ID: ${result.lastInsertRowid})\nSignature: ${errorSignature}`
                        }]
                };
            }
            case 'solution_find': {
                const query = args.query;
                const project = args.project;
                const limit = args.limit || 3;
                // 키워드 검색 먼저
                const keywordResults = db.prepare(`
          SELECT * FROM solutions
          WHERE error_signature LIKE ? OR error_message LIKE ? OR keywords LIKE ?
          ${project ? 'AND project = ?' : ''}
          ORDER BY created_at DESC LIMIT ?
        `).all(`%${query}%`, `%${query}%`, `%${query}%`, ...(project ? [project, limit] : [limit]));
                if (keywordResults.length > 0) {
                    return {
                        content: [{
                                type: 'text',
                                text: JSON.stringify(keywordResults.map(r => ({
                                    id: r.id,
                                    errorSignature: r.error_signature,
                                    solution: r.solution,
                                    project: r.project,
                                    created: r.created_at
                                })), null, 2)
                            }]
                    };
                }
                // 시맨틱 검색 폴백
                const queryEmb = await generateEmbedding(query);
                if (!queryEmb) {
                    return { content: [{ type: 'text', text: 'No solutions found' }] };
                }
                const allSolutions = db.prepare(`
          SELECT s.*, e.embedding FROM solutions s
          LEFT JOIN embeddings_v3 e ON e.type = 'solution' AND e.ref_id = s.id
          ${project ? 'WHERE s.project = ?' : ''}
          LIMIT 50
        `).all(project ? [project] : []);
                const scored = allSolutions.map(s => {
                    if (!s.embedding)
                        return { ...s, similarity: 0 };
                    const emb = Array.from(new Float32Array(s.embedding.buffer));
                    return { ...s, similarity: cosineSimilarity(queryEmb, emb) };
                });
                scored.sort((a, b) => b.similarity - a.similarity);
                const topResults = scored.slice(0, limit);
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify(topResults.map(r => ({
                                id: r.id,
                                errorSignature: r.error_signature,
                                solution: r.solution,
                                similarity: Math.round(r.similarity * 100) + '%'
                            })), null, 2)
                        }]
                };
            }
            case 'solution_suggest': {
                const errorMessage = args.errorMessage;
                const project = args.project;
                // solution_find 결과를 기반으로 제안
                const similar = db.prepare(`
          SELECT * FROM solutions
          WHERE error_signature LIKE ? OR error_message LIKE ?
          ${project ? 'AND project = ?' : ''}
          ORDER BY created_at DESC LIMIT 3
        `).all(`%${errorMessage.substring(0, 50)}%`, `%${errorMessage.substring(0, 50)}%`, ...(project ? [project] : []));
                if (similar.length === 0) {
                    return { content: [{ type: 'text', text: 'No similar solutions found. This might be a new error.' }] };
                }
                const suggestions = similar.map((s, i) => `
### Solution ${i + 1} (from: ${s.project || 'global'})
**Error**: ${s.error_signature}
**Solution**: ${s.solution}
        `).join('\n');
                return {
                    content: [{
                            type: 'text',
                            text: `Found ${similar.length} similar solutions:\n${suggestions}`
                        }]
                };
            }
            // ===== 검증/품질 =====
            case 'verify_build': {
                const project = args.project;
                const projectPath = path.join(APPS_DIR, project);
                const platform = await detectPlatform(projectPath);
                let cmd;
                switch (platform) {
                    case 'flutter':
                        cmd = 'flutter build apk --debug';
                        break;
                    case 'android':
                        cmd = './gradlew assembleDebug';
                        break;
                    case 'web':
                        cmd = 'pnpm build';
                        break;
                    default:
                        return { content: [{ type: 'text', text: `Unknown platform: ${platform}` }] };
                }
                const result = runCommand(cmd, projectPath);
                // 결과 저장
                db.prepare(`
          INSERT OR REPLACE INTO active_context (project, last_verification, updated_at)
          VALUES (?, ?, datetime('now'))
        `).run(project, result.success ? 'build:passed' : 'build:failed');
                return {
                    content: [{
                            type: 'text',
                            text: `${result.success ? '✅' : '❌'} Build ${result.success ? 'passed' : 'failed'}\n\n${result.output.slice(-1000)}`
                        }]
                };
            }
            case 'verify_test': {
                const project = args.project;
                const testPath = args.testPath;
                const projectPath = path.join(APPS_DIR, project);
                const platform = await detectPlatform(projectPath);
                let cmd;
                switch (platform) {
                    case 'flutter':
                        cmd = testPath ? `flutter test ${testPath}` : 'flutter test';
                        break;
                    case 'web':
                        cmd = testPath ? `pnpm test ${testPath}` : 'pnpm test';
                        break;
                    default:
                        return { content: [{ type: 'text', text: `Tests not configured for platform: ${platform}` }] };
                }
                const result = runCommand(cmd, projectPath);
                return {
                    content: [{
                            type: 'text',
                            text: `${result.success ? '✅' : '❌'} Tests ${result.success ? 'passed' : 'failed'}\n\n${result.output.slice(-1000)}`
                        }]
                };
            }
            case 'verify_all': {
                const project = args.project;
                const stopOnFail = args.stopOnFail === true;
                const projectPath = path.join(APPS_DIR, project);
                const platform = await detectPlatform(projectPath);
                const results = [];
                // Build
                let buildCmd;
                let testCmd;
                let lintCmd;
                switch (platform) {
                    case 'flutter':
                        buildCmd = 'flutter build apk --debug';
                        testCmd = 'flutter test';
                        lintCmd = 'flutter analyze';
                        break;
                    case 'web':
                        buildCmd = 'pnpm build';
                        testCmd = 'pnpm test';
                        lintCmd = 'pnpm lint';
                        break;
                    default:
                        return { content: [{ type: 'text', text: `Unknown platform: ${platform}` }] };
                }
                // Execute each step
                for (const [name, cmd] of [['build', buildCmd], ['test', testCmd], ['lint', lintCmd]]) {
                    const result = runCommand(cmd, projectPath);
                    results.push({ step: name, success: result.success, output: result.output.slice(-500) });
                    if (!result.success && stopOnFail)
                        break;
                }
                const allPassed = results.every(r => r.success);
                // 결과 저장
                db.prepare(`
          INSERT OR REPLACE INTO active_context (project, last_verification, updated_at)
          VALUES (?, ?, datetime('now'))
        `).run(project, allPassed ? 'all:passed' : 'all:failed');
                const summary = results.map(r => `${r.success ? '✅' : '❌'} ${r.step}: ${r.success ? 'passed' : 'failed'}`).join('\n');
                return {
                    content: [{
                            type: 'text',
                            text: `## Verification Results\n\n${summary}\n\n### Details\n${results.map(r => `**${r.step}**:\n${r.output}`).join('\n\n')}`
                        }]
                };
            }
            default:
                return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
        }
    }
    catch (error) {
        return {
            content: [{
                    type: 'text',
                    text: `Error: ${error instanceof Error ? error.message : String(error)}`
                }],
            isError: true
        };
    }
}
// ===== MCP 요청 핸들러 =====
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return handleTool(request.params.name, request.params.arguments || {});
});
// ===== 서버 시작 =====
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Project Manager MCP v3 started');
}
main().catch(console.error);
