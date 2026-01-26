// 태스크 관리 도구 (4개)
import { db } from '../db/database.js';
// ===== 도구 정의 =====
export const taskTools = [
    {
        name: 'add_task',
        description: '프로젝트에 태스크를 추가합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트명' },
                title: { type: 'string', description: '태스크 제목' },
                description: { type: 'string', description: '태스크 설명 (선택)' },
                priority: { type: 'number', description: '우선순위 1-10 (기본: 5, 10이 가장 높음)' },
                relatedFiles: { type: 'array', items: { type: 'string' }, description: '관련 파일' },
                acceptanceCriteria: { type: 'string', description: '완료 조건' }
            },
            required: ['project', 'title']
        }
    },
    {
        name: 'complete_task',
        description: '태스크를 완료 처리합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                taskId: { type: 'number', description: '태스크 ID' }
            },
            required: ['taskId']
        }
    },
    {
        name: 'update_task_status',
        description: '태스크 상태를 변경합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                taskId: { type: 'number', description: '태스크 ID' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'blocked'], description: '새 상태' }
            },
            required: ['taskId', 'status']
        }
    },
    {
        name: 'get_pending_tasks',
        description: '프로젝트의 미완료 태스크 목록을 조회합니다. /work 시작 시 호출 권장.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트명' },
                includeBlocked: { type: 'boolean', description: 'blocked 상태 포함 여부 (기본: true)' }
            },
            required: ['project']
        }
    }
];
// ===== 핸들러 =====
export function addTask(project, title, description, priority, relatedFiles, acceptanceCriteria) {
    try {
        const stmt = db.prepare(`
      INSERT INTO tasks (project, title, description, priority, related_files, acceptance_criteria)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
        const result = stmt.run(project, title, description || null, priority || 5, relatedFiles ? JSON.stringify(relatedFiles) : null, acceptanceCriteria || null);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        id: result.lastInsertRowid,
                        project,
                        title
                    })
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
export function completeTask(taskId) {
    try {
        const stmt = db.prepare(`
      UPDATE tasks
      SET status = 'done', completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
        const result = stmt.run(taskId);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        taskId,
                        completed: result.changes > 0
                    })
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
export function updateTaskStatus(taskId, status) {
    try {
        let sql = 'UPDATE tasks SET status = ?';
        const params = [status];
        if (status === 'done') {
            sql += ', completed_at = CURRENT_TIMESTAMP';
        }
        sql += ' WHERE id = ?';
        params.push(taskId);
        const stmt = db.prepare(sql);
        const result = stmt.run(...params);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        taskId,
                        status,
                        updated: result.changes > 0
                    })
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
export function getPendingTasks(project, includeBlocked = true) {
    try {
        let sql = `
      SELECT id, title, description, status, priority, related_files, acceptance_criteria, created_at
      FROM tasks
      WHERE project = ? AND status IN ('pending', 'in_progress'${includeBlocked ? ", 'blocked'" : ''})
      ORDER BY priority DESC, created_at DESC
    `;
        const stmt = db.prepare(sql);
        const rows = stmt.all(project);
        const tasks = rows.map(row => ({
            id: row.id,
            title: row.title,
            description: row.description,
            status: row.status,
            priority: row.priority,
            relatedFiles: row.related_files ? JSON.parse(row.related_files) : [],
            acceptanceCriteria: row.acceptance_criteria,
            createdAt: row.created_at
        }));
        // 상태별 카운트
        const byStatus = {
            pending: tasks.filter(t => t.status === 'pending').length,
            in_progress: tasks.filter(t => t.status === 'in_progress').length,
            blocked: tasks.filter(t => t.status === 'blocked').length
        };
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        project,
                        total: tasks.length,
                        byStatus,
                        tasks
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
