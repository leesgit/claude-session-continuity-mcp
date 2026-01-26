// 프로젝트 도구 (projects)
// 프로젝트 목록 및 통계
import * as fs from 'fs';
import * as path from 'path';
import { db, APPS_DIR } from '../db/database.js';
import { logger } from '../utils/logger.js';
import { ProjectsSchema } from '../schemas.js';
// ===== 도구 정의 =====
export const projectsTools = [
    {
        name: 'projects',
        description: `프로젝트 목록 및 통계 조회.
- project 없으면: 전체 프로젝트 목록
- project 있으면: 해당 프로젝트 상세 정보

각 프로젝트의 플랫폼, 최근 활동, 태스크 현황 포함.`,
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '특정 프로젝트 (없으면 전체)' }
            }
        }
    }
];
// ===== 핸들러 =====
export async function handleProjects(args) {
    return logger.withTool('projects', async () => {
        // 입력 검증
        const parsed = ProjectsSchema.safeParse(args);
        if (!parsed.success) {
            return {
                content: [{ type: 'text', text: `Validation error: ${parsed.error.message}` }],
                isError: true
            };
        }
        const { project } = parsed.data;
        if (project) {
            return getProjectDetail(project);
        }
        return getProjectList();
    }, args);
}
async function getProjectList() {
    // 파일 시스템에서 프로젝트 목록 조회
    let projectDirs = [];
    try {
        projectDirs = fs.readdirSync(APPS_DIR)
            .filter(name => {
            const dirPath = path.join(APPS_DIR, name);
            return fs.statSync(dirPath).isDirectory() && !name.startsWith('.');
        });
    }
    catch { /* apps 디렉토리 없음 */ }
    // 각 프로젝트 정보 수집
    const projects = await Promise.all(projectDirs.map(async (name) => {
        const projectPath = path.join(APPS_DIR, name);
        // 플랫폼 감지
        const platform = detectPlatform(projectPath);
        // DB에서 활성 컨텍스트 조회
        const activeContext = db.prepare(`
      SELECT current_state, last_verification, updated_at
      FROM active_context WHERE project = ?
    `).get(name);
        // 미완료 태스크 수
        const taskCount = db.prepare(`
      SELECT COUNT(*) as count FROM tasks
      WHERE project = ? AND status IN ('pending', 'in_progress')
    `).get(name);
        // 메모리 수
        const memoryCount = db.prepare(`
      SELECT COUNT(*) as count FROM memories WHERE project = ?
    `).get(name);
        return {
            name,
            platform,
            currentState: activeContext?.current_state || null,
            lastVerification: activeContext?.last_verification || null,
            lastActive: activeContext?.updated_at || null,
            pendingTasks: taskCount.count,
            memories: memoryCount.count
        };
    }));
    // 최근 활동 기준 정렬
    projects.sort((a, b) => {
        if (!a.lastActive && !b.lastActive)
            return 0;
        if (!a.lastActive)
            return 1;
        if (!b.lastActive)
            return -1;
        return new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime();
    });
    // 전체 통계
    const totalMemories = db.prepare('SELECT COUNT(*) as count FROM memories').get().count;
    const totalTasks = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE status != \'done\'').get().count;
    return {
        content: [{
                type: 'text',
                text: JSON.stringify({
                    totalProjects: projects.length,
                    totalMemories,
                    totalPendingTasks: totalTasks,
                    projects: projects.map(p => ({
                        name: p.name,
                        platform: p.platform,
                        status: p.currentState ? p.currentState.substring(0, 50) : 'No recent activity',
                        verification: p.lastVerification,
                        pendingTasks: p.pendingTasks,
                        memories: p.memories,
                        lastActive: p.lastActive
                    }))
                }, null, 2)
            }]
    };
}
async function getProjectDetail(project) {
    const projectPath = path.join(APPS_DIR, project);
    // 프로젝트 존재 확인
    if (!fs.existsSync(projectPath)) {
        return {
            content: [{ type: 'text', text: `Project not found: ${project}` }],
            isError: true
        };
    }
    const platform = detectPlatform(projectPath);
    // 고정 컨텍스트
    const projectContext = db.prepare('SELECT * FROM project_context WHERE project = ?').get(project);
    // 활성 컨텍스트
    const activeContext = db.prepare('SELECT * FROM active_context WHERE project = ?').get(project);
    // 태스크
    const tasks = db.prepare(`
    SELECT id, title, status, priority FROM tasks
    WHERE project = ? ORDER BY priority DESC, created_at DESC
  `).all(project);
    // 최근 메모리
    const recentMemories = db.prepare(`
    SELECT id, content, memory_type, created_at FROM memories
    WHERE project = ? ORDER BY created_at DESC LIMIT 5
  `).all(project);
    // 해결된 이슈
    const resolvedIssues = db.prepare(`
    SELECT id, error_message, solution FROM resolved_issues
    WHERE project = ? ORDER BY created_at DESC LIMIT 3
  `).all(project);
    return {
        content: [{
                type: 'text',
                text: JSON.stringify({
                    project,
                    platform,
                    path: projectPath,
                    context: {
                        fixed: {
                            techStack: projectContext?.tech_stack ? JSON.parse(projectContext.tech_stack) : null,
                            architectureDecisions: projectContext?.architecture_decisions ? JSON.parse(projectContext.architecture_decisions) : [],
                            codePatterns: projectContext?.code_patterns ? JSON.parse(projectContext.code_patterns) : [],
                            specialNotes: projectContext?.special_notes
                        },
                        active: {
                            currentState: activeContext?.current_state,
                            recentFiles: activeContext?.recent_files ? JSON.parse(activeContext.recent_files) : [],
                            blockers: activeContext?.blockers,
                            lastVerification: activeContext?.last_verification,
                            lastUpdated: activeContext?.updated_at
                        }
                    },
                    tasks: {
                        summary: {
                            total: tasks.length,
                            pending: tasks.filter(t => t.status === 'pending').length,
                            inProgress: tasks.filter(t => t.status === 'in_progress').length,
                            blocked: tasks.filter(t => t.status === 'blocked').length
                        },
                        items: tasks.slice(0, 10).map(t => ({
                            id: t.id,
                            title: t.title,
                            status: t.status,
                            priority: t.priority
                        }))
                    },
                    recentMemories: recentMemories.map(m => ({
                        id: m.id,
                        preview: m.content.substring(0, 80),
                        type: m.memory_type,
                        date: m.created_at
                    })),
                    recentSolutions: resolvedIssues.map(i => ({
                        id: i.id,
                        error: i.error_message.substring(0, 80),
                        solution: i.solution.substring(0, 100)
                    }))
                }, null, 2)
            }]
    };
}
function detectPlatform(projectPath) {
    if (fs.existsSync(path.join(projectPath, 'pubspec.yaml')))
        return 'flutter';
    if (fs.existsSync(path.join(projectPath, 'build.gradle')) || fs.existsSync(path.join(projectPath, 'build.gradle.kts')))
        return 'android';
    try {
        const pkgPath = path.join(projectPath, 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            if (pkg.dependencies?.next)
                return 'nextjs';
            if (pkg.dependencies?.react)
                return 'react';
            if (pkg.dependencies?.vue)
                return 'vue';
            if (pkg.dependencies?.['@angular/core'])
                return 'angular';
            return 'node';
        }
    }
    catch { /* ignore */ }
    return 'unknown';
}
