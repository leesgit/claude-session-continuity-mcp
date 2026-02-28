#!/usr/bin/env node
/**
 * SessionStart Hook - 세션 시작 시 컨텍스트 자동 주입
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

interface SessionInput {
  cwd?: string;
  sessionId?: string;
}

function detectWorkspaceRoot(cwd: string): string {
  let current = cwd;
  const root = path.parse(current).root;

  while (current !== root) {
    if (fs.existsSync(path.join(current, 'apps'))) return current;
    if (fs.existsSync(path.join(current, '.claude', 'sessions.db'))) return current;
    current = path.dirname(current);
  }

  return cwd;
}

function getProject(cwd: string, workspaceRoot: string): string | null {
  const appsDir = path.join(workspaceRoot, 'apps');

  // apps/ 하위인지 확인
  if (cwd.startsWith(appsDir + path.sep)) {
    const relative = path.relative(appsDir, cwd);
    return relative.split(path.sep)[0];
  }

  // apps/ 외부 하위 프로젝트 (hackathons/ 등) - package.json에서 이름 추출
  if (cwd !== workspaceRoot) {
    let current = cwd;
    while (current !== workspaceRoot && current !== path.parse(current).root) {
      const pkgPath = path.join(current, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
          return pkg.name || path.basename(current);
        } catch {
          return path.basename(current);
        }
      }
      current = path.dirname(current);
    }
  }

  // 워크스페이스 루트 (모노레포 포함) → 폴더명 반환
  return path.basename(workspaceRoot);
}

function cleanupNoiseMemories(db: InstanceType<typeof Database>): void {
  try {
    // 3일+ auto-tracked 관찰 메모리 삭제
    db.prepare(`
      DELETE FROM memories
      WHERE memory_type = 'observation'
        AND tags LIKE '%auto-tracked%'
        AND created_at < datetime('now', '-3 days')
    `).run();

    // 14일+ auto-compact 패턴 메모리 삭제
    db.prepare(`
      DELETE FROM memories
      WHERE tags LIKE '%auto-compact%'
        AND created_at < datetime('now', '-14 days')
    `).run();
  } catch { /* ignore */ }
}

