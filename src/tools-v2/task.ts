// 태스크 도구 (task_manage)
// 단일 도구로 태스크 추가/완료/업데이트/목록 통합
import { db } from '../db/database.js';
import { logger } from '../utils/logger.js';
import { TaskManageSchema } from '../schemas.js';
import type { Tool, CallToolResult } from '../types.js';

// ===== 도구 정의 =====

export const taskTools: Tool[] = [
  {
    name: 'task_manage',
    description: `태스크 관리 (추가/완료/업데이트/목록).
action에 따라 다른 동작:
- add: 새 태스크 추가 (title 필수)
- complete: 태스크 완료 (taskId 필수)
- update: 상태 변경 (taskId, status 필수)
- list: 프로젝트의 태스크 목록`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'complete', 'update', 'list'],
          description: '작업 유형'
        },
        project: { type: 'string', description: '프로젝트명' },
        title: { type: 'string', description: '태스크 제목 (add 시)' },
        description: { type: 'string', description: '태스크 설명 (add 시)' },
        priority: { type: 'number', description: '우선순위 1-10 (add 시)' },
        taskId: { type: 'number', description: '태스크 ID (complete/update 시)' },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'done', 'blocked'],
          description: '새 상태 (update 시)'
        }
      },
      required: ['action', 'project']
    }
  }
];

// ===== 핸들러 =====

export async function handleTaskManage(args: unknown): Promise<CallToolResult> {
  return logger.withTool('task_manage', async () => {
    // 입력 검증
    const parsed = TaskManageSchema.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{ type: 'text' as const, text: `Validation error: ${parsed.error.message}` }],
        isError: true
      };
    }

    const { action, project, title, description, priority, taskId, status } = parsed.data;

    switch (action) {
      case 'add':
        return addTask(project, title!, description, priority);
      case 'complete':
        return completeTask(taskId!);
      case 'update':
        return updateTaskStatus(taskId!, status!);
      case 'list':
        return listTasks(project);
      default:
        return {
          content: [{ type: 'text' as const, text: `Unknown action: ${action}` }],
          isError: true
        };
    }
  }, args as Record<string, unknown>);
}

function addTask(
  project: string,
  title: string,
  description?: string,
  priority?: number
): CallToolResult {
  const stmt = db.prepare(`
    INSERT INTO tasks (project, title, description, priority, status)
    VALUES (?, ?, ?, ?, 'pending')
  `);

  const result = stmt.run(project, title, description || null, priority || 5);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        success: true,
        action: 'add',
        task: {
          id: result.lastInsertRowid,
          project,
          title,
          priority: priority || 5,
          status: 'pending'
        }
      })
    }]
  };
}

function completeTask(taskId: number): CallToolResult {
  const stmt = db.prepare(`
    UPDATE tasks SET status = 'done', completed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  const result = stmt.run(taskId);

  if (result.changes === 0) {
    return {
      content: [{ type: 'text' as const, text: `Task not found: ${taskId}` }],
      isError: true
    };
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        success: true,
        action: 'complete',
        taskId,
        status: 'done'
      })
    }]
  };
}

function updateTaskStatus(taskId: number, status: string): CallToolResult {
  const stmt = db.prepare(`
    UPDATE tasks SET status = ?
    WHERE id = ?
  `);

  const result = stmt.run(status, taskId);

  if (result.changes === 0) {
    return {
      content: [{ type: 'text' as const, text: `Task not found: ${taskId}` }],
      isError: true
    };
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        success: true,
        action: 'update',
        taskId,
        status
      })
    }]
  };
}

function listTasks(project: string): CallToolResult {
  const stmt = db.prepare(`
    SELECT id, title, description, status, priority, created_at, completed_at
    FROM tasks
    WHERE project = ?
    ORDER BY
      CASE status WHEN 'in_progress' THEN 0 WHEN 'pending' THEN 1 WHEN 'blocked' THEN 2 ELSE 3 END,
      priority DESC,
      created_at DESC
  `);

  const rows = stmt.all(project) as Array<{
    id: number;
    title: string;
    description: string | null;
    status: string;
    priority: number;
    created_at: string;
    completed_at: string | null;
  }>;

  const byStatus = {
    in_progress: rows.filter(r => r.status === 'in_progress'),
    pending: rows.filter(r => r.status === 'pending'),
    blocked: rows.filter(r => r.status === 'blocked'),
    done: rows.filter(r => r.status === 'done').slice(0, 5) // 완료는 최근 5개만
  };

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        project,
        summary: {
          total: rows.length,
          inProgress: byStatus.in_progress.length,
          pending: byStatus.pending.length,
          blocked: byStatus.blocked.length,
          done: rows.filter(r => r.status === 'done').length
        },
        tasks: {
          inProgress: byStatus.in_progress.map(t => ({
            id: t.id,
            title: t.title,
            priority: t.priority
          })),
          pending: byStatus.pending.map(t => ({
            id: t.id,
            title: t.title,
            priority: t.priority
          })),
          blocked: byStatus.blocked.map(t => ({
            id: t.id,
            title: t.title,
            priority: t.priority
          })),
          recentDone: byStatus.done.map(t => ({
            id: t.id,
            title: t.title,
            completedAt: t.completed_at
          }))
        }
      }, null, 2)
    }]
  };
}