function loadContext(dbPath: string, project: string): string | null {
  if (!fs.existsSync(dbPath)) return null;

  try {
    const db = new Database(dbPath);

    // 노이즈 메모리 자동 정리
    cleanupNoiseMemories(db);

    const lines: string[] = [`# ${project} - Session Resumed\n`];

    // 현재 상태
    const active = db.prepare('SELECT current_state, blockers FROM active_context WHERE project = ?').get(project) as { current_state: string; blockers: string } | undefined;
    if (active?.current_state) {
      lines.push(`📍 **State**: ${active.current_state}`);
      if (active.blockers) lines.push(`🚧 **Blocker**: ${active.blockers}`);
      lines.push('');
    }

    // 최근 3개 세션 (빈 세션 skip)
    const recentSessions = db.prepare(`
      SELECT last_work, next_tasks, issues, timestamp FROM sessions
      WHERE project = ?
        AND last_work != 'Session ended'
        AND last_work != 'Session work completed'
        AND last_work != 'Session started'
        AND last_work != ''
        AND length(last_work) > 15
      ORDER BY timestamp DESC LIMIT 3
    `).all(project) as Array<{
      last_work: string; next_tasks: string; issues: string; timestamp: string
    }>;

    if (recentSessions.length > 0) {
      lines.push('## Recent Sessions');
      for (const session of recentSessions) {
        lines.push(`### ${session.timestamp?.slice(0, 10) || 'unknown'}`);
        lines.push(`**Work**: ${session.last_work}`);

        // 구조화 메타데이터 파싱 (session-end v2에서 저장)
        if (session.issues) {
          try {
            const meta = JSON.parse(session.issues);
            if (meta.commits?.length > 0) {
              lines.push(`**Commits**: ${meta.commits.slice(0, 3).join('; ')}`);
            }
            if (meta.decisions?.length > 0) {
              lines.push(`**Decisions**: ${meta.decisions.join('; ')}`);
            }
          } catch { /* plain text issues or empty, skip */ }
        }

        if (session.next_tasks) {
          try {
            const next = JSON.parse(session.next_tasks);
            if (next.length > 0) lines.push(`**Next**: ${next.slice(0, 2).join(', ')}`);
          } catch { /* skip */ }
        }
      }
      lines.push('');
    }

    // 사용자 지시사항
    try {
      const directives = db.prepare(`
        SELECT directive, priority FROM user_directives
        WHERE project = ? ORDER BY priority DESC, created_at DESC LIMIT 10
      `).all(project) as Array<{ directive: string; priority: string }>;

      if (directives.length > 0) {
        lines.push('## Directives');
        for (const d of directives) {
          const icon = d.priority === 'high' ? '🔴' : '📎';
          lines.push(`- ${icon} ${d.directive}`);
        }
        lines.push('');
      }
    } catch { /* table may not exist yet */ }

    // 미완료 태스크
    try {
      const tasks = db.prepare(`
        SELECT title, priority, status FROM tasks
        WHERE project = ? AND status IN ('pending', 'in_progress')
        ORDER BY priority DESC LIMIT 5
      `).all(project) as Array<{ title: string; priority: number; status: string }>;

      if (tasks.length > 0) {
        lines.push('## Pending Tasks');
        for (const t of tasks) {
          const icon = t.status === 'in_progress' ? '🔄' : '⏳';
          lines.push(`- ${icon} [P${t.priority}] ${t.title}`);
        }
        lines.push('');
      }
    } catch { /* table may not exist */ }

    // 중요 메모리 (노이즈 필터링)
    try {
      const memories = db.prepare(`
        SELECT content, memory_type FROM memories
        WHERE project = ?
          AND memory_type IN ('decision', 'learning', 'error', 'preference')
          AND importance >= 5
          AND (tags NOT LIKE '%auto-tracked%' OR tags IS NULL)
          AND (tags NOT LIKE '%auto-compact%' OR tags IS NULL)
        ORDER BY importance DESC, accessed_at DESC LIMIT 5
      `).all(project) as Array<{ content: string; memory_type: string }>;

      if (memories.length > 0) {
        const typeIcons: Record<string, string> = {
          decision: '🎯', learning: '📚', error: '⚠️', preference: '💡'
        };
        lines.push('## Key Memories');
        for (const m of memories) {
          const icon = typeIcons[m.memory_type] || '💭';
          const content = m.content.length > 100 ? m.content.slice(0, 100) + '...' : m.content;
          lines.push(`- ${icon} ${content}`);
        }
        lines.push('');
      }
    } catch { /* ignore */ }

    db.close();

    lines.push('---');
    lines.push('_Auto-injected by session-continuity v2. Use `session_end` when done._');

    return lines.join('\n');
  } catch (e) {
    return null;
  }
}

async function main() {
  try {
    // stdin에서 입력 읽기
    let inputData = '';
    for await (const chunk of process.stdin) {
      inputData += chunk;
    }

    const input: SessionInput = inputData ? JSON.parse(inputData) : {};
    const cwd = input.cwd || process.cwd();

    const workspaceRoot = detectWorkspaceRoot(cwd);
    const project = getProject(cwd, workspaceRoot);

    if (!project) {
      process.exit(0);
    }

    const dbPath = path.join(workspaceRoot, '.claude', 'sessions.db');
    const context = loadContext(dbPath, project);

    if (context) {
      console.log(`\n<session-context project="${project}">\n${context}\n</session-context>\n`);
    } else {
      console.log(`\n[Session] Project: ${project} (no context yet)\n`);
    }

    process.exit(0);
  } catch (e) {
    // 에러 시 조용히 종료
    process.exit(0);
  }
}

main();
